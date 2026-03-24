"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OpinionInteraction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Layers, RefreshCw, X } from "lucide-react";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Layer colors
// ---------------------------------------------------------------------------

const layerBorder: Record<string, string> = {
  intent: "border-l-blue-400",
  dimensions: "border-l-violet-400",
  both: "border-l-amber-400",
};

const layerBadge: Record<string, string> = {
  intent: "text-blue-600 border-blue-200",
  dimensions: "text-violet-600 border-violet-200",
  both: "text-amber-600 border-amber-200",
};

// ---------------------------------------------------------------------------
// OpinionCardDeck
// ---------------------------------------------------------------------------

export function OpinionCardDeck({
  opinions,
  anyLoading,
  isRegenerating,
  onSelect,
  onDismiss,
  onRegenerate,
}: {
  opinions: OpinionInteraction[];
  anyLoading: boolean;
  isRegenerating?: boolean;
  onSelect: (index: number, value: string) => void;
  onDismiss: (index: number) => void;
  onRegenerate?: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const pending = opinions.filter(
    (o) => o.status === "pending" || o.status === "loading",
  );
  const resolved = opinions.filter((o) => o.status === "resolved");

  // Show max 3 unanswered cards
  const visible = pending.slice(0, 3);
  const hiddenCount = pending.length - visible.length;

  if (pending.length === 0 && resolved.length === 0) return null;

  return (
    <div className="flex flex-col w-full gap-3">
      {/* --- Unanswered card stack --- */}
      {visible.length > 0 && (
        <div
          className="relative w-full"
          // Reserve space for stack offset: top card + offset for cards behind
          style={{
            paddingTop: Math.min(visible.length - 1, 2) * 8,
          }}
        >
          {/* Background cards (max 2 behind the top) */}
          {visible
            .slice(1)
            .reverse()
            .map((interaction, reverseIdx) => {
              // stackPos: 1 = directly behind top, 2 = furthest back
              const stackPos =
                visible.slice(1).length - reverseIdx;
              return (
                <motion.div
                  key={interaction.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{
                    opacity: 0.5 - stackPos * 0.12,
                    y: -(stackPos * 8),
                    scale: 1 - stackPos * 0.025,
                  }}
                  className="absolute inset-x-0 bottom-0 pointer-events-none origin-bottom"
                  style={{ zIndex: 10 - stackPos }}
                >
                  <Card
                    className={cn(
                      "border-l-4 border-l-gray-300",
                    )}
                  >
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm font-medium text-muted-foreground truncate">
                        {interaction.text}
                      </CardTitle>
                    </CardHeader>
                    {/* Fixed spacer for consistent card height */}
                    <div className="h-10" />
                  </Card>
                </motion.div>
              );
            })}

          {/* Top card — fully interactive */}
          <AnimatePresence mode="popLayout">
            <motion.div
              key={visible[0].id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -60, scale: 0.92, rotate: -4 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative"
              style={{ zIndex: 10 }}
            >
              <ActiveOpinionCard
                interaction={visible[0]}
                index={0}
                anyLoading={anyLoading}
                onSelect={onSelect}
                onDismiss={onDismiss}
              />
            </motion.div>
          </AnimatePresence>

          {hiddenCount > 0 && (
            <p className="text-center text-xs text-muted-foreground mt-1">
              +{hiddenCount} more{" "}
              {hiddenCount === 1 ? "question" : "questions"}
            </p>
          )}
        </div>
      )}

      {/* --- Resolved stack + regenerate --- */}
      <div className="flex items-center gap-2">
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors py-2 px-3 rounded-lg border border-dashed hover:border-solid hover:bg-muted/30 flex-1"
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="font-semibold">{resolved.length}</span>
            <span>resolved — tap to review</span>
          </button>
        )}

        {onRegenerate && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={anyLoading || isRegenerating}
            className="text-xs text-muted-foreground shrink-0"
            title="Generate new refinement questions"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 mr-1",
                isRegenerating && "animate-spin",
              )}
            />
            {isRegenerating ? "Generating..." : "New questions"}
          </Button>
        )}
      </div>

      {/* --- Resolved dialog (grid) --- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Resolved Decisions ({resolved.length})
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {resolved.map((o) => {
              const chosenLabel =
                o.options.find((opt) => opt.value === o.selectedOption)
                  ?.label ?? o.selectedOption;
              return (
                <Card
                  key={o.id}
                  className={cn(
                    "border-l-4",
                    layerBorder[o.layer] ?? "border-l-gray-300",
                  )}
                >
                  <CardHeader className="pb-2 pt-3">
                    <CardTitle className="text-sm font-medium">
                      {o.text}
                    </CardTitle>
                    <div className="flex gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] w-fit",
                          layerBadge[o.layer],
                        )}
                      >
                        {o.layer}
                      </Badge>
                      {o.dimensionName && (
                        <Badge
                          variant="outline"
                          className="text-[10px] w-fit"
                        >
                          {o.dimensionName}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex items-center gap-2 text-sm bg-green-50 rounded-md px-3 py-2">
                      <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="font-medium text-green-800">
                        {chosenLabel}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active (top) card
// ---------------------------------------------------------------------------

function ActiveOpinionCard({
  interaction,
  index,
  anyLoading,
  onSelect,
  onDismiss,
}: {
  interaction: OpinionInteraction;
  index: number;
  anyLoading: boolean;
  onSelect: (index: number, value: string) => void;
  onDismiss: (index: number) => void;
}) {
  return (
    <Card
      data-testid={`opinion-deck-card-${index}`}
      className={cn(
        "border-l-4",
        layerBorder[interaction.layer] ?? "border-l-gray-300",
        interaction.status === "loading" && "opacity-60",
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">
            {interaction.text}
          </CardTitle>
          {interaction.status === "pending" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onDismiss(index)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {interaction.explanation && (
          <p className="text-xs text-muted-foreground">
            {interaction.explanation}
          </p>
        )}
        <div className="flex gap-1.5">
          <Badge
            variant="outline"
            className={cn("text-[10px] w-fit", layerBadge[interaction.layer])}
          >
            {interaction.layer}
          </Badge>
          {interaction.dimensionName && (
            <Badge variant="outline" className="text-[10px] w-fit">
              {interaction.dimensionName}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {interaction.options.map((option) => (
            <Button
              key={option.value}
              data-testid={`opinion-option-${option.value}`}
              variant={
                interaction.selectedOption === option.value
                  ? "default"
                  : "outline"
              }
              size="sm"
              disabled={interaction.status !== "pending" || anyLoading}
              onClick={() => onSelect(index, option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
