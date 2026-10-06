"use client";

import { PromptDiff } from "@/components/form/configurator/PromptDiff";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/voice/MicButton";
import { useCurrentUser } from "@/context/user-context";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { usePreviousPurpose } from "@/hooks/query/provenance";
import { formatActor } from "@/lib/mock-users";
import type { Portfolio, StructuredIntent } from "@/lib/types";
import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { StructuredIntentEditor } from "./StructuredIntentEditor";

interface ReflectiveConversationPaneProps {
  portfolio: Portfolio;
  /** Run generation once on mount (new portfolio created with an intent). */
  autoGenerate?: boolean;
  onAutoGenerateStarted?: () => void;
}

/** An in-progress intent edit: the saved state it started from + the draft. */
interface EditSession {
  base: StructuredIntent;
  draft: StructuredIntent;
}

/** Remembered per portfolio, so the pane stays the way the user left it. */
function useIntentOpen(portfolioId: string) {
  const key = `workspace:intent-open:${portfolioId}`;
  const [open, setOpenState] = useState<boolean | null>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? null : stored === "1";
    } catch {
      return null;
    }
  });
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(key, next ? "1" : "0");
    } catch {
      // Storage unavailable (private mode) — keep it for this visit only
    }
  };
  return [open, setOpen] as const;
}

function sameIntent(a: StructuredIntent, b: StructuredIntent): boolean {
  return (
    a.purpose.content === b.purpose.content &&
    a.audience.content === b.audience.content &&
    a.exclusions.content === b.exclusions.content &&
    a.constraints.content === b.constraints.content
  );
}

/**
 * ReflectiveConversationPane — the primary elicitation workspace.
 * Named after Rost/Schön's "reflective conversation": interaction as a
 * sequence of moves (user) and backtalk (system) where meaning emerges
 * through reciprocal exchange, not upfront specification.
 */
