"use client";

import type {
  ConflictFix,
  SchemaConflict,
} from "@/app/actions/conflict-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ConflictCard,
  conflictKindLabel,
} from "@/components/workspace/ConflictCard";
import {
  useDeckFocus,
  useSetConflictMarks,
  type ConflictMark,
} from "@/components/workspace/deck-canvas-context";
import { ProbeCard } from "@/components/workspace/ProbeCard";
import { ResolvedSection } from "@/components/workspace/ResolvedSection";
import { useCurrentUser } from "@/context/user-context";
import {
  useApplyConflictFix,
  useConflictFixPreviews,
  useDetectConflicts,
  useResolveConflict,
} from "@/hooks/query/conflicts";
import {
  useApplyProbePreview,
  useDesignProbes,
  useDismissDesignProbe,
  useGenerateDesignProbes,
  useInsertStandardProbes,
  usePrecomputeProbePreviews,
  useReopenDesignProbe,
  useResolveDesignProbe,
  useResolveStandardProbe,
  useRetryProbePreview,
  useUndoAppliedPreview,
} from "@/hooks/query/design-probes";
import { useSpaceSiblings } from "@/hooks/query/portfolios";
import {
  findStandard,
  useAcceptStandard,
  useDetectedStandards,
} from "@/hooks/query/standards";
import { useUndoToast } from "@/hooks/query/undo";
import type { ConflictFixPreview } from "@/lib/engine/conflict-changes";
import { rankProbes } from "@/lib/engine/probe-preview";
import { formatActor } from "@/lib/mock-users";
import type {
  DesignProbe,
  DesignProbeOption,
  Portfolio,
  ProbeOptionPreview,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Where a conflict ranks among probes (priority 1 = high, 2, 3). */
const CONFLICT_RANK: Record<SchemaConflict["severity"], number> = {
  error: 0, // above everything
  warning: 1,
  info: 2,
};

type DeckEntry =
  | { kind: "conflict"; id: string; rank: number; conflict: SchemaConflict }
  | { kind: "probe"; id: string; rank: number; probe: DesignProbe };

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface DesignProbeDeckProps {
  portfolio: Portfolio;
  /**
   * An answer or fix was applied from its pre-computed preview (no LLM
   * call), so the purpose hasn't caught up yet — sync it.
   */
  onDecisionApplied?: (
    description: string,
    kind: "field-edit" | "design-decision",
  ) => void;
}

export function DesignProbeDeck({
  portfolio,
  onDecisionApplied,
}: DesignProbeDeckProps) {
  const portfolioSchema = portfolio.schema;
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const notifyUndo = useUndoToast();
  const spacePortfolios = useSpaceSiblings(portfolio);
  const targetKey = spacePortfolios.map((p) => p.id).join(",");
  const validTargetIds = useMemo(
    () => (targetKey ? targetKey.split(",") : []),
    [targetKey],
  );

  // --- React Query hooks ---
  const { data: detectedStandards } = useDetectedStandards(portfolio.id);
  const { data: designProbes } = useDesignProbes(portfolio.id);

  const generateDesignProbes = useGenerateDesignProbes(portfolio.id);
  const resolveDesignProbe = useResolveDesignProbe(portfolio.id);
  const dismissDesignProbe = useDismissDesignProbe(portfolio.id);
  const insertStandardProbes = useInsertStandardProbes(portfolio.id);
  const resolveStandardProbe = useResolveStandardProbe(portfolio.id);
  const reopenProbe = useReopenDesignProbe(portfolio.id);
  const acceptStandard = useAcceptStandard(portfolio.id);
  const applyProbePreview = useApplyProbePreview(portfolio.id);
  const undoAppliedPreview = useUndoAppliedPreview(portfolio.id);
  const retryPreview = useRetryProbePreview(portfolio.id);
  const applyConflictFix = useApplyConflictFix(portfolio.id);

  // Work out what each answer would change before it's chosen
  usePrecomputeProbePreviews(portfolio, designProbes, spacePortfolios);

  // The card whose options are shown; defaults to the most important one.
  // Shared with the canvas, where clicking a conflict marker opens its card.
  const [focusedId, setFocusedId] = useDeckFocus();

  // Cards whose answer is currently being applied. Each card resolves
  // independently — commits merge onto the latest state, so answering a
  // second probe while the first is still running is safe.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const setBusy = (id: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  // Conflict detection + resolution
  const { data: conflicts } = useDetectConflicts(
    portfolio.id,
    portfolioSchema,
    portfolio.intent,
  );
  const resolveConflict = useResolveConflict(portfolio.id);
  const [dismissedConflicts, setDismissedConflicts] = useState<Set<string>>(
    new Set(),
  );

  const visibleConflicts = (conflicts ?? []).filter(
    (c) => !dismissedConflicts.has(c.id),
  );
  // Work out what each fix would change before it's chosen
  const fixPreviews = useConflictFixPreviews(portfolio, visibleConflicts);

  // Surface newly detected standards as design probes (the insert skips
  // standards that already have a probe).
  const insertStandards = insertStandardProbes.mutate;
  useEffect(() => {
    if (detectedStandards?.length) insertStandards(detectedStandards);
  }, [detectedStandards, insertStandards]);

  const snapshot = () => ({
    intent: portfolio.intent,
    schema: portfolio.schema,
  });

  // -------------------------------------------------------------------
  // Design probe interaction: select an option
  // -------------------------------------------------------------------
  const handleStandardProbe = async (
    probeId: string,
    standardId: string | null | undefined,
    selectedValue: string,
  ) => {
    if (selectedValue !== "accept" || !standardId) {
      dismissDesignProbe.mutate(probeId);
      return;
    }
    const detected = findStandard(standardId, detectedStandards);
    if (!detected) {
      toast.error("This standard is no longer available.");
      return;
    }
    setBusy(probeId, true);
    try {
      const result = await acceptStandard.mutateAsync({ detected, actor });
      await resolveStandardProbe.mutateAsync({
        probeId,
        selectedOption: "accept",
      });
      notifyUndo(result, `Applied standard: ${detected.standard.name}`, {
        onUndone: () => reopenProbe.mutateAsync(probeId),
      });
    } catch (err) {
      toast.error(errorMessage(err, "Failed to apply the standard"));
    } finally {
      setBusy(probeId, false);
    }
  };

  // Pre-computed answer: apply its patch right away, sync the purpose after
  const handlePreviewedAnswer = async (
    probe: DesignProbe,
    option: DesignProbeOption & { preview: ProbeOptionPreview },
  ) => {
    setBusy(probe.id, true);
    try {
      const result = await applyProbePreview.mutateAsync({
        probe,
        option,
        resolvedBy: actor,
        spacePortfolios,
      });
      const decision = `"${probe.text}" → "${result.optionLabel}" (${result.summary})`;
      onDecisionApplied?.(decision, "design-decision");

      const message = `Applied: "${result.optionLabel}"`;
      toast.success(message, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await undoAppliedPreview.mutateAsync({
                commit: result.commit,
                probeId: probe.id,
                followUpId: result.followUpId,
                actor,
                label: message,
              });
              if (result.commit) {
                onDecisionApplied?.(`Undid ${decision}`, "design-decision");
              }
              toast("Change undone");
            } catch (err) {
              toast.error(errorMessage(err, "Failed to undo the answer"));
            }
          },
        },
      });
    } catch (err) {
      console.error("[DesignProbeDeck] Apply answer error:", err);
      toast.error(errorMessage(err, "Failed to apply your answer"));
    } finally {
      setBusy(probe.id, false);
    }
  };

  const handleProbeSelect = async (probeId: string, selectedValue: string) => {
    const probe = (designProbes ?? []).find((o) => o.id === probeId);
    if (!probe || probe.status !== "pending" || busyIds.has(probeId)) return;

    if (probe.source === "standard") {
      return handleStandardProbe(probeId, probe.dimensionId, selectedValue);
    }

    const option = probe.options.find((o) => o.value === selectedValue);
    if (option?.preview) {
      return handlePreviewedAnswer(probe, {
        ...option,
        preview: option.preview,
      });
    }

    // Custom answer, or no preview yet: resolve with the LLM
    setBusy(probeId, true);
    try {
      const result = await resolveDesignProbe.mutateAsync({
        probe,
        selectedValue,
        snapshot: snapshot(),
        resolvedBy: actor,
        spacePortfolios,
      });
      notifyUndo(result.commit, `Applied: "${result.optionLabel}"`, {
        // Undoing the answer reopens the question
        onUndone: () => reopenProbe.mutateAsync(probeId),
      });
    } catch (err) {
      console.error("[DesignProbeDeck] Design probe error:", err);
      toast.error(errorMessage(err, "Failed to apply your answer"));
    } finally {
      setBusy(probeId, false);
    }
  };

  // -------------------------------------------------------------------
  // Conflict resolution
  // -------------------------------------------------------------------
  const dismissConflict = (id: string, dismissed: boolean) =>
    setDismissedConflicts((prev) => {
      const next = new Set(prev);
      if (dismissed) next.add(id);
      else next.delete(id);
      return next;
    });

  // Pre-computed fix: apply its changes right away
  const handlePreviewedFix = async (
    conflict: SchemaConflict,
    fix: ConflictFix,
    preview: ConflictFixPreview,
  ) => {
    setBusy(conflict.id, true);
    try {
      const commit = await applyConflictFix.mutateAsync({
        conflict,
        fix,
        preview,
        actor,
      });
      dismissConflict(conflict.id, true);
      const description = `Fixed "${conflict.description}" → "${fix.label}" (${preview.summary})`;
      if (commit) onDecisionApplied?.(description, "field-edit");

      const message = `Fixed: ${fix.label}`;
      toast.success(message, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await undoAppliedPreview.mutateAsync({
                commit,
                actor,
                label: message,
              });
              // Show the conflict again (detection still has it cached)
              dismissConflict(conflict.id, false);
              toast("Change undone");
            } catch (err) {
              toast.error(errorMessage(err, "Failed to undo the fix"));
            }
          },
        },
      });
    } catch (err) {
      console.error("[DesignProbeDeck] Apply fix error:", err);
      toast.error(errorMessage(err, "Failed to apply the fix"));
    } finally {
      setBusy(conflict.id, false);
    }
  };

  const handleConflictFix = async (
    conflict: SchemaConflict,
    fix: ConflictFix,
  ) => {
    if (busyIds.has(conflict.id)) return;
    const preview = fixPreviews.get(conflict.id)?.previews[fix.value];
    if (preview) return handlePreviewedFix(conflict, fix, preview);

    // No preview yet: resolve with the LLM
    setBusy(conflict.id, true);
    try {
      const result = await resolveConflict.mutateAsync({
        conflict,
        fix,
        snapshot: snapshot(),
        actor,
      });
      dismissConflict(conflict.id, true);
      notifyUndo(result, `Fixed: ${fix.label}`, {
        onUndone: () => dismissConflict(conflict.id, false),
      });
    } catch (err) {
      console.error("[DesignProbeDeck] Conflict fix error:", err);
      toast.error(errorMessage(err, "Failed to apply the fix"));
    } finally {
      setBusy(conflict.id, false);
    }
  };

  // -------------------------------------------------------------------
  // Generate probes — with optional external prompt
  // -------------------------------------------------------------------
  const handleGenerateProbes = (externalPrompt: string, done: () => void) => {
    if (!portfolio.intent.purpose.content.trim()) return;

    const prompt = externalPrompt.trim();
    const acceptedStds = (portfolioSchema.acceptedStandards ?? [])
      .map((ref) => findStandard(ref.standardId, detectedStandards))
      .filter((s) => !!s);

    generateDesignProbes.mutate(
      {
        intent: portfolio.intent,
        acceptedStandards: acceptedStds.length > 0 ? acceptedStds : undefined,
        externalPrompt: prompt || undefined,
        currentSchema: portfolioSchema,
      },
      {
        onSuccess: done,
        onError: (err) =>
          toast.error(errorMessage(err, "Failed to generate questions")),
      },
    );
  };

  const isGenerating = generateDesignProbes.isPending;
  const isLoading = busyIds.size > 0;

  const pendingProbes = rankProbes(
    (designProbes ?? []).filter((d) => d.status === "pending"),
  );
  // Conflicts rank with the probes by severity; at equal rank they go first
  const entries: DeckEntry[] = [
    ...visibleConflicts.map((conflict) => ({
      kind: "conflict" as const,
      id: conflict.id,
      rank: CONFLICT_RANK[conflict.severity] ?? 1,
      conflict,
    })),
    ...pendingProbes.map((probe) => ({
      kind: "probe" as const,
      id: probe.id,
      rank: probe.priority,
      probe,
    })),
  ].sort((a, b) => a.rank - b.rank); // stable: keeps the order within a rank
  const expandedId = entries.some((e) => e.id === focusedId)
    ? focusedId
    : (entries[0]?.id ?? null);

  const hasCards = entries.length > 0;
  const hasIntent = !!portfolio.intent.purpose.content.trim();

  return (
    <div
      data-testid="card-deck-section"
      data-loading={isLoading ? "true" : undefined}
      data-generating={isGenerating ? "true" : undefined}
    >
      <div className="flex items-center justify-between h-8 mb-2">
        <h3 className="workspace-section-label">
          Design probes
          {entries.length > 0 && (
            <span className="tabular-nums"> · {entries.length}</span>
          )}
        </h3>
        <div className="flex justify-center pt-1">
          <GenerateProbesDialog
            disabled={isGenerating || !hasIntent}
            isGenerating={isGenerating}
            onGenerate={handleGenerateProbes}
          />
        </div>
      </div>

      {isGenerating && pendingProbes.length === 0 && (
        <div
          data-testid="probes-generating"
          role="status"
          className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground/70 animate-pulse motion-reduce:animate-none"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Generating design probes…
        </div>
      )}

      {!hasCards && !isGenerating && (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          {hasIntent
            ? "No open questions. Generate new ones to keep refining, or edit the form directly."
            : "Describe the form's purpose first — design probes will help you refine it."}
        </div>
      )}

      {hasCards && (
        <div className="flex flex-col gap-1">
          {entries.map((entry) =>
            entry.kind === "conflict" ? (
              <ConflictCard
                key={entry.id}
                conflict={entry.conflict}
                expanded={entry.id === expandedId}
                onExpand={() => setFocusedId(entry.id)}
                busy={busyIds.has(entry.id)}
                schema={portfolioSchema}
                previewStatus={fixPreviews.get(entry.id)?.status ?? "pending"}
                previews={fixPreviews.get(entry.id)?.previews ?? NO_PREVIEWS}
                onSelect={(value) => {
                  const fix = entry.conflict.fixes.find(
                    (f) => f.value === value,
                  );
                  if (fix) handleConflictFix(entry.conflict, fix);
                }}
                onDismiss={() => dismissConflict(entry.id, true)}
                onRetryPreview={() => fixPreviews.get(entry.id)?.retry()}
              />
            ) : (
              <ProbeCard
                key={entry.id}
                probe={entry.probe}
                expanded={entry.id === expandedId}
                onExpand={() => setFocusedId(entry.id)}
                busy={busyIds.has(entry.id)}
                schema={portfolioSchema}
                validTargetIds={validTargetIds}
                onSelect={(value) => handleProbeSelect(entry.id, value)}
                onDismiss={() => dismissDesignProbe.mutate(entry.id)}
                onRetryPreview={() => retryPreview.mutate(entry.id)}
              />
            ),
          )}
        </div>
      )}

      <PublishConflictMarks
        conflicts={visibleConflicts}
        activeId={
          entries.find((e) => e.id === expandedId)?.kind === "conflict"
            ? expandedId
            : null
        }
      />

      <div className="mt-6">
        <ResolvedSection portfolio={portfolio} />
      </div>
    </div>
  );
}

