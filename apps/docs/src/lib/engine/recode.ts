/**
 * Recoding responses from the dashboard — the data half of backpropagation:
 * merging or renaming options, mapping values the form doesn't offer,
 * fixing numbers. A recode rewrites stored responses AND, where needed, the
 * field in the form, so the two stay consistent.
 *
 * Pure: `planRecode` computes the row writes and a schema change that is
 * replayed on the latest schema at commit time (never "set the options to
 * this list", which would drop options added meanwhile). Parent rows of a
 * derived form are never recoded — they belong to the parent's form.
 */

import {
  buildRowWrite,
  storedDataOf,
  type ColumnChange,
  type ResponseRowLike,
  type RowWrite,
} from "../form-renderer/response-rows";
import { valuesEqual } from "../form-renderer/values";
import type { Field, FieldType, Portfolio, PortfolioSchema, SelectOption } from "../types";
import { categoryKeys } from "./response-stats";

export type RecodeOp =
  /** Change an option's label; stored values stay */
  | { kind: "renameOption"; fieldId: string; value: string; label: string }
  /** Answers with any of `from` become `into`; `from` options leave the form */
  | { kind: "mergeOptions"; fieldId: string; from: string[]; into: string }
  /** Answers the form doesn't offer → an option (or cleared with null) */
  | { kind: "mapValues"; fieldId: string; map: Record<string, string | null> }
  /** Values the form doesn't offer become options */
  | { kind: "addAsOptions"; fieldId: string; values: string[] }
  /** Correct (or clear with null) individual numeric answers by response id */
  | { kind: "setValues"; fieldId: string; values: Record<string, number | null> }
  /** Set a number field's range, optionally clearing answers outside it */
  | {
      kind: "setRange";
      fieldId: string;
      min?: number;
      max?: number;
      clearOutside: boolean;
    };

type SchemaChange = (schema: PortfolioSchema) => PortfolioSchema;

export interface RecodePlan {
  op: RecodeOp;
  field: Field;
  changes: ColumnChange[];
  /** Parent rows (derived forms) that would change but are left alone */
  skippedParent: number;
  /** Replays the form change on the latest schema; null when the form stays */
  schemaChange: SchemaChange | null;
  inverseSchemaChange: SchemaChange | null;
  /**
   * Write order that never leaves an answer pointing at an option the form
   * lacks: rows first when options are removed, the form first when added.
   */
  order: "rows-first" | "schema-first";
  /** For History and the undo toast */
  summary: string;
}

// ---------------------------------------------------------------------------
// Schema edits (relative to whatever the schema is at commit time)
// ---------------------------------------------------------------------------

function editField(
  fieldId: string,
  fn: (type: FieldType) => FieldType,
): SchemaChange {
  return (schema) => {
    let changed = false;
    const fields = schema.fields.map((f) => {
      if (f.id !== fieldId) return f;
      const type = fn(f.type);
      if (JSON.stringify(type) === JSON.stringify(f.type)) return f;
      changed = true;
      return { ...f, type };
    });
    return changed ? { ...schema, fields, version: schema.version + 1 } : schema;
  };
}

function editOptions(
  fieldId: string,
  fn: (options: SelectOption[]) => SelectOption[],
): SchemaChange {
  return editField(fieldId, (type) =>
    type.kind === "select" ? { ...type, options: fn(type.options) } : type,
  );
}

/** Put removed options back where they were (or at the end). */
function restoreOptions(
  fieldId: string,
  removed: { option: SelectOption; index: number }[],
): SchemaChange {
  return editOptions(fieldId, (options) => {
    const next = [...options];
    for (const { option, index } of [...removed].sort((a, b) => a.index - b.index)) {
      if (next.some((o) => o.value === option.value)) continue;
      next.splice(Math.min(index, next.length), 0, option);
    }
    return next;
  });
}

// ---------------------------------------------------------------------------
// Value transforms
// ---------------------------------------------------------------------------

/** The stored form of an option key for this field (boolean, number, string). */
function typedValue(field: Field, key: string): unknown {
  if (field.type.kind === "boolean") return key === "true";
  if (field.type.kind === "scale" || field.type.kind === "number") return Number(key);
  return key;
}

/**
 * Replace category keys in a stored value: `mapKey` returns the new key,
 * null to drop it, or undefined to leave it. Multi-selects stay arrays
 * (deduplicated); a single value that is dropped is cleared.
 */
