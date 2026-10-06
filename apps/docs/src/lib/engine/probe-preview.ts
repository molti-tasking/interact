/**
 * Pure helpers for previewing a change (a design probe answer, a conflict
 * fix) before it is applied.
 *
 * Previews store the change itself — a probe patch (`schema-patch.ts`) or
 * a conflict fix (`conflict-changes.ts`) — and are always rendered against
 * the current schema, so they stay accurate after other changes landed.
 */

import type { DesignProbe, Field, PortfolioSchema } from "../types";
import { applySchemaPatch, type SchemaPatch } from "./schema-patch";

export type FieldAnnotation = "added" | "updated" | "removed";

export interface PreviewSchema {
  /**
   * The patched schema, with removed fields kept at their original position
   * so they can be shown as removed. For display only — never persist it.
   */
  schema: PortfolioSchema;
  /** Field id → how the change affects it; unchanged fields are absent */
  annotations: Record<string, FieldAnnotation>;
}

function sameField(a: Field, b: Field): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Annotate how `next` differs from `current`, field by field. */
export function previewSchemaChange(
  current: PortfolioSchema,
  next: PortfolioSchema,
): PreviewSchema {
  const annotations: Record<string, FieldAnnotation> = {};

  const before = new Map(current.fields.map((f) => [f.id, f]));
  for (const field of next.fields) {
    const old = before.get(field.id);
    if (!old) annotations[field.id] = "added";
    else if (!sameField(old, field)) annotations[field.id] = "updated";
  }

  // A key removed and re-added in the same change reads as a change, not
  // as two fields with the same name.
  const fields = [...next.fields];
  const kept = new Set(next.fields.map((f) => f.id));
  current.fields.forEach((field, index) => {
    if (kept.has(field.id)) return;
    const readded = next.fields.find(
      (f) => f.name === field.name && annotations[f.id] === "added",
    );
    if (readded) {
      annotations[readded.id] = "updated";
      return;
    }
    fields.splice(Math.min(index, fields.length), 0, field);
    annotations[field.id] = "removed";
  });

  return { schema: { ...next, fields }, annotations };
}

export function buildPreviewSchema(
  current: PortfolioSchema,
  patch: SchemaPatch,
  opts: { validTargetIds?: Iterable<string> } = {},
): PreviewSchema {
  return previewSchemaChange(
    current,
    applySchemaPatch(current, patch, opts).schema,
  );
}

export interface PatchSummary {
  added: string[];
  updated: string[];
  removed: string[];
}

/** Labels of the fields a change adds, changes, or removes. */
export function summarizeChange({
  schema,
  annotations,
}: PreviewSchema): PatchSummary {
  const summary: PatchSummary = { added: [], updated: [], removed: [] };
  for (const field of schema.fields) {
    const annotation = annotations[field.id];
    if (annotation) summary[annotation].push(field.label);
  }
  return summary;
}

/** Labels of the fields a patch would add, change, or remove. */
export function summarizePatch(
  current: PortfolioSchema,
  patch: SchemaPatch,
  opts: { validTargetIds?: Iterable<string> } = {},
): PatchSummary {
  return summarizeChange(buildPreviewSchema(current, patch, opts));
}

export function patchSize(summary: PatchSummary): number {
  return summary.added.length + summary.updated.length + summary.removed.length;
}

/** Most important first (priority 1 = high); newest first within a priority. */
export function rankProbes<T extends Pick<DesignProbe, "priority" | "createdAt">>(
  probes: readonly T[],
): T[] {
  return [...probes].sort(
    (a, b) =>
      a.priority - b.priority || b.createdAt.localeCompare(a.createdAt),
  );
}
