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
  severityConfig,
} from "@/components/workspace/DecisionCard";
import type { DesignProbe } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowDown,
  Ban,
  Check,
  Info,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeckItem =
  | { kind: "probe"; data: DesignProbe }
  | { kind: "conflict"; data: SchemaConflict };

const severityIcons = {
  error: Ban,
  warning: AlertTriangle,
  info: Info,
} as const;

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

  const pendingProbes = probes.filter(
    (o) => o.status === "pending" || o.status === "loading",
  );
  const resolvedProbes = probes.filter((o) => o.status === "resolved");

  const allPendingItems: DeckItem[] = [
    ...conflicts.map((c): DeckItem => ({ kind: "conflict", data: c })),
    ...pendingProbes.map((o): DeckItem => ({ kind: "probe", data: o })),
  ];

  const visibleItems = allPendingItems.slice(0, 3);
  const hiddenCount = allPendingItems.length - visibleItems.length;
  const resolvedCount = resolvedProbes.length;

  if (allPendingItems.length === 0 && resolvedCount === 0) return null;

  return (
    <div className="flex flex-col w-full gap-3">
      {/* Resolved stack */}
      {resolvedCount > 0 && (
        <div className="space-y-2 opacity-60 px-2">
          {resolvedCount > 0 && (
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
                    last.options.find(
                      (opt) => opt.value === last.selectedOption,
                    )?.label ?? last.selectedOption;
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
          )}
          <div className="flex justify-self-center opacity-40">
            <ArrowDown />
          </div>
        </div>
      )}

      {/* Pending cards — max 3 */}
      {visibleItems.map((item) => {
        if (item.kind === "conflict") {
          const conf = severityConfig[item.data.severity];
          const Icon = severityIcons[item.data.severity];
          return (
            <DecisionCard
              key={item.data.id}
              data-testid={`conflict-deck-card-${item.data.id}`}
              title={item.data.description}
              icon={<Icon className="h-3.5 w-3.5 shrink-0" />}
              accentColor={conf.color}
              bgTint={conf.bg}
              disabled={anyLoading}
              badges={
                <Badge
                  variant="outline"
                  className="text-[10px] w-fit text-muted-foreground"
                >
                  {item.data.kind.replace(/_/g, " ")}
                </Badge>
              }
            >
              <div className="flex flex-wrap gap-2">
                {item.data.fixes.map((fix) => (
                  <Button
                    key={fix.value}
                    variant="outline"
                    size="sm"
                    disabled={anyLoading}
                    onClick={() => onSelectConflictFix(item.data, fix)}
                    title={fix.description}
                  >
                    {fix.label}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={anyLoading}
                  onClick={() => onDismissConflict(item.data.id)}
                  className="text-muted-foreground"
                >
                  Dismiss
                </Button>
              </div>
            </DecisionCard>
          );
        }

        const o = item.data;
        return (
          <DecisionCard
            key={o.id}
            data-testid={`design-probe-deck-card-${o.id}`}
            title={o.text}
            accentColor={layerAccentColors[o.layer] ?? "border-gray-300"}
            description={o.explanation}
            disabled={o.status === "loading"}
            onDismiss={
              o.status === "pending" ? () => onDismissProbe(o.id) : undefined
            }
            badges={
              <>
                <LayerBadge layer={o.layer} />
                {o.dimensionName && <DimensionBadge name={o.dimensionName} />}
              </>
            }
          >
            <div className="flex flex-wrap gap-2">
              {o.options.map((option) => (
                <Button
                  key={option.value}
                  data-testid={`design-probe-option-${option.value}`}
                  variant={
                    o.selectedOption === option.value ? "default" : "outline"
                  }
                  size="sm"
                  disabled={o.status !== "pending" || anyLoading}
                  onClick={() => onSelectProbe(o.id, option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </DecisionCard>
        );
      })}

      <div className="flex flex-row gap-8 justify-center items-center">
        {hiddenCount > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            +{hiddenCount} more {hiddenCount === 1 ? "question" : "questions"}
          </p>
        )}
        {onRegenerate && (
          <div className="flex justify-end">
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
      </div>

      <DesignProbeResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedProbes={resolvedProbes}
      />
    </div>
  );
}
