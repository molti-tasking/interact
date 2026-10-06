"use client";

import type { SchemaConflict } from "@/app/actions/conflict-actions";
import {
  applyConflictChanges,
  type ConflictFixPreview,
} from "@/lib/engine/conflict-changes";
import type { PortfolioSchema } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import type { ProbePreview } from "./deck-canvas-context";
import {
  CardStatus,
  CollapsedRow,
  DismissButton,
  OptionTile,
} from "./ProbeCard";

const KIND_LABELS: Record<SchemaConflict["kind"], string> = {
  duplicate_fields: "Duplicate fields",
  type_mismatch: "Type mismatch",
  missing_required: "Should be required",
  contradictory_constraints: "Contradictory rules",
  orphaned_group: "Broken group",
  semantic_overlap: "Overlapping fields",
  naming_inconsistency: "Inconsistent naming",
};

export function conflictKindLabel(kind: SchemaConflict["kind"]): string {
  return KIND_LABELS[kind] ?? "Conflict";
}

const severityStyles: Record<
  SchemaConflict["severity"],
  { label: string; icon: string; border: string; chip: string }
> = {
  error: {
    label: "Error",
    icon: "text-red-600 dark:text-red-400",
    border: "border-l-red-500",
    chip: "bg-red-500/10 text-red-700 dark:text-red-300",
  },
  warning: {
    label: "Warning",
    icon: "text-amber-600 dark:text-amber-400",
    border: "border-l-amber-500",
    chip: "bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  info: {
    label: "Suggestion",
    icon: "text-sky-600 dark:text-sky-400",
    border: "border-l-sky-500",
    chip: "bg-sky-500/10 text-sky-800 dark:text-sky-300",
  },
};

interface ConflictCardProps {
  conflict: SchemaConflict;
  expanded: boolean;
  onExpand: () => void;
  /** A fix is being applied */
  busy: boolean;
  /** Current schema — previews are diffed against it */
  schema: PortfolioSchema;
  previewStatus: "pending" | "ready" | "failed";
  /** Fix value → what it would change */
  previews: Record<string, ConflictFixPreview>;
  onSelect: (fixValue: string) => void;
  onDismiss: () => void;
  onRetryPreview: () => void;
}

/**
 * A detected schema conflict in the deck. It names the problem and the
 * fields involved (which are also marked on the canvas), and offers fixes
 * that preview on hover and apply on click, like probe answers.
 */
export function ConflictCard({
  conflict,
  expanded,
  onExpand,
  busy,
  schema,
  previewStatus,
  previews,
  onSelect,
  onDismiss,
  onRetryPreview,
}: ConflictCardProps) {
  const [armed, setArmed] = useState<string | null>(null);
  const style = severityStyles[conflict.severity] ?? severityStyles.warning;
  const kindLabel = conflictKindLabel(conflict.kind);
  const pending = previewStatus === "pending";

  const fixPreviews = useMemo(
    () =>
      new Map(
        conflict.fixes.map((fix) => {
          const preview = previews[fix.value];
          if (!preview) return [fix.value, null];
          return [
            fix.value,
            {
              ownerId: conflict.id,
              optionValue: fix.value,
              label: fix.label,
              summary: preview.summary,
              apply: (s: PortfolioSchema) =>
                applyConflictChanges(s, preview.changes).schema,
            } satisfies ProbePreview,
          ];
        }),
      ),
    [conflict.id, conflict.fixes, previews],
  );

  const icon = (className?: string) => (
    <TriangleAlert
      className={cn("h-3.5 w-3.5 shrink-0", style.icon, className)}
      aria-label={`${style.label}: ${kindLabel}`}
    />
  );

  if (!expanded) {
    return (
      <CollapsedRow
        testId={`deck-card-${conflict.id}`}
        status="pending"
        leading={icon()}
        title={conflict.description}
        pending={pending}
        onExpand={onExpand}
      />
    );
  }

  const fieldsById = new Map(schema.fields.map((f) => [f.id, f]));
  const affected = conflict.fieldIds
    .map((id) => fieldsById.get(id))
    .filter((f) => !!f);

  return (
    <div
      data-testid={`deck-card-${conflict.id}`}
      data-status="pending"
      data-expanded="true"
      data-conflict={conflict.severity}
      aria-busy={busy || undefined}
      className={cn(
        "rounded-xl border border-l-4 bg-card shadow-sm",
        style.border,
      )}
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        {icon("mt-0.5 h-4 w-4")}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[11px] font-medium uppercase tracking-wide",
              style.icon,
            )}
          >
            {kindLabel}
          </p>
          <h4 className="text-sm font-medium leading-snug">
            {conflict.description}
          </h4>
          {affected.length > 0 && (
            <ul
              aria-label="Fields involved"
              className="mt-1.5 flex flex-wrap gap-1"
            >
              {affected.map((field) => (
                <li
                  key={field.id}
                  className={cn(
                    "max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-medium",
                    style.chip,
                  )}
                >
                  {field.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <DismissButton
          label={`Ignore: ${conflict.description}`}
          title="Ignore this conflict"
          disabled={busy}
          onClick={onDismiss}
        />
      </div>

      <div className="grid gap-1.5 p-2.5">
        {conflict.fixes.map((fix) => (
          <OptionTile
            key={fix.value}
            value={fix.value}
            label={fix.label}
            preview={fixPreviews.get(fix.value) ?? null}
            schema={schema}
            pending={pending}
            disabled={busy}
            armed={armed === fix.value}
            onArm={() => setArmed(fix.value)}
            onApply={() => {
              setArmed(null);
              onSelect(fix.value);
            }}
          />
        ))}
      </div>

      {(busy || previewStatus === "failed") && (
        <div className="flex justify-end px-3.5 pb-2.5 text-xs text-muted-foreground">
          <CardStatus
            busy={busy}
            failed={previewStatus === "failed"}
            onRetry={onRetryPreview}
          />
        </div>
      )}
    </div>
  );
}
