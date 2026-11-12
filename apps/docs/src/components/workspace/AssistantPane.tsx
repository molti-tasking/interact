"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStudyLog } from "@/context/study-context";
import { useCurrentUser } from "@/context/user-context";
import { applyCommitToCache } from "@/hooks/query/portfolios";
import { useUndoToast } from "@/hooks/query/undo";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { callLlm } from "@/lib/llm-client";
import { formatActor } from "@/lib/mock-users";
import {
  countQuestionSentences,
  patchOperationCount,
} from "@/lib/study/assistant-metrics";
import type { Portfolio } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useQueryClient } from "@tanstack/react-query";
import { mergePatchOntoLatest } from "interact/forms/merge";
import { diffSchemas } from "interact/forms/schema-ops";
import { Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ThreadMessage {
  role: "user" | "assistant";
  text: string;
  /** What the turn did to the form, e.g. "2 added, 1 changed" */
  change?: string;
}

/**
 * The conversation survives a reload and a closed tab (per form, this
 * browser): every turn sends all of it to the model.
 */
function useThread(portfolioId: string) {
  const key = `study:assistant:${portfolioId}`;
  const [thread, setThread] = useState<ThreadMessage[]>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? (JSON.parse(stored) as ThreadMessage[]) : [];
    } catch {
      return [];
    }
  });
  const update = (change: (prev: ThreadMessage[]) => ThreadMessage[]) =>
    setThread((prev) => {
      const next = change(prev);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable: the conversation lasts for this visit
      }
      return next;
    });
  return [thread, update] as const;
}

function changeSummary(added: number, changed: number, removed: number): string {
  return [
    added && `${added} added`,
    changed && `${changed} changed`,
    removed && `${removed} removed`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The "assistant" study condition's side pane: a general-purpose chat
 * assistant next to the form. The participant's first message is their
 * description. Each turn the model answers and may change the form with a
 * patch, which is applied right away (like an artifact updating) through
 * the same commit as every other change — lock guard included — and can be
 * undone. Whether it builds, asks or suggests is up to the model.
 */
export function AssistantPane({ portfolio }: { portfolio: Portfolio }) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const log = useStudyLog();
  const notifyUndo = useUndoToast();
  const [thread, updateThread] = useThread(portfolio.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length, sending]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setFailure(null);
    setDraft("");
    const earlier = thread;
    const turn = earlier.filter((m) => m.role === "user").length + 1;
    updateThread((prev) => [...prev, { role: "user", text: message }]);
    log("assistant_message", { turn, text: message });
    const startedAt = Date.now();
    try {
      const baseSchema = portfolio.schema;
      const outcome = await trackActivity(portfolio.id, "Changing the form", async () => {
        const result = await callLlm("assistant-turn", {
          schema: baseSchema,
          messages: [
            ...earlier.map((m) => ({ role: m.role, text: m.text })),
            { role: "user" as const, text: message },
          ],
        });
        if (!result.success || !result.result) {
          throw new Error(result.error ?? "The assistant didn't answer");
        }
        const { reply, schemaPatch, promptVersion } = result.result;
        const ops = patchOperationCount(schemaPatch);
        const applied =
          schemaPatch && ops
            ? await commitPortfolioChange(portfolio.id, (current) => {
                const schema = mergePatchOntoLatest(baseSchema, schemaPatch, current.schema);
                if (!schema) return null;
                return {
                  trigger: "request",
                  schema,
                  provenance: {
                    layer: "configuration",
                    action: "assistant_edit",
                    actor,
                    rationale: message,
                  },
                  // Locked fields are restored before writing (I4)
                  automated: true,
                };
              })
            : null;
        return { reply, ops, applied, promptVersion };
      });

      applyCommitToCache(queryClient, outcome.applied);
      const diff = outcome.applied
        ? diffSchemas(outcome.applied.previous.schema, outcome.applied.portfolio.schema)
        : null;
      const change = diff
        ? changeSummary(diff.added.length, diff.modified.length, diff.removed.length)
        : "";
      updateThread((prev) => [
        ...prev,
        { role: "assistant", text: outcome.reply, ...(change ? { change } : {}) },
      ]);
      // The first message is the description the coding files show
      if (turn === 1) log("first_prompt", { text: message, title: null });
      log("assistant_turn", {
        turn,
        reply: outcome.reply,
        replyChars: outcome.reply.length,
        questionSentences: countQuestionSentences(outcome.reply),
        patchOps: outcome.ops,
        added: diff?.added.length ?? 0,
        changed: diff?.modified.length ?? 0,
        removed: diff?.removed.length ?? 0,
        protectedFields: outcome.applied?.protectedFields ?? [],
        latencyMs: Date.now() - startedAt,
        promptVersion: outcome.promptVersion,
      });
      if (outcome.applied && change) notifyUndo(outcome.applied, `Form updated: ${change}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : "The assistant didn't answer";
      // Take the message back out of the conversation and put it back in
      // the box, so the next attempt sends it once
      updateThread(() => earlier);
      setDraft(message);
      setFailure(text);
      log("assistant_failed", { turn, ms: Date.now() - startedAt, error: text });
    } finally {
      setSending(false);
    }
  };

  const canSend = !!draft.trim() && !sending;

  return (
    <div data-testid="assistant-pane" className="flex flex-col gap-3">
      <h3 className="workspace-section-label">Assistant</h3>

      <div
        role="log"
        aria-label="Conversation with the assistant"
        className="flex max-h-[60vh] min-h-40 flex-col gap-2 overflow-y-auto rounded-2xl border bg-card p-3"
      >
        {thread.length === 0 && !sending && (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            Tell the assistant what form you need. It can build and change the
            form next to this chat.
          </p>
        )}
        {thread.map((message, i) => (
          <Bubble key={i} {...message} />
        ))}
        {sending && (
          <p role="status" className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Working…
          </p>
        )}
        {failure && (
          <p role="alert" className="px-1 text-sm text-destructive">
            That didn&apos;t work: {failure}. Your message is back in the box — send it again.
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="assistant-input" className="sr-only">
          Message to the assistant
        </label>
        <Textarea
          id="assistant-input"
          data-testid="assistant-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message the assistant…"
          className="bg-background"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line.</p>
          <Button type="submit" size="sm" disabled={!canSend} data-testid="assistant-send">
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ role, text, change }: ThreadMessage) {
  const mine = role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"} data-testid={`assistant-message-${role}`}>
      <div
        className={
          mine
            ? "max-w-[90%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-sm"
            : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
        }
      >
        <span className="sr-only">{mine ? "You: " : "Assistant: "}</span>
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {change && <p className="mt-1 text-xs text-muted-foreground">Form updated: {change}</p>}
      </div>
    </div>
  );
}
