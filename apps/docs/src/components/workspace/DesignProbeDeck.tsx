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
  useAutoCurateProbes,
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
import {
  useVoiceAnswers,
  type VoiceAnswerResult,
} from "@/hooks/voice/useVoiceAnswers";
import type { ConflictFixPreview } from "@/lib/engine/conflict-changes";
import { findingApplies, findingOptionPreview } from "@/lib/engine/findings";
import { rankProbes } from "@/lib/engine/probe-preview";
import { formatActor } from "@/lib/mock-users";
import type {
  DesignProbe,
  DesignProbeOption,
  Portfolio,
  ProbeOptionPreview,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import type { SpokenAnswer } from "@/lib/voice/spoken-answer";
import { usePortfolioActivity } from "@/lib/workspace-activity";
import { Loader2, Mic, RefreshCw, Square } from "lucide-react";
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

  // Findings from the responses: their answers are rebuilt from the form as
  // it is now (a stored patch could drop options added since); a finding
  // that no longer applies (field or option gone) is retired.
  const probes = useMemo(
    () =>
      (designProbes ?? []).map((probe) =>
        probe.source === "data" && probe.status === "pending"
          ? {
              ...probe,
              options: probe.options.map((option) => ({
                ...option,
                preview:
                  findingOptionPreview(probe.dimensionId, option.value, portfolioSchema) ??
                  undefined,
              })),
            }
          : probe,
      ),
    [designProbes, portfolioSchema],
  );
  const staleFindingIds = (designProbes ?? [])
    .filter(
      (p) =>
        p.source === "data" &&
        p.status === "pending" &&
        !findingApplies(p.dimensionId, portfolioSchema),
    )
    .map((p) => p.id)
    .join(",");
  const { mutate: dismissProbe } = dismissDesignProbe;
  useEffect(() => {
    if (!staleFindingIds) return;
    for (const id of staleFindingIds.split(",")) dismissProbe(id);
  }, [staleFindingIds, dismissProbe]);

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

  // Retire questions the latest changes made obsolete — once things settle
  const activity = usePortfolioActivity(portfolio.id);
  useAutoCurateProbes(
    portfolio,
    designProbes,
    busyIds.size > 0 || activity.length > 0,
  );

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
  // Design probe interaction: select an option. Handlers resolve to whether
  // the answer was applied (failures are reported here), for voice answers.
  // -------------------------------------------------------------------
  const handleStandardProbe = async (
    probeId: string,
    standardId: string | null | undefined,
    selectedValue: string,
  ): Promise<boolean> => {
    if (selectedValue !== "accept" || !standardId) {
      dismissDesignProbe.mutate(probeId);
      return true;
    }
    const detected = findStandard(standardId, detectedStandards);
    if (!detected) {
      toast.error("This standard is no longer available.");
      return false;
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
      return true;
    } catch (err) {
      toast.error(errorMessage(err, "Failed to apply the standard"));
      return false;
    } finally {
      setBusy(probeId, false);
    }
  };

  // Pre-computed answer: apply its patch right away, sync the purpose after
  const handlePreviewedAnswer = async (
    probe: DesignProbe,
    option: DesignProbeOption & { preview: ProbeOptionPreview },
  ): Promise<boolean> => {
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
      return true;
    } catch (err) {
      console.error("[DesignProbeDeck] Apply answer error:", err);
      toast.error(errorMessage(err, "Failed to apply your answer"));
      return false;
    } finally {
      setBusy(probe.id, false);
    }
  };

  const handleProbeSelect = async (
    probeId: string,
    selectedValue: string,
  ): Promise<boolean> => {
    const probe = probes.find((o) => o.id === probeId);
    if (!probe || probe.status !== "pending" || busyIds.has(probeId)) {
      return false;
    }

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
      return true;
    } catch (err) {
      console.error("[DesignProbeDeck] Design probe error:", err);
      toast.error(errorMessage(err, "Failed to apply your answer"));
      return false;
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
  ): Promise<boolean> => {
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
      return true;
    } catch (err) {
      console.error("[DesignProbeDeck] Apply fix error:", err);
      toast.error(errorMessage(err, "Failed to apply the fix"));
      return false;
    } finally {
      setBusy(conflict.id, false);
    }
  };

  const handleConflictFix = async (
    conflict: SchemaConflict,
    fix: ConflictFix,
  ): Promise<boolean> => {
    if (busyIds.has(conflict.id)) return false;
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
      return true;
    } catch (err) {
      console.error("[DesignProbeDeck] Conflict fix error:", err);
      toast.error(errorMessage(err, "Failed to apply the fix"));
      return false;
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
    probes.filter(
      (d) =>
        d.status === "pending" &&
        (d.source !== "data" || findingApplies(d.dimensionId, portfolioSchema)),
    ),
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

  // -------------------------------------------------------------------
  // Talk to the deck: spoken answers go to the open card
  // -------------------------------------------------------------------
  const answerByVoice = async (
    id: string,
    answer: SpokenAnswer,
  ): Promise<string | null> => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    if (answer.action === "skip") {
      if (entry.kind === "conflict") dismissConflict(id, true);
      else await dismissDesignProbe.mutateAsync(id);
      return "Skipped";
    }
    if (entry.kind === "conflict") {
      const fix =
        answer.action === "option" &&
        entry.conflict.fixes.find((f) => f.value === answer.value);
      return fix && (await handleConflictFix(entry.conflict, fix))
        ? fix.label
        : null;
    }
    if (answer.action === "custom") {
      return (await handleProbeSelect(id, `custom:${answer.text}`))
        ? `“${answer.text}”`
        : null;
    }
    const option = entry.probe.options.find((o) => o.value === answer.value);
    return option && (await handleProbeSelect(id, option.value))
      ? option.label
      : null;
  };

  const voice = useVoiceAnswers({
    getQuestions: () => ({
      questions: entries
        .filter((e) => !busyIds.has(e.id))
        .map((e) =>
          e.kind === "probe"
            ? {
                id: e.id,
                text: e.probe.text,
                options: e.probe.options.map(({ value, label }) => ({
                  value,
                  label,
                })),
                allowCustom: e.probe.source !== "standard",
              }
            : {
                id: e.id,
                text: e.conflict.description,
                options: e.conflict.fixes.map(({ value, label }) => ({
                  value,
                  label,
                })),
                allowCustom: false,
              },
        ),
      currentId: expandedId,
    }),
    onAnswer: answerByVoice,
  });

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
        <div className="flex items-center gap-0.5 pt-1">
          <VoiceAnswerToggle
            listening={voice.listening}
            starting={voice.starting}
            disabled={!hasCards}
            onToggle={voice.toggle}
          />
          <GenerateProbesDialog
            disabled={isGenerating || !hasIntent}
            isGenerating={isGenerating}
            onGenerate={handleGenerateProbes}
          />
        </div>
      </div>

      {(voice.listening || voice.working) && (
        <VoiceAnswerStrip
          listening={voice.listening}
          starting={voice.starting}
          working={voice.working}
          caption={voice.caption}
          last={voice.last}
        />
      )}

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
          {entries.map((entry) => (
            <div
              key={entry.id}
              data-voice-target={
                voice.listening && entry.id === expandedId ? "true" : undefined
              }
              className="rounded-xl transition-shadow data-voice-target:ring-2 data-voice-target:ring-primary/40 data-voice-target:ring-offset-2 data-voice-target:ring-offset-background"
            >
              {entry.kind === "conflict" ? (
                <ConflictCard
                  conflict={entry.conflict}
                  expanded={entry.id === expandedId}
                  onExpand={() => setFocusedId(entry.id)}
                  busy={busyIds.has(entry.id)}
                  schema={portfolioSchema}
                  previewStatus={
                    fixPreviews.get(entry.id)?.status ?? "pending"
                  }
                  previews={
                    fixPreviews.get(entry.id)?.previews ?? NO_PREVIEWS
                  }
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
              )}
            </div>
          ))}
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

