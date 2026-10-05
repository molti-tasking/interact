/**
 * Pure logic for response tables: projecting parent rows into a derived
 * portfolio, writing a column value back to the right row (and the right
 * field name), and building the preview of a column action.
 */

import type {
  DerivationSpec,
  Field,
  FormResponse,
  Portfolio,
  PortfolioSchema,
} from "../types";
import {
  canCoerceKind,
  coerceValueForField,
  valuesEqual,
} from "./values";

// ---------------------------------------------------------------------------
// Lineage rows
// ---------------------------------------------------------------------------

export interface ResponseWithOrigin extends FormResponse {
  /** "own" = submitted against this portfolio, "parent" = from parent, projected */
  origin: "own" | "parent";
  /**
   * The row's stored data, unprojected (parent rows: keyed by the parent's
   * field names, including fields the derived form doesn't show). Writes
   * must merge into this, never into the projected `data`.
   */
  rawData: Record<string, unknown>;
  /** Portfolio the row belongs to (the parent for origin="parent") */
  sourcePortfolioId: string;
}

export type ResponseRowLike = FormResponse | ResponseWithOrigin;

function isLineageRow(row: ResponseRowLike): row is ResponseWithOrigin {
  return "origin" in row && "rawData" in row;
}

/**
 * Project a parent row's data into the derived schema: keep keys the
 * derived form shows, renamed via `fieldMappings` (parent name → derived
 * name).
 */
export function projectParentData(
  data: Record<string, unknown>,
  derivedSchema: PortfolioSchema,
  projection: DerivationSpec,
): Record<string, unknown> {
  const derivedNames = new Set(derivedSchema.fields.map((f) => f.name));
  const mappings = projection.fieldMappings ?? {};
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data ?? {})) {
    const mapped = mappings[key] ?? key;
    if (derivedNames.has(mapped)) projected[mapped] = value;
  }
  return projected;
}

/**
 * The parent field name a derived field reads from, or null when the field
 * only exists in the derived form (writing it to a parent row would add
 * data the parent form doesn't have). For non-derived portfolios this is
 * just `field.name`.
 */
export function parentFieldNameFor(
  portfolio: Pick<Portfolio, "base_id" | "projection">,
  field: Field,
  parentData?: Record<string, unknown>,
): string | null {
  const projection = portfolio.projection;
  if (!portfolio.base_id || !projection) return field.name;

  for (const [parentName, derivedName] of Object.entries(
    projection.fieldMappings ?? {},
  )) {
    if (derivedName === field.name) return parentName;
  }
  // Inherited fields keep the parent field's id (see derive-actions).
  if ((projection.includedFieldIds ?? []).includes(field.id)) {
    return field.name;
  }
  // Same name already present on the parent row → projection shows it.
  if (parentData && Object.prototype.hasOwnProperty.call(parentData, field.name)) {
    return field.name;
  }
  return null;
}

export interface RowWrite {
  id: string;
  /** The row's own portfolio (parent id for parent rows) */
  portfolioId: string;
  /** Complete data to store */
  data: Record<string, unknown>;
}

function withKey(
  data: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...data };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

/** The full stored data of a row (unprojected). */
export function storedDataOf(row: ResponseRowLike): Record<string, unknown> {
  return isLineageRow(row) ? row.rawData : row.data;
}

/**
 * Write `value` into `field` of `row` without touching any other stored
 * key. Parent rows get the value under the *parent's* field name; returns
 * null when the field doesn't exist on the parent.
 */
export function buildRowWrite(
  row: ResponseRowLike,
  field: Field,
  value: unknown,
  portfolio: Pick<Portfolio, "base_id" | "projection">,
): RowWrite | null {
  if (!isLineageRow(row) || row.origin === "own") {
    return {
      id: row.id,
      portfolioId: isLineageRow(row) ? row.sourcePortfolioId : row.portfolioId,
      data: withKey(storedDataOf(row), field.name, value),
    };
  }
  const parentName = parentFieldNameFor(portfolio, field, row.rawData);
  if (!parentName) return null;
  return {
    id: row.id,
    portfolioId: row.sourcePortfolioId,
    data: withKey(row.rawData, parentName, value),
  };
}

// ---------------------------------------------------------------------------
// Column action preview
// ---------------------------------------------------------------------------

export interface ColumnChange {
  row: ResponseRowLike;
  /** Row number in the input order (1-based, for display) */
  position: number;
  oldValue: unknown;
  newValue: unknown;
  write: RowWrite;
  /** Restores the row's stored data as it was when previewed */
  revert: RowWrite;
}

export interface ColumnPreview {
  changes: ColumnChange[];
  unchanged: number;
  /** Results that don't fit the field's type */
  invalid: Array<{ position: number; raw: string; reason: string }>;
  /** Rows the model returned nothing for (skipped, or its batch failed) */
  missing: number;
  /** Parent rows whose field only exists in the derived form */
  skippedParent: number;
  total: number;
}

/**
 * Turn raw (string) column-action results into a reviewable change set:
 * coerce each result to the field's kind, drop no-ops, and plan the write
 * for each changed row.
 */
export function buildColumnPreview(args: {
  field: Field;
  portfolio: Pick<Portfolio, "base_id" | "projection">;
  rows: ResponseRowLike[];
  /** Raw results keyed by response id (absent = no result) */
  results: Record<string, string | null>;
}): ColumnPreview {
  const { field, portfolio, rows, results } = args;
  const preview: ColumnPreview = {
    changes: [],
    unchanged: 0,
    invalid: [],
    missing: 0,
    skippedParent: 0,
    total: rows.length,
  };

  rows.forEach((row, index) => {
    const position = index + 1;
    if (!Object.prototype.hasOwnProperty.call(results, row.id)) {
      preview.missing++;
      return;
    }
    const raw = results[row.id];
    const coerced = coerceValueForField(field, raw);
    if (!coerced.ok) {
      preview.invalid.push({ position, raw: String(raw), reason: coerced.reason });
      return;
    }
    const oldValue = row.data[field.name];
    if (valuesEqual(oldValue, coerced.value)) {
      preview.unchanged++;
      return;
    }
    const write = buildRowWrite(row, field, coerced.value, portfolio);
    if (!write) {
      preview.skippedParent++;
      return;
    }
    preview.changes.push({
      row,
      position,
      oldValue,
      newValue: coerced.value,
      write,
      revert: { ...write, data: storedDataOf(row) },
    });
  });

  return preview;
}

/** Whether column actions can write this field kind. */
export function supportsColumnAction(field: Field): boolean {
  return canCoerceKind(field.type.kind);
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run `fn` over `items` with at most `limit` in flight; keeps input order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return results;
}
