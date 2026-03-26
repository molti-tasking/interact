"use client";

import type {
  ConflictFix,
  SchemaConflict,
} from "@/app/actions/conflict-actions";
import type { CardItem } from "@/components/workspace/DesignProbeCard";
import { ResolvedStack } from "@/components/workspace/ResolvedStack";
import type { DesignProbe } from "@/lib/types";
import { useState } from "react";
import { DesignProbeResolvedDialog } from "./DesignProbeResolvedDialog";

// ---------------------------------------------------------------------------
// Normalize conflicts + probes into a unified CardItem list
// ---------------------------------------------------------------------------

function normalizeItems(
  probes: DesignProbe[],
  conflicts: SchemaConflict[],
  onSelectProbe: (probeId: string, value: string) => void,
  onDismissProbe: (probeId: string) => void,
  onSelectConflictFix: (conflict: SchemaConflict, fix: ConflictFix) => void,
  onDismissConflict: (conflictId: string) => void,
): CardItem[] {
  const probeItems: CardItem[] = probes
    .filter((o) => o.status === "pending" || o.status === "loading")
    .map((o) => ({
      id: o.id,
      text: o.text,
      explanation: o.explanation,
      layer: o.layer,
      dimensionName: o.dimensionName,
      options: o.options,
      status: o.status as "pending" | "loading",
      onSelect: (value: string) => onSelectProbe(o.id, value),
      onDismiss: () => onDismissProbe(o.id),
    }));

  const conflictItems: CardItem[] = conflicts.map((c) => ({
    id: c.id,
    text: c.description,
    options: c.fixes.map((f) => ({
      value: f.value,
      label: f.label,
      description: f.description,
    })),
    status: "pending" as const,
    onSelect: (value: string) => {
      const fix = c.fixes.find((f) => f.value === value);
      if (fix) onSelectConflictFix(c, fix);
    },
    onDismiss: () => onDismissConflict(c.id),
  }));

  return [...conflictItems, ...probeItems];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DesignProbeStackResolved({
  probes,
  conflicts,
  onSelectProbe,
  onDismissProbe,
  onSelectConflictFix,
  onDismissConflict,
}: {
  probes: DesignProbe[];
  conflicts: SchemaConflict[];
  onSelectProbe: (probeId: string, value: string) => void;
  onDismissProbe: (probeId: string) => void;
  onSelectConflictFix: (conflict: SchemaConflict, fix: ConflictFix) => void;
  onDismissConflict: (conflictId: string) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const items = normalizeItems(
    probes,
    conflicts,
    onSelectProbe,
    onDismissProbe,
    onSelectConflictFix,
    onDismissConflict,
  );

  // Resolved probes in chronological order (oldest first) for the history stack
  const resolvedProbes = [
    ...probes.filter((o) => o.status === "resolved"),
  ].reverse();

  if (items.length === 0 && resolvedProbes.length === 0) return null;

  return (
    <div className="flex flex-col w-full gap-3">
      <ResolvedStack
        resolvedProbes={resolvedProbes}
        onViewAll={() => setDialogOpen(true)}
      />

      <DesignProbeResolvedDialog
        dialogOpen={dialogOpen}
        setDialogOpen={setDialogOpen}
        resolvedProbes={resolvedProbes}
      />
    </div>
  );
}