function mapCategories(
  field: Field,
  value: unknown,
  mapKey: (key: string) => string | null | undefined,
): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const [key] = categoryKeys(item);
      const mapped = key === undefined ? undefined : mapKey(key);
      if (mapped === null) continue;
      const next = mapped === undefined ? item : typedValue(field, mapped);
      const id = JSON.stringify(next);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(next);
    }
    return out;
  }
  const [key] = categoryKeys(value);
  if (key === undefined) return value;
  const mapped = mapKey(key);
  if (mapped === undefined) return value;
  return mapped === null ? undefined : typedValue(field, mapped);
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

const quote = (items: string[]) => items.map((i) => `"${i}"`).join(", ");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function isParentRow(row: ResponseRowLike): boolean {
  return "origin" in row && row.origin === "parent";
}

function planRows(
  field: Field,
  rows: readonly ResponseRowLike[],
  portfolio: Pick<Portfolio, "base_id" | "projection">,
  transform: (row: ResponseRowLike, value: unknown) => unknown,
): { changes: ColumnChange[]; skippedParent: number } {
  const changes: ColumnChange[] = [];
  let skippedParent = 0;
  rows.forEach((row, index) => {
    const oldValue = row.data[field.name];
    const newValue = transform(row, oldValue);
    if (valuesEqual(oldValue, newValue)) return;
    if (isParentRow(row)) {
      skippedParent++;
      return;
    }
    const write = buildRowWrite(row, field, newValue, portfolio);
    if (!write) {
      skippedParent++;
      return;
    }
    changes.push({
      row,
      position: index + 1,
      oldValue,
      newValue,
      write,
      revert: { ...write, data: storedDataOf(row) },
    });
  });
  return { changes, skippedParent };
}

