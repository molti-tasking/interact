"use client";

import { cn } from "@/lib/utils";
import { CircleHelp, Loader2, Sparkles, X } from "lucide-react";
import { useId, useState } from "react";
import {
  describePrefillIssue,
  type PrefillResult,
} from "./prefill";

/**
 * AI help for the person filling in a form, offered only when the form's
 * creator turned it on. The renderer gets these as callbacks, so it doesn't
 * know where the answers come from (`PublishedFormView` wires them to the
 * guarded server actions).
 */
export interface FormAssist {
  /** Explain a question; only the question is sent, never an answer */
  explain?: (fieldId: string) => Promise<string>;
  /** Extract answers from the respondent's own text */
  prefill?: (text: string) => Promise<PrefillResult>;
}

/** "What does this mean?" under a question. */
export function ExplainQuestion({
  label,
  explain,
}: {
  label: string;
  /** Resolves to the explanation (cached by the caller) */
  explain: () => Promise<string>;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "shown"; text: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const id = useId();

  const ask = async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "shown", text: await explain() });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Couldn't explain this question.",
      });
    }
  };

  if (state.kind === "shown") {
    return (
      <div
        id={id}
        role="status"
        data-testid="field-explanation"
        className="mt-1.5 flex items-start gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground"
      >
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <p className="flex-1">
          {state.text}{" "}
          <span className="text-muted-foreground/70">(AI explanation)</span>
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          aria-label={`Hide the explanation of ${label}`}
          className="rounded p-0.5 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <button
        type="button"
        data-testid="field-explain"
        onClick={ask}
        disabled={state.kind === "loading"}
        aria-label={`What does "${label}" mean?`}
        className="inline-flex items-center gap-1 rounded text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:no-underline"
      >
        {state.kind === "loading" ? (
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <CircleHelp className="h-3 w-3" aria-hidden />
        )}
        {state.kind === "loading" ? "Explaining…" : "What does this mean?"}
      </button>
      {state.kind === "error" && (
        <span role="alert" className="text-[11px] text-destructive">
          {state.message}
        </span>
      )}
    </div>
  );
}

/** "Fill from text" above the form. */
export function PrefillPanel({
  prefill,
  onFilled,
}: {
  prefill: (text: string) => Promise<PrefillResult>;
  /** Put the values into the form; they stay marked until checked */
  onFilled: (result: PrefillResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrefillResult | null>(null);
  const id = useId();

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const filled = await prefill(text);
      onFilled(filled);
      setResult(filled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read the text.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="prefill-open"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Fill in from a text
      </button>
    );
  }

  return (
    <div data-testid="prefill-panel" className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <label htmlFor={id} className="text-sm font-medium">
        Describe your answers in your own words
      </label>
      <textarea
        id={id}
        data-testid="prefill-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={8000}
        disabled={busy}
        aria-describedby={`${id}-note`}
        placeholder="Write or paste a few sentences — the form is filled in from them."
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      />
      <p id={`${id}-note`} className="text-xs leading-relaxed text-muted-foreground">
        This text is sent to an AI service, which reads your answers out of it.
        Don&apos;t include anything you wouldn&apos;t want to share. Nothing is
        submitted: the answers are put into the form for you to check and change.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="prefill-run"
          onClick={run}
          disabled={busy || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
          {busy ? "Reading…" : "Fill in the form"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {result && !error && (
        <div role="status" data-testid="prefill-result" className="space-y-1 text-xs">
          <p className={cn(result.filled.length === 0 && "text-muted-foreground")}>
            {result.filled.length === 0
              ? "Nothing in the text matched a question of this form."
              : `Filled in ${result.filled.length} answer${result.filled.length === 1 ? "" : "s"}: ${result.filled.map((f) => f.label).join(", ")}. Please check each one — they are marked below.`}
          </p>
          {result.issues.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-amber-700 dark:text-amber-300">
              {result.issues.map((issue, i) => (
                <li key={`${issue.field}-${i}`}>{describePrefillIssue(issue)}</li>
              ))}
            </ul>
          )}
          {result.missingRequired.length > 0 && (
            <p className="text-muted-foreground">
              Still to answer: {result.missingRequired.join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
