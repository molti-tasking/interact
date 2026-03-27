"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  DimensionBadge,
  LayerBadge,
} from "@/components/workspace/DecisionCard";
import type { CardItem } from "@/components/workspace/DesignProbeCard";
import { cn } from "@/lib/utils";
import { Check, Pen } from "lucide-react";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface DesignProbeDetailDialogProps {
  item: CardItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anyLoading: boolean;
}

export function DesignProbeDetailDialog({
  item,
  open,
  onOpenChange,
  anyLoading,
}: DesignProbeDetailDialogProps) {
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customAnswer, setCustomAnswer] = useState("");

  const disabled = item.status !== "pending" || anyLoading;

  const handleConfirm = () => {
    if (showCustom && customAnswer.trim()) {
      item.onSelect(`custom:${customAnswer.trim()}`);
    } else if (selectedValue) {
      item.onSelect(selectedValue);
    }
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSelectedValue(null);
      setShowCustom(false);
      setCustomAnswer("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap gap-1.5 mb-1">
            {item.layer && <LayerBadge layer={item.layer} />}
            {item.dimensionName && (
              <DimensionBadge name={item.dimensionName} />
            )}
          </div>
          <DialogTitle className="text-base">{item.text}</DialogTitle>
          {item.explanation && (
            <DialogDescription>{item.explanation}</DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-2">
          {item.options.map((option) => {
            const isSelected = selectedValue === option.value && !showCustom;
            return (
              <button
                key={option.value}
                type="button"
                disabled={disabled}
                onClick={() => {
                  setSelectedValue(option.value);
                  setShowCustom(false);
                }}
                className={cn(
                  "text-left rounded-lg border p-3 transition-colors",
                  isSelected
                    ? "border-foreground/30 bg-accent"
                    : "border-border hover:border-foreground/20 hover:bg-accent/50",
                  disabled && "opacity-50 pointer-events-none",
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                      isSelected
                        ? "border-foreground bg-foreground"
                        : "border-muted-foreground/30",
                    )}
                  >
                    {isSelected && (
                      <Check className="h-2.5 w-2.5 text-background" />
                    )}
                  </div>
                  <span className="text-sm font-medium">{option.label}</span>
                </div>
              </button>
            );
          })}

          {/* Custom answer toggle */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setShowCustom(true);
              setSelectedValue(null);
            }}
            className={cn(
              "text-left rounded-lg border border-dashed p-3 transition-colors",
              showCustom
                ? "border-foreground/30 bg-accent"
                : "border-border hover:border-foreground/20 hover:bg-accent/50",
              disabled && "opacity-50 pointer-events-none",
            )}
          >
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors",
                  showCustom
                    ? "border-foreground bg-foreground"
                    : "border-muted-foreground/30",
                )}
              >
                {showCustom && (
                  <Pen className="h-2 w-2 text-background" />
                )}
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                Write a custom answer
              </span>
            </div>
          </button>

          {showCustom && (
            <Textarea
              autoFocus
              placeholder="Describe your preferred approach..."
              value={customAnswer}
              onChange={(e) => setCustomAnswer(e.target.value)}
              rows={3}
              className="text-sm"
            />
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              disabled ||
              (!selectedValue && !(showCustom && customAnswer.trim()))
            }
            onClick={handleConfirm}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
