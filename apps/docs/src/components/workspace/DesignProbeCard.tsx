"use client";

import { Button } from "@/components/ui/button";
import {
  DecisionCard,
  DimensionBadge,
  LayerBadge,
  layerAccentColors,
} from "@/components/workspace/DecisionCard";
import { DesignProbeDetailDialog } from "@/components/workspace/DesignProbeDetailDialog";
import { Loader2, Maximize2 } from "lucide-react";
import { useState } from "react";

export interface CardItem {
  id: string;
  text: string;
  explanation?: string;
  layer?: string;
  dimensionName?: string | null;
  options: { value: string; label: string; description?: string }[];
  status: "pending" | "loading" | "resolved" | "dismissed";
  onSelect: (value: string) => void;
  onDismiss: () => void;
}

interface DesignProbeCardProps {
  item: CardItem;
  /** This card's answer is being applied */
  busy: boolean;
}

export function DesignProbeCard({ item, busy }: DesignProbeCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <>
      <DecisionCard
        data-testid={`deck-card-${item.id}`}
        data-status={item.status}
        title={item.text}
        accentColor={
          item.layer
            ? (layerAccentColors[item.layer] ?? "border-gray-300")
            : "border-gray-300"
        }
        description={item.explanation}
        disabled={item.status === "loading" || busy}
        onDismiss={item.status === "pending" ? item.onDismiss : undefined}
        onClick={() => {
          if (item.status === "pending" && !busy) setDetailOpen(true);
        }}
        className={
          item.status === "pending" && !busy ? "cursor-pointer" : undefined
        }
        badges={
          <>
            {item.layer && <LayerBadge layer={item.layer} />}
            {item.dimensionName && <DimensionBadge name={item.dimensionName} />}
          </>
        }
      >
        <div className="flex items-center gap-2">
          <div className="flex flex-wrap gap-1.5 flex-1">
            {item.options.map((option) => (
              <Button
                key={option.value}
                data-testid={`deck-option-${option.value}`}
                variant="outline"
                size="sm"
                disabled={item.status !== "pending" || busy}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onSelect(option.value);
                }}
                title={option.description}
                className="text-xs shadow-none hover:shadow-sm transition-shadow"
              >
                {option.label}
              </Button>
            ))}
          </div>
          {busy && (
            <span
              role="status"
              className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Applying…
            </span>
          )}
          {item.status === "pending" && !busy && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setDetailOpen(true);
              }}
              title="Expand for more details"
              aria-label={`More details: ${item.text}`}
            >
              <Maximize2 className="h-3 w-3" aria-hidden />
            </Button>
          )}
        </div>
      </DecisionCard>

      <DesignProbeDetailDialog
        item={item}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        busy={busy}
      />
    </>
  );
}
