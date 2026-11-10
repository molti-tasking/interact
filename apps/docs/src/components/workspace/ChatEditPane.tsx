"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useStudyLog } from "@/context/study-context";
import { useCurrentUser } from "@/context/user-context";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { applyCommitToCache } from "@/hooks/query/portfolios";
import { useUndoToast } from "@/hooks/query/undo";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { callLlm } from "@/lib/llm-client";
import { formatActor } from "@/lib/mock-users";
import type { Portfolio } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useQueryClient } from "@tanstack/react-query";
import { mergePatchOntoLatest } from "interact/forms/merge";
import { diffSchemas } from "interact/forms/schema-ops";
import { Loader2, RotateCcw, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface ChatMessage {
  role: "you" | "tool";
  text: string;
  /** What the request did to the form, e.g. "2 added, 1 changed" */
  change?: string;
}

interface ChatEditPaneProps {
  portfolio: Portfolio;
  /** Run generation once on mount (new form with a description). */
  autoGenerate?: boolean;
  onAutoGenerateStarted?: () => void;
}

/** The conversation survives a reload (per form, this browser tab). */
function useThread(portfolioId: string) {
  const key = `workspace:chat:${portfolioId}`;
  const [thread, setThread] = useState<ChatMessage[]>(() => {
    try {
      const stored = window.sessionStorage.getItem(key);
      return stored ? (JSON.parse(stored) as ChatMessage[]) : [];
    } catch {
      return [];
    }
  });
  const append = (...messages: ChatMessage[]) =>
    setThread((prev) => {
      const next = [...prev, ...messages];
      try {
        window.sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage unavailable: the conversation lasts for this visit
      }
      return next;
    });
  return [thread, append] as const;
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
 * The baseline study condition's side pane: the first description, the
 * generated form, and then free-text change requests applied by the model.
 * No intent portfolio, no design probes — the tool does what it is told.
 */
export function ChatEditPane({
  portfolio,
  autoGenerate,
  onAutoGenerateStarted,
}: ChatEditPaneProps) {
  const queryClient = useQueryClient();
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const log = useStudyLog();
  const notifyUndo = useUndoToast();
  const pipeline = usePipelineGenerate(portfolio.id);
  const [thread, append] = useThread(portfolio.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const description = portfolio.intent.purpose.content.trim();
  const fieldCount = portfolio.schema.fields.length;
  // Tracked here, not read from the mutation: generation starts from an
  // effect, and a mutation started that way loses its state when React
  // remounts the component in development ("Drafting…" would never end)
  const [generating, setGenerating] = useState(false);
  const { mutateAsync: runPipeline } = pipeline;

  const generate = () => {
    setGenerating(true);
    runPipeline({
      previousIntent: portfolio.intent,
      currentIntent: portfolio.intent,
      currentSchema: portfolio.schema,
      actor,
    })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Form generation failed"),
      )
      .finally(() => setGenerating(false));
  };

  // New form created with a description → generate right away (once)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoStarted.current) return;
    if (!description || fieldCount > 0) return;
    autoStarted.current = true;
    onAutoGenerateStarted?.();
    generate();
    // `generate` reads the same values the guards above do
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, onAutoGenerateStarted, description, fieldCount]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length, sending]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending || generating || fieldCount === 0) return;
    setSending(true);
    setDraft("");
    const history = thread.filter((m) => m.role === "you").map((m) => m.text);
    append({ role: "you", text: message });
    log("chat_message", { text: message, turn: history.length + 1 });
    const startedAt = Date.now();
    try {
      const baseSchema = portfolio.schema;
      const commit = await trackActivity(portfolio.id, "Changing the form", async () => {
        const result = await callLlm("chat-edit", {
          intent: portfolio.intent,
          currentSchema: baseSchema,
          message,
          history,
        });
        if (!result.success || !result.result) {
          throw new Error(result.error ?? "Couldn't change the form");
        }
        const { reply, schemaPatch } = result.result;
        const applied = await commitPortfolioChange(portfolio.id, (current) => {
          const schema = mergePatchOntoLatest(baseSchema, schemaPatch, current.schema);
          if (!schema) return null;
          return {
            schema,
            provenance: {
              layer: "configuration",
              action: "chat_edit",
              actor,
              rationale: message,
            },
            automated: true,
          };
        });
        return { reply, applied };
      });

      applyCommitToCache(queryClient, commit.applied);
      const diff = commit.applied
        ? diffSchemas(commit.applied.previous.schema, commit.applied.portfolio.schema)
        : null;
      const change = diff
        ? changeSummary(diff.added.length, diff.modified.length, diff.removed.length)
        : "";
      append({
        role: "tool",
        text: commit.reply || (change ? "Done." : "I didn't change the form."),
        change: change || "No change to the form",
      });
      log("chat_reply", {
        ms: Date.now() - startedAt,
        added: diff?.added.length ?? 0,
        changed: diff?.modified.length ?? 0,
        removed: diff?.removed.length ?? 0,
      });
      if (commit.applied && change) notifyUndo(commit.applied, `Form updated: ${change}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Couldn't change the form";
      append({ role: "tool", text: `That didn't work: ${text}`, change: "No change to the form" });
      log("chat_failed", { ms: Date.now() - startedAt, error: text });
      // Put the request back so it isn't lost
      setDraft(message);
    } finally {
      setSending(false);
    }
  };

  const canSend = !!draft.trim() && !sending && !generating && fieldCount > 0;

  return (
    <div data-testid="chat-edit-pane" className="flex flex-col gap-3">
      <h3 className="workspace-section-label">Your request</h3>

      <div
        role="log"
        aria-label="Conversation with the form tool"
        className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-2xl border bg-card p-3"
      >
        <Bubble role="you" text={description} />
        {generating ? (
          <p role="status" className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Drafting your form…
          </p>
        ) : fieldCount > 0 ? (
          <Bubble role="tool" text="I drafted a form from your description. Tell me what to change." />
        ) : (
          <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            The form couldn&apos;t be drafted.
            <Button variant="outline" size="sm" onClick={generate}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              Try again
            </Button>
          </div>
        )}
        {thread.map((message, i) => (
          <Bubble key={i} {...message} />
        ))}
        {sending && (
          <p role="status" className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Changing the form…
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
        <label htmlFor="chat-edit-input" className="sr-only">
          What should change in the form?
        </label>
        <Textarea
          id="chat-edit-input"
          data-testid="chat-edit-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Tell the tool what to add, change or remove."
          className="bg-background"
          disabled={generating || fieldCount === 0}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Enter to send, Shift+Enter for a new line.</p>
          <Button type="submit" size="sm" disabled={!canSend} data-testid="chat-edit-send">
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

function Bubble({ role, text, change }: ChatMessage) {
  const mine = role === "you";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          mine
            ? "max-w-[90%] rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-sm"
            : "max-w-[90%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm"
        }
      >
        <span className="sr-only">{mine ? "You: " : "Tool: "}</span>
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {change && <p className="mt-1 text-xs text-muted-foreground">{change}</p>}
      </div>
    </div>
  );
}
