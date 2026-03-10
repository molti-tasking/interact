"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dimensionTypeColors } from "@/lib/dimension-types";
import { cn } from "@/lib/utils";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { LayoutGrid, List } from "lucide-react";
import { useMemo, useState } from "react";
import { SpeechFormEntry } from "./SpeechFormEntry";

type ViewMode = "list" | "grid";

export const SpeechForm = () => {
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );
  const dimensions = useConfiguratorStore((s) => s.dimensions);
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // Build a lookup from dimension name → type color
  const dimColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of dimensions) {
      map.set(d.name.toLowerCase(), dimensionTypeColors[d.type]);
    }
    return map;
  }, [dimensions]);

  if (!opinionInteractions || opinionInteractions.length === 0) {
    return null;
  }

  const visibleInteractions = opinionInteractions.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  );

  if (visibleInteractions.length === 0) return null;

  // Group by dimension
  const grouped = new Map<string | null, typeof visibleInteractions>();
  for (const interaction of visibleInteractions) {
    const key = interaction.dimensionName ?? null;
    const group = grouped.get(key) ?? [];
    group.push(interaction);
    grouped.set(key, group);
  }

  // Dimension-linked groups first, then ungrouped
  const dimensionGroups = Array.from(grouped.entries())
    .filter(([key]) => key !== null)
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""));
  const ungrouped = grouped.get(null) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {visibleInteractions.length} interaction
          {visibleInteractions.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-1">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Dimension-grouped opinions */}
      {dimensionGroups.map(([dimensionName, interactions]) => (
        <div key={dimensionName} className="space-y-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              dimColorByName.get(dimensionName?.toLowerCase() ?? "") ??
                "text-muted-foreground",
            )}
          >
            {dimensionName}
          </Badge>
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-2 gap-3"
                : "flex flex-col gap-3"
            }
          >
            {interactions.map((interaction) => (
              <SpeechFormEntry
                interaction={interaction}
                key={interaction.id}
                index={opinionInteractions.indexOf(interaction)}
                compact={viewMode === "grid"}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Ungrouped (general) opinions */}
      {ungrouped.length > 0 && (
        <div className="space-y-2">
          {dimensionGroups.length > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] text-muted-foreground"
            >
              General
            </Badge>
          )}
          <div
            className={
              viewMode === "grid"
                ? "grid grid-cols-2 gap-3"
                : "flex flex-col gap-3"
            }
          >
            {ungrouped.map((interaction) => (
              <SpeechFormEntry
                interaction={interaction}
                key={interaction.id}
                index={opinionInteractions.indexOf(interaction)}
                compact={viewMode === "grid"}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
