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
import { ArrowDown, Check } from "lucide-react";
import React from "react";

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
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Resolved Decisions ({resolvedProbes.length})
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 mt-2">
          {resolvedProbes.map((o, index) => {
            return (
              <React.Fragment key={o.id}>
                <DecisionCard
                  title={o.text}
                  accentColor={layerAccentColors[o.layer] ?? "border-gray-300"}
                  badges={
                    <>
                      <LayerBadge layer={o.layer} />
                      {o.dimensionName && (
                        <DimensionBadge name={o.dimensionName} />
                      )}
                      {/* <DimensionBadge name={o.status} /> */}
                    </>
                  }
                  description={o.explanation}
                >
                  <div className="flex flex-wrap gap-2">
                    {o.options.map((opt) => {
                      const isSelected = opt.value === o.selectedOption;
                      return (
                        <div
                          key={opt.value}
                          className={
                            isSelected
                              ? "flex items-center gap-1.5 text-sm bg-green-50 border border-green-200 rounded-md px-3 py-1.5 font-medium text-green-800"
                              : "flex items-center gap-1.5 text-sm bg-muted/40 border border-transparent rounded-md px-3 py-1.5 text-muted-foreground line-through"
                          }
                        >
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          )}
                          {opt.label}
                        </div>
                      );
                    })}
                  </div>
                </DecisionCard>
                {index < resolvedProbes.length - 1 && (
                  <div className="flex justify-self-center opacity-20">
                    <ArrowDown />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
