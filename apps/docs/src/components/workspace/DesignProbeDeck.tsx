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
import type { DesignProbe, Portfolio, StructuredIntent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";
import { normalizeItems } from "./normalizeItems";

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

  const visibleConflicts = (conflicts ?? []).filter(
    (c) => !dismissedConflicts.has(c.id),
  );

  return (
    (visibleConflicts.length > 0 || (designProbes ?? []).length > 0) && (
      <div data-testid="card-deck-section" className="space-y-2">
        <h3 className="text-md uppercase font-semibold text-muted-foreground">
          Design Probes
          {(generateDesignProbes.isPending ||
            resolveDesignProbe.isPending ||
            resolveConflict.isPending) && (
            <Loader2 className="h-3 w-3 animate-spin ml-2" />
          )}
        </h3>
        {generateDesignProbes.isPending &&
          (designProbes ?? []).length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating design probes...
            </div>
          )}
        <DesignProbeDeckWrapped
          probes={designProbes ?? []}
          conflicts={visibleConflicts}
          anyLoading={resolveDesignProbe.isPending || resolveConflict.isPending}
          isRegenerating={generateDesignProbes.isPending}
          onSelectProbe={handleProbeSelect}
          onDismissProbe={handleDismissProbe}
          onSelectConflictFix={handleConflictFix}
          onDismissConflict={handleDismissConflict}
          onRegenerate={handleRegenerateProbes}
        />
      </div>
    )
  );
}

function DesignProbeDeckWrapped({
  probes,
  conflicts,
  anyLoading,
  isRegenerating,
  onSelectProbe,
  onDismissProbe,
  onSelectConflictFix,
  onDismissConflict,
  onRegenerate,
}: {
  probes: DesignProbe[];
  conflicts: SchemaConflict[];
  anyLoading: boolean;
  isRegenerating?: boolean;
  onSelectProbe: (probeId: string, value: string) => void;
  onDismissProbe: (probeId: string) => void;
  onSelectConflictFix: (conflict: SchemaConflict, fix: ConflictFix) => void;
  onDismissConflict: (conflictId: string) => void;
  onRegenerate?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const items = normalizeItems(
    probes,
    conflicts,
    onSelectProbe,
    onDismissProbe,
    onSelectConflictFix,
    onDismissConflict,
  );

  // Resolved probes in chronological order (oldest first) for the history stack
  const resolvedProbes = [
    ...probes.filter((o) => o.status === "resolved"),
  ].reverse();

  if (items.length === 0 && resolvedProbes.length === 0) return null;

  return (
    <div className="flex flex-col w-full gap-3">
      <ScrollFadeContainer>
        {items.map((item) => (
          <DesignProbeCard key={item.id} item={item} anyLoading={anyLoading} />
        ))}
      </ScrollFadeContainer>

      {onRegenerate && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={anyLoading || isRegenerating}
            className="text-xs text-muted-foreground"
            title="Generate new design probes"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 mr-1",
                isRegenerating && "animate-spin",
              )}
            />
            {isRegenerating ? "Generating..." : "New questions"}
          </Button>
        </div>
      )}

      <DesignProbeResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedProbes={resolvedProbes}
      />
    </div>
  );
}
