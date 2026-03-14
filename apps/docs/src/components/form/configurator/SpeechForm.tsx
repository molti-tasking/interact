"use client";

import type { OpinionInteraction } from "@/app/actions/opinion-actions";
import { OpinionSurfaceRenderer } from "@/components/a2ui/OpinionSurfaceRenderer";
import { Badge } from "@/components/ui/badge";
import { dimensionScopeColors } from "@/lib/dimension-types";
import { cn } from "@/lib/utils";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { useMemo } from "react";
import { SpeechFormEntry } from "./SpeechFormEntry";

export const SpeechForm = () => {
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );
  const dimensions = useConfiguratorStore((s) => s.dimensions);
  const a2uiOpinionStream = useConfiguratorStore((s) => s.a2uiOpinionStream);

  const dimColorByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of dimensions) {
      map.set(d.name.toLowerCase(), dimensionScopeColors[d.scope]);
    }
    return map;
  }, [dimensions]);

  const hasA2UIStream = !!a2uiOpinionStream;

  // A2UI is the primary rendering path
  if (hasA2UIStream) {
    return (
      <div className="flex flex-col gap-3">
        <OpinionSurfaceRenderer streamValue={a2uiOpinionStream} />
        {/* Show classic fallback cards below for any interactions not covered by the stream */}
        <ClassicOpinionCards
          interactions={opinionInteractions}
          dimColorByName={dimColorByName}
        />
      </div>
    );
  }

  // Fallback: classic rendering when no A2UI stream available
  return (
    <ClassicOpinionCards
      interactions={opinionInteractions}
      dimColorByName={dimColorByName}
    />
  );
};

/**
 * Classic SpeechFormEntry cards — used as fallback when no A2UI stream,
 * or for follow-up interactions that come from resolveOpinionInteractionAction.
 */
function ClassicOpinionCards({
  interactions,
  dimColorByName,
}: {
  interactions: OpinionInteraction[];
  dimColorByName: Map<string, string>;
}) {
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );

  if (!interactions || interactions.length === 0) return null;

  const visibleInteractions = interactions.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  );

  if (visibleInteractions.length === 0) return null;

  // Group by dimension
  const grouped = new Map<
    string | null,
    typeof visibleInteractions
  >();
  for (const interaction of visibleInteractions) {
    const key = interaction.dimensionName ?? null;
    const group = grouped.get(key) ?? [];
    group.push(interaction);
    grouped.set(key, group);
  }

  const dimensionGroups = Array.from(grouped.entries())
    .filter(([key]) => key !== null)
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""));
  const ungrouped = grouped.get(null) ?? [];

  return (
    <>
      {dimensionGroups.map(([dimensionName, ints]) => (
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
          <div className="flex flex-col gap-3">
            {ints.map((interaction) => (
              <SpeechFormEntry
                interaction={interaction}
                key={interaction.id}
                index={opinionInteractions.indexOf(interaction)}
              />
            ))}
          </div>
        </div>
      ))}

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
          <div className="flex flex-col gap-3">
            {ungrouped.map((interaction) => (
              <SpeechFormEntry
                interaction={interaction}
                key={interaction.id}
                index={opinionInteractions.indexOf(interaction)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
