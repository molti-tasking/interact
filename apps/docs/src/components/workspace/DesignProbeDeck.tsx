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
import {
  useDetectConflicts,
  useResolveConflict,
} from "@/hooks/query/conflicts";
import {
  useDesignProbes,
  useDismissDesignProbe,
  useGenerateDesignProbes,
  useInsertStandardProbes,
  useResolveDesignProbe,
  useResolveStandardProbe,
} from "@/hooks/query/design-probes";
import {
  useAcceptStandard,
  useDetectedStandards,
  useSkipStandard,
} from "@/hooks/query/standards";
import type { Portfolio, StructuredIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DesignProbeDeck({ portfolio }: { portfolio: Portfolio }) {
  const portfolioSchema = portfolio.schema;

  const [structuredIntent, setStructuredIntent] = useState<StructuredIntent>(
    portfolio.intent,
  );

  // --- React Query hooks ---
  const { data: detectedStandards } = useDetectedStandards(portfolio.id);

  const { data: designProbes } = useDesignProbes(portfolio.id);
  const pendingDesignProbes = designProbes?.filter(
    (d) => d.status === "pending",
  );

  const generateDesignProbes = useGenerateDesignProbes(portfolio.id);
  const resolveDesignProbe = useResolveDesignProbe(portfolio.id);
  const dismissDesignProbe = useDismissDesignProbe(portfolio.id);
  const insertStandardProbes = useInsertStandardProbes(portfolio.id);
  const resolveStandardProbe = useResolveStandardProbe(portfolio.id);
  const acceptStandard = useAcceptStandard(portfolio.id);
  const skipStandard = useSkipStandard(portfolio.id);

  // "New questions" dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [externalPromptText, setExternalPromptText] = useState("");

  // Conflict detection + resolution
  const { data: conflicts } = useDetectConflicts(
    portfolio.id,
    portfolioSchema,
    structuredIntent,
  );
  const resolveConflict = useResolveConflict(portfolio.id);
  const [dismissedConflicts, setDismissedConflicts] = useState<Set<string>>(
    new Set(),
  );

  // Insert detected standards as design probes (once)
  const hasInsertedStandards = useRef(false);
  useEffect(() => {
    if (detectedStandards?.length && !hasInsertedStandards.current) {
      hasInsertedStandards.current = true;
      insertStandardProbes.mutate(detectedStandards);
    }
  }, [detectedStandards]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------
  // Design probe interaction: select an option
  // -------------------------------------------------------------------
  const handleProbeSelect = async (probeId: string, selectedValue: string) => {
    const probe = (designProbes ?? []).find((o) => o.id === probeId);
    if (!probe || probe.status !== "pending") return;

    // Special handling for standard probes
    if (probe.source === "standard") {
      const standardId = probe.dimensionId;
      if (selectedValue === "accept" && standardId) {
        const detected = (detectedStandards ?? []).find(
          (s) => s.standard.id === standardId,
        );
        if (detected) {
          await acceptStandard.mutateAsync({
            detected,
            portfolio: {
              id: portfolio.id,
              intent: structuredIntent,
              schema: portfolioSchema,
            },
          });
          await resolveStandardProbe.mutateAsync({
            probeId,
            selectedOption: "accept",
          });
        }
      } else {
        if (standardId) skipStandard.mutate(standardId);
        dismissDesignProbe.mutate(probeId);
      }
      return;
    }

    try {
      const result = await resolveDesignProbe.mutateAsync({
        probe,
        selectedValue,
        currentIntent: structuredIntent,
        currentSchema: portfolioSchema,
      });

      setStructuredIntent(result.newIntent);
    } catch (err) {
      console.error("[DesignProbeDeck] Design probe error:", err);
    }
  };

  const handleDismissProbe = (probeId: string) => {
    dismissDesignProbe.mutate(probeId);
  };

  // -------------------------------------------------------------------
  // Conflict resolution
  // -------------------------------------------------------------------
  const handleConflictFix = async (
    conflict: SchemaConflict,
    fix: ConflictFix,
  ) => {
    try {
      const result = await resolveConflict.mutateAsync({
        conflict,
        fix,
        currentSchema: portfolioSchema,
        currentIntent: structuredIntent,
      });
      setStructuredIntent(result.updatedIntent);
    } catch (err) {
      console.error("[ReflectiveConversationPane] Conflict fix error:", err);
    }
  };

  const handleDismissConflict = (conflictId: string) => {
    setDismissedConflicts((prev) => new Set([...prev, conflictId]));
  };

  // -------------------------------------------------------------------
  // Generate probes — with optional external prompt
  // -------------------------------------------------------------------
  const handleGenerateProbes = () => {
    if (!structuredIntent.purpose.content.trim()) return;

    const prompt = externalPromptText.trim();
    const acceptedStandardRefs = portfolioSchema.acceptedStandards ?? [];
    const acceptedStds = (detectedStandards ?? []).filter((s) =>
      acceptedStandardRefs.some((ref) => ref.standardId === s.standard.id),
    );

    generateDesignProbes.mutate(
      {
        intent: structuredIntent,
        acceptedStandards: acceptedStds.length > 0 ? acceptedStds : undefined,
        externalPrompt: prompt || undefined,
        currentSchema: prompt ? portfolioSchema : undefined,
      },
      {
        onSuccess: () => {
          setExternalPromptText("");
          setDialogOpen(false);
        },
      },
    );
  };

  const isGenerating = generateDesignProbes.isPending;
  const isLoading = resolveDesignProbe.isPending || resolveConflict.isPending;
  const visibleConflicts = (conflicts ?? []).filter(
    (c) => !dismissedConflicts.has(c.id),
  );

  const hasCards =
    visibleConflicts.length > 0 || (pendingDesignProbes ?? []).length > 0;

  return (
    <div
      data-testid="card-deck-section"
      data-loading={isLoading ? "true" : undefined}
      data-generating={isGenerating ? "true" : undefined}
    >
      {hasCards && (
        <div className="flex items-center justify-between h-8 mb-3">
          <h3 className="workspace-section-label">Design Probes</h3>
          <div className="flex justify-center pt-1">
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLoading || isGenerating}
                  className="text-muted-foreground h-7 text-xs"
                >
                  <RefreshCw
                    className={cn(
                      "h-3 w-3 mr-1",
                      isGenerating && "animate-spin",
                    )}
                  />
                  {isGenerating ? "Generating..." : "New questions"}
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
                  value={externalPromptText}
                  onChange={(e) => setExternalPromptText(e.target.value)}
                  placeholder="(optional) e.g. We also need GDPR consent fields..."
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring min-h-20"
                  rows={3}
                  disabled={isGenerating}
                />
                <DialogFooter>
                  <Button
                    onClick={handleGenerateProbes}
                    disabled={isGenerating}
                    size="sm"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      "Generate"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}

      {generateDesignProbes.isPending && (designProbes ?? []).length === 0 && (
        <div
          data-testid="probes-generating"
          className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground/70 animate-pulse"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating design probes...
        </div>
      )}

      <div className="flex flex-col w-full gap-2">
        {hasCards && (
          <ScrollFadeContainer>
            {pendingDesignProbes?.map((probe) => (
              <DesignProbeCard
                key={probe.id}
                item={{
                  ...probe,
                  onDismiss: () => handleDismissProbe(probe.id),
                  onSelect: (value: string) =>
                    handleProbeSelect(probe.id, value),
                }}
                anyLoading={isLoading}
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
                  onDismiss: () => handleDismissConflict(conflict.id),
                  onSelect: (value: string) => {
                    const fix = conflict.fixes.find((f) => f.value === value);
                    if (fix) handleConflictFix(conflict, fix);
                  },
                }}
                anyLoading={isLoading}
              />
            ))}
          </ScrollFadeContainer>
        )}
      </div>
    </div>
  );
}
