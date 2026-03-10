"use client";

import { Button } from "@/components/ui/button";
import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { LayoutGrid, List } from "lucide-react";
import { useState } from "react";
import { SpeechFormEntry } from "./SpeechFormEntry";

type ViewMode = "list" | "grid";

export const SpeechForm = () => {
  const opinionInteractions = useConfiguratorStore(
    (s) => s.opinionInteractions,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  if (!opinionInteractions || opinionInteractions.length === 0) {
    return null;
  }

  const visibleInteractions = opinionInteractions.filter(
    (i) => i.status !== "resolved" && i.status !== "dismissed",
  );

  if (visibleInteractions.length === 0) return null;

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
      <div
        className={
          viewMode === "grid"
            ? "grid grid-cols-2 gap-3"
            : "flex flex-col gap-3"
        }
      >
        {visibleInteractions.map((interaction) => (
          <SpeechFormEntry
            interaction={interaction}
            key={interaction.id}
            index={opinionInteractions.indexOf(interaction)}
            compact={viewMode === "grid"}
          />
        ))}
      </div>
    </div>
  );
};
