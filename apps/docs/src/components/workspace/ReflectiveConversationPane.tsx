"use client";

import { PromptDiff } from "@/components/form/configurator/PromptDiff";
import { Button } from "@/components/ui/button";
import { MicButton } from "@/components/voice/MicButton";
import { useCurrentUser } from "@/context/user-context";
import {
  useDesignProbes,
  useReResolveDesignProbe,
  useRestoreProbeAnswer,
} from "@/hooks/query/design-probes";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { useSpaceSiblings } from "@/hooks/query/portfolios";
import { usePreviousPurpose } from "@/hooks/query/provenance";
import { useUndoToast } from "@/hooks/query/undo";
import { formatActor } from "@/lib/mock-users";
import type { Portfolio, StructuredIntent } from "@/lib/types";
import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";
import { ResolvedStack } from "./ResolvedStack";
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

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-3">
        <div className="flex items-center justify-between h-8 mb-3">
          <h3 className="workspace-section-label">Intent</h3>
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

        <ResolvedSection portfolio={portfolio} />
      </div>
    </div>
  );
}

const ResolvedSection = ({ portfolio }: { portfolio: Portfolio }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: designProbes } = useDesignProbes(portfolio.id);
  const reResolve = useReResolveDesignProbe(portfolio.id);
  const restoreAnswer = useRestoreProbeAnswer(portfolio.id);
  const spacePortfolios = useSpaceSiblings(portfolio);
  const notifyUndo = useUndoToast();
  const { currentUser } = useCurrentUser();

  if (!designProbes?.length) return null;

  // Resolved probes in chronological order (oldest first) for the history stack
  const resolvedProbes = [
    ...designProbes.filter((o) => o.status === "resolved"),
  ].reverse();

  const handleReResolve = async (probeId: string, newValue: string) => {
    const probe = resolvedProbes.find((p) => p.id === probeId);
    if (!probe) return;

    try {
      const result = await reResolve.mutateAsync({
        probe,
        newSelectedValue: newValue,
        // The saved state — never an unsaved intent draft
        snapshot: { intent: portfolio.intent, schema: portfolio.schema },
        editedBy: formatActor(currentUser),
        spacePortfolios,
      });
      notifyUndo(result.commit, `Changed answer to "${result.optionLabel}"`, {
        onUndone: () => restoreAnswer.mutateAsync(probe),
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to change the answer",
      );
    }
  };

  return (
    <>
      <ResolvedStack
        resolvedProbes={resolvedProbes}
        onViewAll={() => setDialogOpen(true)}
      />
      <DesignProbeResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedProbes={resolvedProbes}
        onReResolve={handleReResolve}
        isReResolving={reResolve.isPending}
      />
    </>
  );
};
