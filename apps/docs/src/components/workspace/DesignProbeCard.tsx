"use client";

import { Button } from "@/components/ui/button";
import {
  DecisionCard,
  DimensionBadge,
  LayerBadge,
  layerAccentColors,
} from "@/components/workspace/DecisionCard";

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
  anyLoading: boolean;
}

export function DesignProbeCard({ item, anyLoading }: DesignProbeCardProps) {
  return (
    <DecisionCard
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
          {item.dimensionName && <DimensionBadge name={item.dimensionName} />}
          {/* <DimensionBadge name={item.status} /> */}
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
  );
}
