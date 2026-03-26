"use client";

import type {
  ConflictFix,
  SchemaConflict,
} from "@/app/actions/conflict-actions";
import { Button } from "@/components/ui/button";
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
  const openDesignProbes = designProbes?.filter((d) => d.status === "pending");
  const generateDesignProbes = useGenerateDesignProbes(portfolio.id);
  const resolveDesignProbe = useResolveDesignProbe(portfolio.id);
  const dismissDesignProbe = useDismissDesignProbe(portfolio.id);
  const insertStandardProbes = useInsertStandardProbes(portfolio.id);
  const resolveStandardProbe = useResolveStandardProbe(portfolio.id);
  const acceptStandard = useAcceptStandard(portfolio.id);
  const skipStandard = useSkipStandard(portfolio.id);

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
  // Regenerate design probes
  // -------------------------------------------------------------------
  const handleRegenerateProbes = () => {
    if (
      !structuredIntent.purpose.content.trim() ||
      generateDesignProbes.isPending
    )
      return;

    const acceptedStandardRefs = portfolioSchema.acceptedStandards ?? [];
    const acceptedStds = (detectedStandards ?? []).filter((s) =>
      acceptedStandardRefs.some((ref) => ref.standardId === s.standard.id),
    );

    generateDesignProbes.mutate({
      intent: structuredIntent,
      acceptedStandards: acceptedStds.length > 0 ? acceptedStds : undefined,
    });
  };

  const isLoading = resolveDesignProbe.isPending || resolveConflict.isPending;
  const visibleConflicts = (conflicts ?? []).filter(
    (c) => !dismissedConflicts.has(c.id),
  );

  return (
    (visibleConflicts.length > 0 || (openDesignProbes ?? []).length > 0) && (
      <div data-testid="card-deck-section">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-md uppercase font-semibold text-muted-foreground ">
            Design Probes
          </h3>
          {(generateDesignProbes.isPending ||
            resolveDesignProbe.isPending ||
            resolveConflict.isPending) && (
            <Loader2 className="h-3 w-3 animate-spin ml-2" />
          )}
        </div>
        {/* AW: I feel like we do not properly load and display the detected standards right now. */}
        {/* <pre>{JSON.stringify(detectedStandards, null, 2)}</pre> */}
        {generateDesignProbes.isPending &&
          (designProbes ?? []).length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating design probes...
            </div>
          )}

        <div className="flex flex-col w-full gap-3">
          <ScrollFadeContainer>
            {openDesignProbes?.map((probe) => (
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

          {handleRegenerateProbes && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRegenerateProbes}
                disabled={isLoading || generateDesignProbes.isPending}
                className="text-xs text-muted-foreground"
                title="Generate new design probes"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5 mr-1",
                    generateDesignProbes.isPending && "animate-spin",
                  )}
                />
                {generateDesignProbes.isPending
                  ? "Generating..."
                  : "New questions"}
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  );
}