export function ReflectiveConversationPane({
  portfolio,
  autoGenerate,
  onAutoGenerateStarted,
}: ReflectiveConversationPaneProps) {
  const portfolioSchema = portfolio.schema;
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);

  // While the user edits, the editor shows their draft; otherwise it shows
  // the saved intent, so external updates (resolved probes, field-edit
  // syncs) appear immediately and never overwrite text being typed.
  const [session, setSession] = useState<EditSession | null>(null);
  const intent = session?.draft ?? portfolio.intent;
  const isDirty = !!session && !sameIntent(session.draft, session.base);
  const changedElsewhere =
    isDirty && !sameIntent(session.base, portfolio.intent);

  const pipeline = usePipelineGenerate(portfolio.id);
  const [error, setError] = useState<string | null>(null);

  const { data: previousPurpose } = usePreviousPurpose(
    portfolio.id,
    portfolio.intent.purpose.content,
  );
  const [showDiff, setShowDiff] = useState(false);

  const handleIntentChange = useCallback(
    (draft: StructuredIntent) =>
      setSession((prev) => ({ base: prev?.base ?? portfolio.intent, draft })),
    [portfolio.intent],
  );

  // Dictated text is appended to the *purpose* section.
  const handleVoiceTranscript = useCallback(
    (text: string) =>
      setSession((prev) => {
        const base = prev?.base ?? portfolio.intent;
        const draft = prev?.draft ?? portfolio.intent;
        return {
          base,
          draft: {
            ...draft,
            purpose: {
              content: draft.purpose.content
                ? `${draft.purpose.content}\n\n${text}`
                : text,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }),
    [portfolio.intent],
  );

  const isGenerating = pipeline.isPending;
  const hasFields = portfolioSchema.fields.length > 0;

  // -------------------------------------------------------------------
  // Generate / refine
  // -------------------------------------------------------------------
  const handleGenerate = async () => {
    if (!intent.purpose.content.trim() || isGenerating) return;
    setError(null);
    setShowDiff(false);

    try {
      const result = await pipeline.mutateAsync({
        previousIntent: session?.base ?? portfolio.intent,
        currentIntent: intent,
        currentSchema: portfolioSchema,
        actor,
      });

      if (result.strategy.kind === "noop") {
        setError("No changes detected. Edit the intent to refine the form.");
        return;
      }
      setSession(null);
    } catch (err) {
      console.error("[ReflectiveConversationPane] Generation error:", err);
      const message = err instanceof Error ? err.message : "Generation failed";
      setError(message);
      toast.error(message);
    }
  };

  // New portfolio created with an intent → generate right away (once).
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoStarted.current) return;
    if (!portfolio.intent.purpose.content.trim() || hasFields) return;
    autoStarted.current = true;
    onAutoGenerateStarted?.();
    pipeline.mutate(
      {
        previousIntent: portfolio.intent,
        currentIntent: portfolio.intent,
        currentSchema: portfolio.schema,
        actor,
      },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Form generation failed",
          ),
      },
    );
  }, [
    autoGenerate,
    onAutoGenerateStarted,
    portfolio.intent,
    portfolio.schema,
    hasFields,
    pipeline,
    actor,
  ]);

  const canDiff =
    !!previousPurpose && previousPurpose !== portfolio.intent.purpose.content;

  // Collapsed by default once there is a form; always open while it's the
  // way forward (no form or purpose yet), while editing, or with an error.
  const [storedOpen, setOpen] = useIntentOpen(portfolio.id);
  const purposeText = portfolio.intent.purpose.content.trim();
  const mustStayOpen =
    !hasFields || !purposeText || isDirty || isGenerating || !!error;
  const expanded = mustStayOpen || (storedOpen ?? false);
  const bodyId = useId();

  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="intent-toggle"
        aria-expanded={false}
        aria-controls={bodyId}
        onClick={() => setOpen(true)}
        className="group flex w-full cursor-pointer items-start gap-2 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="workspace-section-label block">Intent</span>
          <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-foreground/75">
            {purposeText}
          </span>
        </span>
        <ChevronDown
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-y-0.5"
          aria-hidden
        />
      </button>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div id={bodyId} className="space-y-3">
        <div className="flex items-center justify-between h-8 mb-3">
          {mustStayOpen ? (
            <h3 className="workspace-section-label">Intent</h3>
          ) : (
            <button
              type="button"
              data-testid="intent-toggle"
              aria-expanded
              aria-controls={bodyId}
              onClick={() => setOpen(false)}
              className="group flex cursor-pointer items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h3 className="workspace-section-label">Intent</h3>
              <ChevronDown
                className="h-3.5 w-3.5 rotate-180 text-muted-foreground/60 transition-colors group-hover:text-foreground"
                aria-hidden
              />
              <span className="sr-only">Collapse</span>
            </button>
          )}
          <div className="flex items-center gap-1">
            {canDiff && !isDirty && (
              <Button
                onClick={() => setShowDiff(!showDiff)}
                variant="ghost"
                size="sm"
                aria-pressed={showDiff}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                {!showDiff ? "View" : "Hide"} last change
              </Button>
            )}
            <MicButton
              onTranscript={handleVoiceTranscript}
              disabled={isGenerating}
            />
          </div>
        </div>

        <div className="relative overflow-hidden rounded-2xl">
          {/* Animated gradient when processing */}
          {isGenerating && (
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,#ff6ec4,#7873f5,#4ade80,#60a5fa)] bg-size-[400%_400%] animate-[gradient_3s_ease_infinite] opacity-30 z-10 rounded-2xl motion-reduce:animate-none" />
          )}

          {showDiff && canDiff ? (
            <button
              type="button"
              className="block w-full text-left border rounded-2xl p-2.5 bg-muted/30 transition-colors hover:bg-muted/50"
              onClick={() => setShowDiff(false)}
              aria-label="Hide purpose changes"
            >
              <PromptDiff
                previous={previousPurpose}
                current={portfolio.intent.purpose.content}
              />
            </button>
          ) : (
            <div data-testid="intent-editor">
              <StructuredIntentEditor
                value={intent}
                onChange={handleIntentChange}
                disabled={isGenerating}
              />
            </div>
          )}
        </div>

        {changedElsewhere && (
          <p className="text-xs text-muted-foreground" role="status">
            The intent was updated while you were editing. Your changes will
            be merged in when you refine.
          </p>
        )}

        {/* Error display */}
        {error && (
          <div
            role="alert"
            className="rounded-lg bg-destructive/8 text-destructive px-4 py-3 text-sm border border-destructive/15"
          >
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pb-6">
          <Button
            data-testid="generate-form-btn"
            data-loading={isGenerating ? "true" : undefined}
            onClick={handleGenerate}
            disabled={
              !intent.purpose.content.trim() ||
              isGenerating ||
              (hasFields && !isDirty)
            }
            className="flex-1 btn-brand"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {hasFields ? "Refining…" : "Generating…"}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                {hasFields ? "Refine Form" : "Generate Form"}
              </>
            )}
          </Button>
          {isDirty && !isGenerating && (
            <Button variant="ghost" onClick={() => setSession(null)}>
              Discard
            </Button>
          )}
        </div>
        {hasFields && !isDirty && !isGenerating && (
          <p className="-mt-4 pb-4 text-xs text-muted-foreground/80">
            Edit the intent to refine the form, or answer the design probes.
          </p>
        )}
      </div>
    </div>
  );
}