const NO_PREVIEWS: Record<string, ConflictFixPreview> = {};

/** Tell the canvas which fields to mark as conflicting. */
function PublishConflictMarks({
  conflicts,
  activeId,
}: {
  conflicts: SchemaConflict[];
  activeId: string | null;
}) {
  const setMarks = useSetConflictMarks();
  const marks: ConflictMark[] = conflicts.map((c) => ({
    id: c.id,
    severity: c.severity,
    label: conflictKindLabel(c.kind),
    description: c.description,
    fieldIds: c.fieldIds,
  }));
  const key = JSON.stringify([marks, activeId]);

  useEffect(() => {
    const [marks, activeId] = JSON.parse(key) as [ConflictMark[], string | null];
    setMarks({ marks, activeId });
  }, [key, setMarks]);
  useEffect(() => () => setMarks({ marks: [], activeId: null }), [setMarks]);

  return null;
}

// ---------------------------------------------------------------------------
// "New questions" dialog — owns its own text state so typing doesn't
// re-render the whole deck
// ---------------------------------------------------------------------------

function GenerateProbesDialog({
  disabled,
  isGenerating,
  onGenerate,
}: {
  disabled: boolean;
  isGenerating: boolean;
  onGenerate: (externalPrompt: string, done: () => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="text-muted-foreground h-7 text-xs"
        >
          <RefreshCw
            className={cn("h-3 w-3 mr-1", isGenerating && "animate-spin")}
            aria-hidden
          />
          {isGenerating ? "Generating…" : "New questions"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate design probes</DialogTitle>
          <DialogDescription>
            Optionally add a prompt to guide the questions — paste requirements,
            feedback, or context from a collaborator.
          </DialogDescription>
        </DialogHeader>
        <textarea
          data-testid="external-prompt-input"
          aria-label="Guidance for the new questions (optional)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="(optional) e.g. We also need GDPR consent fields..."
          className="w-full rounded-lg border border-border bg-background p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-20"
          rows={3}
          disabled={isGenerating}
        />
        <DialogFooter>
          <Button
            onClick={() =>
              onGenerate(text, () => {
                setText("");
                setOpen(false);
              })
            }
            disabled={isGenerating}
            size="sm"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
