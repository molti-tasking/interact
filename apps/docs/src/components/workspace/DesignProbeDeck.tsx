"use client";

import type {
  ConflictFix,
  SchemaConflict,
} from "@/app/actions/conflict-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DecisionCard,
  DimensionBadge,
  LayerBadge,
  layerAccentColors,
} from "@/components/workspace/DecisionCard";
import type { DesignProbe } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrowDown, Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";

// ---------------------------------------------------------------------------
// Unified card item — conflicts are normalized into the same shape as probes
// ---------------------------------------------------------------------------

interface CardItem {
  id: string;
  text: string;
  explanation?: string;
  layer?: string;
  dimensionName?: string | null;
  options: { value: string; label: string; description?: string }[];
  status: "pending" | "loading";
  onSelect: (value: string) => void;
  onDismiss: () => void;
}

function normalizeItems(
  probes: DesignProbe[],
  conflicts: SchemaConflict[],
  onSelectProbe: (probeId: string, value: string) => void,
  onDismissProbe: (probeId: string) => void,
  onSelectConflictFix: (conflict: SchemaConflict, fix: ConflictFix) => void,
  onDismissConflict: (conflictId: string) => void,
): CardItem[] {
  const probeItems: CardItem[] = probes
    .filter((o) => o.status === "pending" || o.status === "loading")
    .map((o) => ({
      id: o.id,
      text: o.text,
      explanation: o.explanation,
      layer: o.layer,
      dimensionName: o.dimensionName,
      options: o.options,
      status: o.status as "pending" | "loading",
      onSelect: (value: string) => onSelectProbe(o.id, value),
      onDismiss: () => onDismissProbe(o.id),
    }));

  const conflictItems: CardItem[] = conflicts.map((c) => ({
    id: c.id,
    text: c.description,
    options: c.fixes.map((f) => ({
      value: f.value,
      label: f.label,
      description: f.description,
    })),
    status: "pending" as const,
    onSelect: (value: string) => {
      const fix = c.fixes.find((f) => f.value === value);
      if (fix) onSelectConflictFix(c, fix);
    },
    onDismiss: () => onDismissConflict(c.id),
  }));

  return [...conflictItems, ...probeItems];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DesignProbeDeck({
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  // Re-check scroll state when items change
  useEffect(() => {
    // Defer to next frame so the DOM has updated
    requestAnimationFrame(updateScrollState);
  });

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
  const resolvedCount = resolvedProbes.length;

  if (items.length === 0 && resolvedCount === 0) return null;

  return (
    <div className="flex flex-col w-full gap-3">
      {/* Resolved stack */}
      {resolvedCount > 0 && (
        <div className="space-y-2 opacity-60 px-2">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="w-full text-left group cursor-pointer"
          >
            <div
              className="relative transition-transform duration-200 group-hover:scale-[1.02]"
              style={{
                paddingTop: Math.min(resolvedCount - 1, 2) * 6,
              }}
            >
              {resolvedCount >= 3 && (
                <div className="absolute top-0 left-1 right-1 h-10 rounded-xl border border-green-200 bg-green-50/30 transition-transform duration-200 origin-bottom group-hover:-rotate-1" />
              )}
              {resolvedCount >= 2 && (
                <div
                  className="absolute left-0.5 right-0.5 h-10 rounded-xl border border-green-200 bg-green-50/50"
                  style={{
                    top: Math.min(resolvedCount - 1, 2) >= 2 ? 6 : 0,
                  }}
                />
              )}
              {(() => {
                const last = resolvedProbes[resolvedProbes.length - 1];
                if (!last) return null;
                const selectedLabel =
                  last.options.find((opt) => opt.value === last.selectedOption)
                    ?.label ?? last.selectedOption;
                return (
                  <DecisionCard
                    title={last.text}
                    accentColor={
                      layerAccentColors[last.layer] ?? "border-gray-300"
                    }
                    className="relative transition-transform duration-200 origin-bottom group-hover:rotate-1"
                    badges={
                      <>
                        <LayerBadge layer={last.layer} />
                        {last.dimensionName && (
                          <DimensionBadge name={last.dimensionName} />
                        )}
                        <Badge
                          variant="secondary"
                          className="text-[10px] ml-auto"
                        >
                          {resolvedCount} resolved
                        </Badge>
                      </>
                    }
                  >
                    <div className="flex items-center gap-2 text-sm bg-green-50 rounded-md px-3 py-2">
                      <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="font-medium text-green-800">
                        {selectedLabel}
                      </span>
                    </div>
                  </DecisionCard>
                );
              })()}
            </div>
          </button>
          <div className="flex justify-self-center opacity-40">
            <ArrowDown />
          </div>
        </div>
      )}

      {/* All pending cards — scrollable with directional fades */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateScrollState}
          className="flex flex-col gap-3 overflow-y-auto max-h-[60vh] pr-1 py-2"
        >
          {items.map((item) => (
            <DecisionCard
              key={item.id}
              data-testid={`deck-card-${item.id}`}
              title={item.text}
              accentColor={
                item.layer
                  ? (layerAccentColors[item.layer] ?? "border-gray-300")
                  : "border-gray-300"
              }
              description={item.explanation}
              disabled={item.status === "loading" || anyLoading}
              onDismiss={item.status === "pending" ? item.onDismiss : undefined}
              badges={
                <>
                  {item.layer && <LayerBadge layer={item.layer} />}
                  {item.dimensionName && (
                    <DimensionBadge name={item.dimensionName} />
                  )}
                </>
              }
            >
              <div className="flex flex-wrap gap-2">
                {item.options.map((option) => (
                  <Button
                    key={option.value}
                    data-testid={`deck-option-${option.value}`}
                    variant="outline"
                    size="sm"
                    disabled={item.status !== "pending" || anyLoading}
                    onClick={() => item.onSelect(option.value)}
                    title={option.description}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </DecisionCard>
          ))}
        </div>
        {canScrollUp && (
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-16 bg-linear-to-b from-background to-transparent z-10" />
        )}
        {canScrollDown && (
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-linear-to-t from-background to-transparent z-10" />
        )}
      </div>

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
