"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DecisionCard,
  DimensionBadge,
  LayerBadge,
  layerAccentColors,
} from "@/components/workspace/DecisionCard";
import type { DesignProbe } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ArrowUp, Check, RotateCcw } from "lucide-react";
import React from "react";
import { ScrollFadeContainer } from "./ScrollFadeContainer";

interface DesignProbeResolvedDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  resolvedProbes: DesignProbe[];
  /**
   * Ask an answered question again: it goes back to the open questions,
   * where every answer shows what it would change before it is chosen.
   */
  onReopen?: (probeId: string) => void;
  /** A question is being reopened */
  isReopening?: boolean;
}

function formatTimeAgo(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const DesignProbeResolvedDialog = ({
  dialogOpen,
  setDialogOpen,
  resolvedProbes,
  onReopen,
  isReopening,
}: DesignProbeResolvedDialogProps) => {
  // Latest first by creation time
  const sortedProbes = [...resolvedProbes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-7xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Answered questions ({resolvedProbes.length})
          </DialogTitle>
        </DialogHeader>
        <ScrollFadeContainer>
          <div className="grid gap-2 mt-2">
            {sortedProbes.map((o, index) => {
              const editMeta = buildEditMeta(o);

              return (
                <React.Fragment key={o.id}>
                  <DecisionCard
                    title={o.text}
                    accentColor={
                      layerAccentColors[o.layer] ?? "border-gray-300"
                    }
                    badges={
                      <>
                        <LayerBadge layer={o.layer} />
                        {o.dimensionName && (
                          <DimensionBadge name={o.dimensionName} />
                        )}
                        {o.editCount > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            <RotateCcw className="h-2.5 w-2.5" aria-hidden />
                            asked again {o.editCount}x
                          </span>
                        )}
                      </>
                    }
                    description={
                      <>
                        {o.explanation}
                        {editMeta && (
                          <span className="block text-[10px] text-muted-foreground/60 mt-1">
                            {editMeta}
                          </span>
                        )}
                      </>
                    }
                  >
                    {
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {o.options.map((opt) => {
                            const isCustom =
                              o.selectedOption?.startsWith("custom:");
                            const isSelected =
                              !isCustom && opt.value === o.selectedOption;
                            const wasPrevious =
                              o.previousSelectedOption &&
                              opt.value === o.previousSelectedOption;

                            return (
                              <div
                                key={opt.value}
                                className={cn(
                                  "flex items-center gap-1 text-xs rounded-md px-2 py-1",
                                  isSelected
                                    ? "bg-green-50 border border-green-200 font-medium text-green-800"
                                    : wasPrevious
                                      ? "bg-amber-50/50 border border-amber-200/50 text-amber-700/70 line-through"
                                      : "bg-muted/40 border border-transparent text-muted-foreground line-through",
                                )}
                              >
                                {isSelected && (
                                  <Check className="h-3 w-3 text-green-600 shrink-0" />
                                )}
                                {opt.label}
                              </div>
                            );
                          })}
                          {o.selectedOption?.startsWith("custom:") && (
                            <div className="flex items-center gap-1 text-xs rounded-md px-2 py-1 bg-green-50 border border-green-200 font-medium text-green-800">
                              <Check className="h-3 w-3 text-green-600 shrink-0" />
                              {o.selectedOption.slice("custom:".length)}
                            </div>
                          )}
                        </div>
                        {onReopen && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isReopening}
                            title="Put this question back with the open questions, to answer it again"
                            className="h-6 px-2 text-[10px] text-muted-foreground/50 hover:text-foreground shrink-0"
                            onClick={() => onReopen(o.id)}
                          >
                            <RotateCcw className="h-3 w-3 mr-0.5" aria-hidden />
                            Ask again
                          </Button>
                        )}
                      </div>
                    }
                  </DecisionCard>
                  {index < resolvedProbes.length - 1 && (
                    <div className="flex justify-self-center opacity-15">
                      <ArrowUp className="h-4 w-4" />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </ScrollFadeContainer>
      </DialogContent>
    </Dialog>
  );
};

function buildEditMeta(probe: DesignProbe): string | null {
  if (probe.editedBy && probe.editCount > 0) {
    const ago = formatTimeAgo(probe.editedAt);
    const prevLabel = probe.previousSelectedOption
      ? ` (previous: ${probe.previousSelectedOption})`
      : "";
    return `Asked again by ${probe.editedBy}${ago ? ` ${ago}` : ""}${prevLabel}`;
  }
  if (probe.resolvedBy) {
    const ago = formatTimeAgo(probe.resolvedAt);
    return `Answered by ${probe.resolvedBy}${ago ? ` ${ago}` : ""}`;
  }
  return null;
}
