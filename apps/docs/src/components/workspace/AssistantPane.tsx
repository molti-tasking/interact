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
import { ArrowUp, FilePenLine, Loader2, MessagesSquare } from "lucide-react";
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
    <section
      data-testid="assistant-pane"
      aria-label="Chat with the assistant"
      // Below the study's header and task bar, so the message box is
      // always on screen
      className="flex h-[70vh] min-h-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm @5xl:sticky @5xl:top-20 @5xl:h-[calc(100vh-9.5rem)]"
    >
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MessagesSquare className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-medium leading-tight">Assistant</h3>
          <p className="text-xs text-muted-foreground">Chat</p>
        </div>
      </header>

      <div
        role="log"
        aria-label="Conversation with the assistant"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {thread.length === 0 && !sending && (
          <div className="m-auto max-w-[17rem] space-y-2 text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <MessagesSquare className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-sm text-muted-foreground">
              Tell the assistant what form you need. It can build and change the
              form next to this chat.
            </p>
          </div>
        )}
        {thread.map((message, i) => (
          <Message key={i} {...message} />
        ))}
        {sending && (
          <div className="space-y-1" role="status">
            <p className="text-xs font-medium text-muted-foreground">Assistant</p>
            <span className="sr-only">The assistant is answering</span>
            <span className="inline-flex items-center gap-1 rounded-2xl bg-muted px-3 py-2.5" aria-hidden>
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          </div>
        )}
        {failure && (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            That didn&apos;t work: {failure}. Your message is back in the box — send it again.
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="border-t bg-card p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="rounded-xl border bg-background shadow-xs focus-within:ring-2 focus-within:ring-ring">
          <label htmlFor="assistant-input" className="sr-only">
            Message to the assistant
          </label>
          <Textarea
            id="assistant-input"
            data-testid="assistant-input"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Message the assistant…"
            className="max-h-40 min-h-12 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <p className="text-xs text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
            <Button
              type="submit"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={!canSend}
              data-testid="assistant-send"
              aria-label="Send"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function Message({ role, text, change }: ThreadMessage) {
  if (role === "user") {
    return (
      <div className="flex justify-end" data-testid="assistant-message-user">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/10 px-3.5 py-2 text-sm">
          <span className="sr-only">You: </span>
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5" data-testid="assistant-message-assistant">
      <p className="text-xs font-medium text-muted-foreground" aria-hidden>
        Assistant
      </p>
      <span className="sr-only">Assistant: </span>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</p>
      {change && (
        <p className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs text-muted-foreground">
          <FilePenLine className="h-3.5 w-3.5 text-primary" aria-hidden />
          Form updated: {change}
        </p>
      )}
    </div>
  );
}
