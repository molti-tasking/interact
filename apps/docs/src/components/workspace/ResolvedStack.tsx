"use client";

import { Badge } from "@/components/ui/badge";
import {
  DecisionCard,
  DimensionBadge,
  LayerBadge,
  layerAccentColors,
} from "@/components/workspace/DecisionCard";
import type { DesignProbe } from "@/lib/types";
import { Check } from "lucide-react";

interface ResolvedStackProps {
  resolvedProbes: DesignProbe[];
  onViewAll: () => void;
}

export function ResolvedStack({
  resolvedProbes,
  onViewAll,
}: ResolvedStackProps) {
  const count = resolvedProbes.length;
  if (count === 0) return null;

  const last = resolvedProbes[count - 1];
  if (!last) return null;

  const selectedLabel = last.selectedOption?.startsWith("custom:")
    ? last.selectedOption.slice("custom:".length)
    : last.options.find((opt) => opt.value === last.selectedOption)?.label ??
      last.selectedOption;

  return (
    <div className="space-y-2 opacity-50 hover:opacity-70 transition-opacity duration-300 px-2">
      <button
        type="button"
        onClick={onViewAll}
        className="w-full text-left group cursor-pointer"
      >
        <div
          className="relative transition-transform duration-200 group-hover:scale-[1.02]"
          style={{ paddingTop: Math.min(count - 1, 2) * 6 }}
        >
          {count >= 3 && (
            <div className="absolute top-0 left-1 right-1 h-10 rounded-xl border border-green-200 bg-green-50/30 transition-transform duration-200 origin-bottom group-hover:-rotate-1" />
          )}
          {count >= 2 && (
            <div
              className="absolute left-0.5 right-0.5 h-10 rounded-xl border border-green-200 bg-green-50/50"
              style={{ top: Math.min(count - 1, 2) >= 2 ? 6 : 0 }}
            />
          )}
          <DecisionCard
            title={last.text}
            accentColor={layerAccentColors[last.layer] ?? "border-gray-300"}
            className="relative transition-transform duration-200 origin-bottom group-hover:rotate-1"
            badges={
              <>
                <LayerBadge layer={last.layer} />
                {last.dimensionName && (
                  <DimensionBadge name={last.dimensionName} />
                )}
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  {count} resolved
                </Badge>
              </>
            }
          >
            <div className="flex items-center gap-1.5 text-xs bg-green-50 rounded-md px-2.5 py-1.5 font-sans">
              <Check className="h-3 w-3 text-green-600 shrink-0" />
              <span className="font-medium text-green-800">
                {selectedLabel}
              </span>
            </div>
          </DecisionCard>
        </div>
      </button>
      {/* <div className="flex justify-self-center opacity-40">
        <ArrowDown />
      </div> */}
    </div>
  );
}
