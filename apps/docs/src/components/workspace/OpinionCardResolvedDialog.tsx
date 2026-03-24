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
import type { OpinionInteraction } from "@/lib/types";
import { ArrowDown, Check } from "lucide-react";
import React from "react";

interface OpinionCardResolvedDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  resolvedOpinions: OpinionInteraction[];
}

export const OpinionCardResolvedDialog = ({
  dialogOpen,
  setDialogOpen,
  resolvedOpinions,
}: OpinionCardResolvedDialogProps) => {
  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-w-5xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Resolved Decisions ({resolvedOpinions.length})
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 mt-2">
          {resolvedOpinions.map((o, index) => {
            const selectedLabel =
              o.options.find((opt) => opt.value === o.selectedOption)?.label ??
              o.selectedOption;
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
                {index < resolvedOpinions.length - 1 && (
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
