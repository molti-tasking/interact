/**
 * Aggregations of form responses for the response dashboard and its
 * findings. Pure and deterministic — the LLM chooses what to chart, never
 * the numbers.
 *
 * Rows carry the data as the form shows it (parent rows of a derived form
 * are already projected into its field names).
 */

import { formatValue, isEmptyValue } from "../form-renderer/values";
import type { Field, FormResponse, PortfolioSchema } from "../types";
import { scaleChoices, type ScaleChoice } from "./scale";

export type StatsRow = Pick<FormResponse, "id" | "data" | "submittedAt"> & {
  origin?: "own" | "parent";
};

/** Lists of individual answers (outliers, text samples) stop here. */
export const MAX_LISTED = 50;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryBucket {
  /** The stored value as a string ("true", "3", an option value) */
  key: string;
  label: string;
  count: number;
  /** An option the form offers; false for values it doesn't (legacy, typos) */
  known: boolean;
}

export interface CategoryStats {
  field: Field;
  total: number;
  answered: number;
  empty: number;
  /** Multi-select: one response can count in several buckets */
  multiple: boolean;
  /** The form's options in order (zero counts included), then unknown values by count */
  buckets: CategoryBucket[];
}

/** Whether a field's answers can be counted per category. */
export function isCategorical(field: Field): boolean {
  const { type } = field;
  return (
    type.kind === "select" ||
    type.kind === "boolean" ||
    (type.kind === "scale" && scaleChoices(type) !== null)
  );
}

/** The categories a field offers, in form order. */
export function knownCategories(field: Field): { key: string; label: string }[] {
  const { type } = field;
  switch (type.kind) {
    case "select":
      return type.options.map((o) => ({ key: o.value, label: o.label }));
    case "boolean":
      return [
        { key: "true", label: "Yes" },
        { key: "false", label: "No" },
      ];
    case "scale":
      return (scaleChoices(type) ?? []).map((c) => ({
        key: String(c.value),
        label: c.hint ? `${c.label} – ${c.hint}` : c.label,
      }));
    default:
      return [];
  }
}

/**
 * The category keys of a stored value: one per selected option for a
 * multi-select, one otherwise; none when empty. Numbers stored as strings
 * ("4") count as the number.
 */
export function categoryKeys(value: unknown): string[] {
  if (isEmptyValue(value)) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .filter((v) => !isEmptyValue(v))
    .map((v) => {
      if (typeof v === "string") {
        const n = Number(v);
        return v.trim() !== "" && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v.trim())
          ? String(n)
          : v;
      }
      return typeof v === "object" ? formatValue(v) : String(v);
    });
}

export function categoryStats(field: Field, rows: readonly StatsRow[]): CategoryStats {
  const known = knownCategories(field);
  const counts = new Map<string, number>(known.map((k) => [k.key, 0]));
  const unknownLabels = new Map<string, string>();
  let answered = 0;

  for (const row of rows) {
    const keys = categoryKeys(row.data[field.name]);
    if (keys.length === 0) continue;
    answered++;
    for (const key of new Set(keys)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (!known.some((k) => k.key === key)) unknownLabels.set(key, key);
    }
  }

  const unknown = [...unknownLabels.keys()]
    .map((key) => ({ key, label: key, count: counts.get(key) ?? 0, known: false }))
    .sort((a, b) => b.count - a.count);

  return {
    field,
    total: rows.length,
    answered,
    empty: rows.length - answered,
    multiple: field.type.kind === "select" && field.type.multiple,
    buckets: [
      ...known.map((k) => ({ ...k, count: counts.get(k.key) ?? 0, known: true })),
      ...unknown,
    ],
  };
}

// ---------------------------------------------------------------------------
// Likert batteries
// ---------------------------------------------------------------------------

export interface LikertItem {
  field: Field;
  answered: number;
  /** Count per choice, in choice order */
  counts: number[];
  /** Answers that aren't one of the choices */
  unknown: number;
  mean: number | null;
}

export interface LikertStats {
  choices: ScaleChoice[];
  items: LikertItem[];
}