// ---------------------------------------------------------------------------
// Voice answers
// ---------------------------------------------------------------------------

/** Start/stop answering the open questions by talking. */
function VoiceAnswerToggle({
  listening,
  starting,
  disabled,
  onToggle,
}: {
  listening: boolean;
  starting: boolean;
  /** Prevents starting; listening can always be stopped */
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      data-testid="voice-answer-toggle"
      variant={listening ? "destructiveSoft" : "ghost"}
      size="sm"
      disabled={disabled && !listening}
      onClick={onToggle}
      aria-pressed={listening}
      title={
        starting
          ? "Waiting for the microphone… (click to cancel)"
          : listening
            ? "Stop answering by voice"
            : "Answer the questions by talking"
      }
      className={cn("h-7 text-xs", !listening && "text-muted-foreground")}
    >
      {listening ? (
        <Square className="h-3 w-3 mr-1" aria-hidden />
      ) : (
        <Mic className="h-3 w-3 mr-1" aria-hidden />
      )}
      {listening ? "Stop" : "Talk"}
    </Button>
  );
}

/** What the deck is hearing, and what the last phrase did. */
function VoiceAnswerStrip({
  listening,
  starting,
  working,
  caption,
  last,
}: {
  listening: boolean;
  starting: boolean;
  working: boolean;
  caption: string;
  last: VoiceAnswerResult | null;
}) {
  const status = starting
    ? "Waiting for the microphone…"
    : !listening
      ? "Finishing what you said…"
      : working
        ? "Working on what you said…"
        : "Listening — answer the highlighted question, or say “skip”";

  return (
    <div
      data-testid="voice-answer-strip"
      role="status"
      aria-live="polite"
      className="mb-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2 text-foreground/80">
        {working || starting ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
        ) : (
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
        )}
        <span>{status}</span>
      </div>
      {caption && (
        <p className="mt-1 truncate italic text-muted-foreground">
          {caption}…
        </p>
      )}
      {last && (
        <p className="mt-1 line-clamp-2 text-muted-foreground">
          <span className="italic">“{last.heard}”</span> →{" "}
          <span
            className={cn(last.applied && "font-medium text-foreground")}
          >
            {last.result}
          </span>
        </p>
      )}
    </div>
  );
}

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
