"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DimensionObject } from "@/lib/dimension-types";
import { dimensionScopeColors } from "@/lib/dimension-types";
import { cn } from "@/lib/utils";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import {
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { AddDimensionInput } from "./AddDimensionInput";
import { DimensionCard } from "./DimensionCard";

export function DimensionPanel() {
  const dimensions = useConfiguratorStore((s) => s.dimensions);
  const discoveryPhase = useConfiguratorStore((s) => s.discoveryPhase);
  const dimensionReasoning = useConfiguratorStore(
    (s) => s.dimensionReasoning,
  );
  const onDimensionAccept = useConfiguratorStore((s) => s.onDimensionAccept);
  const onDimensionReject = useConfiguratorStore((s) => s.onDimensionReject);
  const onDimensionEdit = useConfiguratorStore((s) => s.onDimensionEdit);
  const onDimensionAdd = useConfiguratorStore((s) => s.onDimensionAdd);
  const onConfirmDimensions = useConfiguratorStore(
    (s) => s.onConfirmDimensions,
  );
  const onRegenerateDimensions = useConfiguratorStore(
    (s) => s.onRegenerateDimensions,
  );

  // Initial review starts expanded; after confirming, collapsed
  const isInitialReview = discoveryPhase === "reviewing-dimensions";
  const [expanded, setExpanded] = useState(isInitialReview);
  const [showReasoning, setShowReasoning] = useState(false);

  // Sync: auto-expand when entering review phase
  const [prevPhase, setPrevPhase] = useState(discoveryPhase);
  if (discoveryPhase !== prevPhase) {
    setPrevPhase(discoveryPhase);
    if (discoveryPhase === "reviewing-dimensions") {
      setExpanded(true);
    }
  }

  // Loading states
  if (discoveryPhase === "generating-dimensions") {
    return (
      <div className="space-y-3 pt-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 animate-pulse" />
          Discovering dimensions...
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (discoveryPhase === "generating-schema") {
    return (
      <div className="space-y-3 pt-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 animate-pulse" />
          Generating form from dimensions...
        </div>
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>
    );
  }

  // Nothing to show
  if (dimensions.length === 0) return null;

  const acceptedDimensions = dimensions.filter(
    (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
  );
  const acceptedCount = acceptedDimensions.length;
  const totalCount = dimensions.length;
  const hasUnsavedChanges = discoveryPhase === "reviewing-dimensions";

  return (
    <div className="space-y-2 pt-3">
      {/* Header — always visible */}
      <button
        className="flex w-full items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          <span className="text-sm font-medium">Dimensions</span>
          <span className="text-xs text-muted-foreground">
            {acceptedCount}/{totalCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Collapsed: show accepted dimension pills */}
          {!expanded && acceptedDimensions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {acceptedDimensions.map((d) => (
                <Badge
                  key={d.id}
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0",
                    dimensionScopeColors[d.scope],
                  )}
                >
                  {d.name}
                </Badge>
              ))}
            </div>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded: full dimension editing */}
      {expanded && (
        <div className="space-y-2 pl-1">
          <div className="flex items-center justify-end">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 text-xs"
              onClick={onRegenerateDimensions}
            >
              <RefreshCw className="h-3 w-3" />
              Rediscover
            </Button>
          </div>

          {dimensionReasoning && (
            <div>
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowReasoning(!showReasoning)}
              >
                {showReasoning ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                Why these dimensions?
              </button>
              {showReasoning && (
                <p className="mt-1 text-xs text-muted-foreground bg-muted/50 rounded p-2">
                  {dimensionReasoning}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            {dimensions.map((dimension: DimensionObject) => (
              <DimensionCard
                key={dimension.id}
                dimension={dimension}
                onAccept={() => onDimensionAccept(dimension.id)}
                onReject={() => onDimensionReject(dimension.id)}
                onEdit={(updates) => onDimensionEdit(dimension.id, updates)}
              />
            ))}
          </div>

          <AddDimensionInput onAdd={onDimensionAdd} />

          {/* Show confirm button during initial review or when re-editing */}
          {hasUnsavedChanges && (
            <div className="flex gap-2 pt-1">
              <Button
                onClick={async () => {
                  await onConfirmDimensions();
                  setExpanded(false);
                }}
                disabled={acceptedCount === 0}
                className="flex-1"
                size="sm"
              >
                {`Confirm & Generate Form (${acceptedCount})`}
              </Button>
            </div>
          )}

          {!hasUnsavedChanges && (
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => setExpanded(false)}
              >
                Collapse
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