/** What a recode would change; null when the op doesn't apply to the field. */
export function planRecode(
  op: RecodeOp,
  ctx: {
    schema: PortfolioSchema;
    portfolio: Pick<Portfolio, "base_id" | "projection">;
    rows: readonly ResponseRowLike[];
  },
): RecodePlan | null {
  const field = ctx.schema.fields.find((f) => f.id === op.fieldId);
  if (!field) return null;
  const { type } = field;
  const options = type.kind === "select" ? type.options : [];
  const labelOf = (value: string) =>
    options.find((o) => o.value === value)?.label ?? value;
  const rows = (transform: (row: ResponseRowLike, value: unknown) => unknown) =>
    planRows(field, ctx.rows, ctx.portfolio, transform);

  switch (op.kind) {
    case "renameOption": {
      const option = options.find((o) => o.value === op.value);
      const label = op.label.trim();
      if (!option || !label || label === option.label) return null;
      return {
        op,
        field,
        changes: [],
        skippedParent: 0,
        schemaChange: editOptions(field.id, (opts) =>
          opts.map((o) => (o.value === op.value ? { ...o, label } : o)),
        ),
        inverseSchemaChange: editOptions(field.id, (opts) =>
          opts.map((o) => (o.value === op.value ? { ...o, label: option.label } : o)),
        ),
        order: "schema-first",
        summary: `Renamed "${option.label}" to "${label}" in "${field.label}"`,
      };
    }

    case "mergeOptions": {
      const from = op.from.filter((v) => v !== op.into);
      if (type.kind !== "select" || from.length === 0) return null;
      if (!options.some((o) => o.value === op.into)) return null;
      const fromSet = new Set(from);
      const { changes, skippedParent } = rows((_, value) =>
        mapCategories(field, value, (key) => (fromSet.has(key) ? op.into : undefined)),
      );
      const removed = options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => fromSet.has(option.value));
      return {
        op,
        field,
        changes,
        skippedParent,
        schemaChange: removed.length
          ? editOptions(field.id, (opts) => opts.filter((o) => !fromSet.has(o.value)))
          : null,
        inverseSchemaChange: removed.length ? restoreOptions(field.id, removed) : null,
        order: "rows-first",
        summary: `Merged ${quote(from.map(labelOf))} into "${labelOf(op.into)}" in "${field.label}" (${plural(changes.length, "response", "responses")})`,
      };
    }

    case "mapValues": {
      const entries = Object.entries(op.map);
      if (entries.length === 0) return null;
      const map = new Map(entries);
      const { changes, skippedParent } = rows((_, value) =>
        mapCategories(field, value, (key) => (map.has(key) ? map.get(key)! : undefined)),
      );
      const targets = [...new Set(entries.map(([, to]) => to))];
      const described = targets
        .map((to) =>
          to === null
            ? `cleared ${quote(entries.filter(([, t]) => t === null).map(([k]) => k))}`
            : `mapped ${quote(entries.filter(([, t]) => t === to).map(([k]) => k))} to "${labelOf(to)}"`,
        )
        .join("; ");
      return {
        op,
        field,
        changes,
        skippedParent,
        schemaChange: null,
        inverseSchemaChange: null,
        order: "rows-first",
        summary: `In "${field.label}": ${described} (${plural(changes.length, "response", "responses")})`,
      };
    }

    case "addAsOptions": {
      if (type.kind !== "select") return null;
      const existing = new Set(options.map((o) => o.value));
      const added = [...new Set(op.values.map((v) => v.trim()))].filter(
        (v) => v && !existing.has(v),
      );
      if (added.length === 0) return null;
      const addedSet = new Set(added);
      return {
        op,
        field,
        changes: [],
        skippedParent: 0,
        schemaChange: editOptions(field.id, (opts) => [
          ...opts,
          ...added
            .filter((v) => !opts.some((o) => o.value === v))
            .map((v) => ({ label: v, value: v })),
        ]),
        inverseSchemaChange: editOptions(field.id, (opts) =>
          opts.filter((o) => !addedSet.has(o.value)),
        ),
        order: "schema-first",
        summary: `Added ${quote(added)} as ${added.length === 1 ? "an option" : "options"} of "${field.label}"`,
      };
    }

    case "setValues": {
      const values = new Map(Object.entries(op.values));
      if (values.size === 0) return null;
      const { changes, skippedParent } = rows((row, value) =>
        values.has(row.id) ? (values.get(row.id) ?? undefined) : value,
      );
      const cleared = changes.filter((c) => c.newValue === undefined).length;
      const fixed = changes.length - cleared;
      const parts = [
        fixed && `corrected ${plural(fixed, "answer", "answers")}`,
        cleared && `cleared ${plural(cleared, "answer", "answers")}`,
      ].filter(Boolean);
      return {
        op,
        field,
        changes,
        skippedParent,
        schemaChange: null,
        inverseSchemaChange: null,
        order: "rows-first",
        summary: `In "${field.label}": ${parts.join(", ") || "no change"}`,
      };
    }

    case "setRange": {
      if (type.kind !== "number") return null;
      const { min, max } = op;
      if (min !== undefined && max !== undefined && min > max) return null;
      const outside = (n: number) =>
        (min !== undefined && n < min) || (max !== undefined && n > max);
      const { changes, skippedParent } = op.clearOutside
        ? rows((_, value) => {
            const n = typeof value === "number" ? value : Number(value);
            return value !== undefined && value !== null && value !== "" && Number.isFinite(n) && outside(n)
              ? undefined
              : value;
          })
        : { changes: [], skippedParent: 0 };
      const before = { min: type.min, max: type.max };
      const range = `${min ?? "…"}–${max ?? "…"}`;
      return {
        op,
        field,
        changes,
        skippedParent,
        schemaChange: editField(field.id, (t) =>
          t.kind === "number" ? { ...t, min, max } : t,
        ),
        inverseSchemaChange: editField(field.id, (t) =>
          t.kind === "number" ? { ...t, min: before.min, max: before.max } : t,
        ),
        order: "rows-first",
        summary: `Limited "${field.label}" to ${range}${changes.length ? ` and cleared ${plural(changes.length, "answer", "answers")} outside it` : ""}`,
      };
    }
  }
}

/**
 * Writes that undo a recode on the rows as they are now: only rows whose
 * field still holds the value we wrote get their old value back, so an
 * answer edited since is left alone.
 */
export function planRecodeUndo(
  plan: RecodePlan,
  rows: readonly ResponseRowLike[],
  portfolio: Pick<Portfolio, "base_id" | "projection">,
): RowWrite[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const writes: RowWrite[] = [];
  for (const change of plan.changes) {
    const row = byId.get(change.row.id);
    if (!row || !valuesEqual(row.data[plan.field.name], change.newValue)) continue;
    const write = buildRowWrite(row, plan.field, change.oldValue, portfolio);
    if (write) writes.push(write);
  }
  return writes;
}