/** Items share the first item's choices; null when it has none. */
export function likertStats(
  fields: readonly Field[],
  rows: readonly StatsRow[],
): LikertStats | null {
  const choices = fields[0] && scaleChoices(fields[0].type);
  if (!choices) return null;
  const index = new Map(choices.map((c, i) => [c.value, i]));

  const items = fields.map((field) => {
    const counts = choices.map(() => 0);
    let answered = 0;
    let unknown = 0;
    let sum = 0;
    for (const row of rows) {
      const raw = row.data[field.name];
      if (isEmptyValue(raw)) continue;
      const n = Number(raw);
      const i = Number.isFinite(n) ? index.get(n) : undefined;
      if (i === undefined) {
        unknown++;
        continue;
      }
      counts[i]++;
      answered++;
      sum += n;
    }
    return { field, answered, counts, unknown, mean: answered ? sum / answered : null };
  });

  return { choices, items };
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export interface NumericOutlier {
  rowId: string;
  value: number;
  /** Outside the field's min/max, or far outside the bulk of the answers */
  reason: "out-of-range" | "extreme";
}

export interface NumericStats {
  field: Field;
  total: number;
  answered: number;
  empty: number;
  /** Answers that are numbers */
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  bins: { from: number; to: number; count: number }[];
  /** At most MAX_LISTED; totals below */
  outliers: NumericOutlier[];
  outOfRange: number;
  extreme: number;
  /** Answers that aren't numbers (at most MAX_LISTED) */
  invalid: { rowId: string; raw: unknown }[];
  invalidCount: number;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function fieldRange(field: Field): { min?: number; max?: number } {
  const { type } = field;
  if (type.kind === "number" || type.kind === "scale") {
    return { min: type.min, max: type.max };
  }
  return {};
}

function buildBins(sorted: number[]): NumericStats["bins"] {
  if (sorted.length === 0) return [];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === max) return [{ from: min, to: max, count: sorted.length }];

  // Whole numbers over a short range: one bin per value
  if (sorted.every(Number.isInteger) && max - min + 1 <= 20) {
    const bins = Array.from({ length: max - min + 1 }, (_, i) => ({
      from: min + i,
      to: min + i,
      count: 0,
    }));
    for (const v of sorted) bins[v - min].count++;
    return bins;
  }

  const n = Math.min(12, Math.max(5, Math.ceil(Math.log2(sorted.length) + 1)));
  const width = (max - min) / n;
  const bins = Array.from({ length: n }, (_, i) => ({
    from: min + i * width,
    to: i === n - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const v of sorted) bins[Math.min(n - 1, Math.floor((v - min) / width))].count++;
  return bins;
}

export function numericStats(field: Field, rows: readonly StatsRow[]): NumericStats {
  const values: { rowId: string; value: number }[] = [];
  const invalid: NumericStats["invalid"] = [];
  let invalidCount = 0;
  let answered = 0;

  for (const row of rows) {
    const raw = row.data[field.name];
    if (isEmptyValue(raw)) continue;
    answered++;
    const n = toNumber(raw);
    if (n === null) {
      invalidCount++;
      if (invalid.length < MAX_LISTED) invalid.push({ rowId: row.id, raw });
      continue;
    }
    values.push({ rowId: row.id, value: n });
  }

  const sorted = values.map((v) => v.value).sort((a, b) => a - b);
  const count = sorted.length;
  const q1 = count ? quantile(sorted, 0.25) : null;
  const q3 = count ? quantile(sorted, 0.75) : null;

  // Out of the field's range, or "far out" (3 × IQR) when there's enough data
  const range = fieldRange(field);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : 0;
  const farOut = count >= 8 && iqr > 0;
  const outliers: NumericOutlier[] = [];
  let outOfRange = 0;
  let extreme = 0;
  for (const { rowId, value } of values) {
    let reason: NumericOutlier["reason"] | null = null;
    if (
      (range.min !== undefined && value < range.min) ||
      (range.max !== undefined && value > range.max)
    ) {
      reason = "out-of-range";
      outOfRange++;
    } else if (farOut && (value < q1! - 3 * iqr || value > q3! + 3 * iqr)) {
      reason = "extreme";
      extreme++;
    }
    if (reason && outliers.length < MAX_LISTED) outliers.push({ rowId, value, reason });
  }

  return {
    field,
    total: rows.length,
    answered,
    empty: rows.length - answered,
    count,
    min: count ? sorted[0] : null,
    max: count ? sorted[count - 1] : null,
    mean: count ? sorted.reduce((a, b) => a + b, 0) / count : null,
    median: count ? quantile(sorted, 0.5) : null,
    q1,
    q3,
    bins: buildBins(sorted),
    outliers,
    outOfRange,
    extreme,
    invalid,
    invalidCount,
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface TextStats {
  field: Field;
  total: number;
  answered: number;
  empty: number;
  /** Newest first, at most MAX_LISTED */
  samples: { rowId: string; text: string; submittedAt: string }[];
}

export function textStats(field: Field, rows: readonly StatsRow[]): TextStats {
  const answers = rows
    .filter((row) => !isEmptyValue(row.data[field.name]))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return {
    field,
    total: rows.length,
    answered: answers.length,
    empty: rows.length - answers.length,
    samples: answers.slice(0, MAX_LISTED).map((row) => ({
      rowId: row.id,
      text: formatValue(row.data[field.name], field),
      submittedAt: row.submittedAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Over time
// ---------------------------------------------------------------------------

export interface TimelineStats {
  bucket: "day" | "week";
  /** Consecutive buckets, gaps filled with 0 */
  points: { start: string; count: number }[];
  total: number;
}

const DAY = 86_400_000;
/** Longer spans are counted per week. */
const MAX_DAILY_SPAN = 90;

function dayStart(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

/** Monday of the (UTC) week. */
function weekStart(ms: number): number {
  const day = dayStart(ms);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY;
}

/** Responses per day/week, by submission time or by a date field. */
export function timelineStats(
  rows: readonly StatsRow[],
  dateField?: Field,
): TimelineStats {
  const times: number[] = [];
  for (const row of rows) {
    const raw = dateField ? row.data[dateField.name] : row.submittedAt;
    if (typeof raw !== "string" || !raw) continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) times.push(ms);
  }
  if (times.length === 0) return { bucket: "day", points: [], total: 0 };

  // A loop, not Math.min(...times): spreading 50k rows can overflow the stack
  let first = times[0];
  let last = times[0];
  for (const t of times) {
    if (t < first) first = t;
    if (t > last) last = t;
  }
  const bucket = (last - first) / DAY > MAX_DAILY_SPAN ? "week" : "day";
  const startOf = bucket === "week" ? weekStart : dayStart;
  const step = bucket === "week" ? 7 * DAY : DAY;

  const counts = new Map<number, number>();
  for (const t of times) counts.set(startOf(t), (counts.get(startOf(t)) ?? 0) + 1);

  const points: TimelineStats["points"] = [];
  for (let t = startOf(first); t <= startOf(last); t += step) {
    points.push({ start: new Date(t).toISOString().slice(0, 10), count: counts.get(t) ?? 0 });
  }
  return { bucket, points, total: times.length };
}

// ---------------------------------------------------------------------------
// Crosstab
// ---------------------------------------------------------------------------

/** Categories beyond this are folded into "Other". */
export const MAX_CROSSTAB_CATEGORIES = 12;
export const OTHER_KEY = "__other__";

export interface CrosstabStats {
  rows: CategoryBucket[];
  cols: CategoryBucket[];
  /** cells[row][col] = responses with both */
  cells: number[][];
  max: number;
  /** Responses with an answer to both fields */
  total: number;
}

function topBuckets(stats: CategoryStats): CategoryBucket[] {
  const used = stats.buckets.filter((b) => b.known || b.count > 0);
  if (used.length <= MAX_CROSSTAB_CATEGORIES) return used;
  const keep = [...used]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CROSSTAB_CATEGORIES - 1);
  const kept = used.filter((b) => keep.includes(b));
  return [...kept, { key: OTHER_KEY, label: "Other", count: 0, known: false }];
}

export function crosstabStats(
  rowField: Field,
  colField: Field,
  rows: readonly StatsRow[],
): CrosstabStats {
  const rowBuckets = topBuckets(categoryStats(rowField, rows));
  const colBuckets = topBuckets(categoryStats(colField, rows));
  const indexOf = (buckets: CategoryBucket[]) => {
    const map = new Map(buckets.map((b, i) => [b.key, i]));
    const other = map.get(OTHER_KEY);
    return (key: string) => map.get(key) ?? other;
  };
  const rowIndex = indexOf(rowBuckets);
  const colIndex = indexOf(colBuckets);

  const cells = rowBuckets.map(() => colBuckets.map(() => 0));
  let total = 0;
  for (const row of rows) {
    const rKeys = categoryKeys(row.data[rowField.name]);
    const cKeys = categoryKeys(row.data[colField.name]);
    if (rKeys.length === 0 || cKeys.length === 0) continue;
    total++;
    for (const r of new Set(rKeys.map(rowIndex))) {
      for (const c of new Set(cKeys.map(colIndex))) {
        if (r !== undefined && c !== undefined) cells[r][c]++;
      }
    }
  }

  return {
    rows: rowBuckets,
    cols: colBuckets,
    cells,
    max: Math.max(0, ...cells.flat()),
    total,
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface KpiStats {
  responses: number;
  /** Responses with every required field answered */
  complete: number;
  lastSubmittedAt: string | null;
  /** Submitted in the 7 days before `now` */
  lastWeek: number;
}

export function kpiStats(
  schema: PortfolioSchema,
  rows: readonly StatsRow[],
  now = Date.now(),
): KpiStats {
  const required = schema.fields.filter((f) => f.required);
  let complete = 0;
  let last: string | null = null;
  let lastWeek = 0;
  for (const row of rows) {
    if (required.every((f) => !isEmptyValue(row.data[f.name]))) complete++;
    if (!last || row.submittedAt > last) last = row.submittedAt;
    const t = Date.parse(row.submittedAt);
    if (Number.isFinite(t) && now - t <= 7 * DAY) lastWeek++;
  }
  return { responses: rows.length, complete, lastSubmittedAt: last, lastWeek };
}

// ---------------------------------------------------------------------------
// Every field at once (findings)
// ---------------------------------------------------------------------------

export type FieldStats =
  | { kind: "category"; stats: CategoryStats }
  | { kind: "numeric"; stats: NumericStats }
  | { kind: "text"; stats: TextStats };

/** One aggregation per chartable field, keyed by field id. */
export function buildFieldStats(
  schema: PortfolioSchema,
  rows: readonly StatsRow[],
): Map<string, FieldStats> {
  const result = new Map<string, FieldStats>();
  for (const field of schema.fields) {
    if (isCategorical(field)) {
      result.set(field.id, { kind: "category", stats: categoryStats(field, rows) });
    } else if (field.type.kind === "number" || field.type.kind === "scale") {
      result.set(field.id, { kind: "numeric", stats: numericStats(field, rows) });
    } else if (field.type.kind === "text") {
      result.set(field.id, { kind: "text", stats: textStats(field, rows) });
    }
  }
  return result;
}
