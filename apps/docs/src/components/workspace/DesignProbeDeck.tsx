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
import { DesignProbeCard } from "@/components/workspace/DesignProbeCard";
import { ScrollFadeContainer } from "@/components/workspace/ScrollFadeContainer";
import { useCurrentUser } from "@/context/user-context";
import {
  useDetectConflicts,
  useResolveConflict,
} from "@/hooks/query/conflicts";
import {
  useDesignProbes,
  useDismissDesignProbe,
  useGenerateDesignProbes,
  useInsertStandardProbes,
  useReopenDesignProbe,
  useResolveDesignProbe,
  useResolveStandardProbe,
} from "@/hooks/query/design-probes";
import { useSpaceSiblings } from "@/hooks/query/portfolios";
import {
  findStandard,
  useAcceptStandard,
  useDetectedStandards,
} from "@/hooks/query/standards";
import { useUndoToast } from "@/hooks/query/undo";
import { formatActor } from "@/lib/mock-users";
import type { Portfolio } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DesignProbeDeck({ portfolio }: { portfolio: Portfolio }) {
  const portfolioSchema = portfolio.schema;
  const { currentUser } = useCurrentUser();
  const actor = formatActor(currentUser);
  const notifyUndo = useUndoToast();
  const spacePortfolios = useSpaceSiblings(portfolio);

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

  const handleProbeSelect = async (probeId: string, selectedValue: string) => {
    const probe = (designProbes ?? []).find((o) => o.id === probeId);
    if (!probe || probe.status !== "pending" || busyIds.has(probeId)) return;

    if (probe.source === "standard") {
      return handleStandardProbe(probeId, probe.dimensionId, selectedValue);
    }

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
  const handleConflictFix = async (
    conflict: SchemaConflict,
    fix: ConflictFix,
  ) => {
    if (busyIds.has(conflict.id)) return;
    setBusy(conflict.id, true);
    try {
      const result = await resolveConflict.mutateAsync({
        conflict,
        fix,
        snapshot: snapshot(),
        actor,
      });
      setDismissedConflicts((prev) => new Set([...prev, conflict.id]));
      notifyUndo(result, `Fixed: ${fix.label}`);
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
  const visibleConflicts = (conflicts ?? []).filter(
    (c) => !dismissedConflicts.has(c.id),
  );

  // Standards always render at the top of the deck
  const pendingProbes = (designProbes ?? [])
    .filter((d) => d.status === "pending")
    .sort(
      (a, b) =>
        (a.source === "standard" ? 0 : 1) - (b.source === "standard" ? 0 : 1),
    );

  const hasCards = visibleConflicts.length > 0 || pendingProbes.length > 0;
  const hasIntent = !!portfolio.intent.purpose.content.trim();

  return (
    <div
      data-testid="card-deck-section"
      data-loading={isLoading ? "true" : undefined}
      data-generating={isGenerating ? "true" : undefined}
    >
      <div className="flex items-center justify-between h-8 mb-3">
        <h3 className="workspace-section-label">Design Probes</h3>
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

      <div className="flex flex-col w-full gap-2">
        {hasCards && (
          <ScrollFadeContainer>
            {pendingProbes.map((probe) => (
              <DesignProbeCard
                key={probe.id}
                item={{
                  ...probe,
                  onDismiss: () => dismissDesignProbe.mutate(probe.id),
                  onSelect: (value: string) =>
                    handleProbeSelect(probe.id, value),
                }}
                busy={busyIds.has(probe.id)}
              />
            ))}
            {visibleConflicts.map((conflict) => (
              <DesignProbeCard
                key={conflict.id}
                item={{
                  ...conflict,
                  dimensionName: "CONFLICT",
                  text: conflict.description,
                  options: conflict.fixes.map((f) => ({
                    value: f.value,
                    label: f.label,
                    description: f.description,
                  })),
                  status: "pending" as const,
                  onDismiss: () =>
                    setDismissedConflicts(
                      (prev) => new Set([...prev, conflict.id]),
                    ),
                  onSelect: (value: string) => {
                    const fix = conflict.fixes.find((f) => f.value === value);
                    if (fix) handleConflictFix(conflict, fix);
                  },
                }}
                busy={busyIds.has(conflict.id)}
              />
            ))}
          </ScrollFadeContainer>
        )}
      </div>
    </div>
  );
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
            Optionally add a prompt to guide the questions — paste
            requirements, feedback, or context from a collaborator.
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
