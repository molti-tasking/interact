"use client";

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
import { ArrowDown, Check } from "lucide-react";
import React from "react";
import { ScrollFadeContainer } from "./ScrollFadeContainer";

interface DesignProbeResolvedDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  resolvedProbes: DesignProbe[];
}

export const DesignProbeResolvedDialog = ({
  dialogOpen,
  setDialogOpen,
  resolvedProbes,
}: DesignProbeResolvedDialogProps) => {
  // TODO these cards have to displayed chronologically! We maybe have to add a trigger setting a "answered_at" field, whenever it has been changed.
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-7xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Resolved Design Probes ({resolvedProbes.length})
          </DialogTitle>
        </DialogHeader>
        <ScrollFadeContainer>
          <div className="grid gap-2 mt-2">
            {resolvedProbes.map((o, index) => {
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
                      </>
                    }
                    description={o.explanation}
                  >
                    <div className="flex flex-wrap gap-1.5">
                      {o.options.map((opt) => {
                        const isCustom =
                          o.selectedOption?.startsWith("custom:");
                        const isSelected =
                          !isCustom && opt.value === o.selectedOption;
                        return (
                          <div
                            key={opt.value}
                            className={cn(
                              "flex items-center gap-1 text-xs rounded-md px-2 py-1 font-sans",
                              isSelected
                                ? "bg-green-50 border border-green-200 font-medium text-green-800"
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
                        <div className="flex items-center gap-1 text-xs rounded-md px-2 py-1 font-sans bg-green-50 border border-green-200 font-medium text-green-800">
                          <Check className="h-3 w-3 text-green-600 shrink-0" />
                          {o.selectedOption.slice("custom:".length)}
                        </div>
                      )}
                    </div>
                  </DecisionCard>
                  {index < resolvedProbes.length - 1 && (
                    <div className="flex justify-self-center opacity-15">
                      <ArrowDown className="h-4 w-4" />
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
