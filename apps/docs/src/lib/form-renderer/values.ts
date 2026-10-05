/**
 * Pure helpers for response values: stored files, display formatting,
 * per-kind coercion of LLM/string output, and merging edited responses.
 * Isomorphic — no React, no Supabase.
 */

import {
  isReferenceValue,
  type Field,
  type PortfolioSchema,
} from "../types";

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** What a file field stores in `responses.data` once uploaded. */
export interface StoredFile {
  /** Object path inside the `response-files` bucket */
  path: string;
  name: string;
  size: number;
  type: string;
  /** Public URL of the object */
  url: string;
}

export function isStoredFile(value: unknown): value is StoredFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === "string" &&
    typeof v.url === "string" &&
    typeof v.name === "string"
  );
}

export function isFile(value: unknown): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

/**
 * `maxSize` on file fields is unit-less in the schema. Treat small numbers
 * as megabytes (an LLM writing `maxSize: 5` means 5 MB, nobody caps uploads
 * below 1 KB) and anything else as bytes.
 */
export function maxSizeBytes(maxSize: number | undefined): number | undefined {
  if (maxSize === undefined || !Number.isFinite(maxSize) || maxSize <= 0) {
    return undefined;
  }
  return maxSize < 1024 ? maxSize * 1024 * 1024 : maxSize;
}

/** Match a file against an `accept` list (".pdf", "image/*", "application/pdf", "pdf"). */
export function matchesAccept(
  file: { name: string; type?: string },
  accept: string[] | undefined,
): boolean {
  const list = (accept ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  const name = file.name.toLowerCase();
  const type = (file.type ?? "").toLowerCase();
  return list.some((a) => {
    if (a === "*" || a === "*/*") return true;
    if (a.startsWith(".")) return name.endsWith(a);
    if (a.endsWith("/*")) return type.startsWith(a.slice(0, -1));
    if (a.includes("/")) return type === a;
    return name.endsWith(`.${a}`);
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Replace every `File` anywhere in `value` with the result of `upload`.
 * Uploads run in parallel; the input is not mutated.
 */
export async function replaceFilesDeep(
  value: unknown,
  upload: (file: File) => Promise<StoredFile>,
): Promise<unknown> {
  if (isFile(value)) return upload(value);
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => replaceFilesDeep(v, upload)));
  }
  if (value && typeof value === "object" && isPlainObject(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([k, v]) => [k, await replaceFilesDeep(v, upload)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether a label already mentions its unit ("Quota Attainment (%)",
 * "Weight in kg") so the renderer doesn't append "(%)" a second time.
 * Matches the unit as a standalone token, so unit "m" doesn't match "Name".
 */
export function labelIncludesUnit(label: string, unit: string): boolean {
  const u = unit.trim();
  if (!u) return true;
  const re = new RegExp(
    `(^|[\\s(\\[/])${escapeRegExp(u)}($|[\\s)\\]/,.:;])`,
    "i",
  );
  return re.test(label);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export function isEmptyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** Human-readable text for a stored response value (table cells, previews). */
export function formatValue(value: unknown, field?: Field): string {
  if (isEmptyValue(value)) return "";
  if (isReferenceValue(value)) return value.label;
  if (isStoredFile(value)) return value.name;
  if (isFile(value)) return value.name;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value
      .map((v) => formatValue(v, field))
      .filter(Boolean)
      .join(", ");
  }
  if (field?.type.kind === "select" && typeof value === "string") {
    return field.type.options.find((o) => o.value === value)?.label ?? value;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (field?.type.kind === "group") {
      return field.type.fields
        .map((nested) => {
          const text = formatValue(record[nested.name], nested);
          return text ? `${nested.label}: ${text}` : "";
        })
        .filter(Boolean)
        .join("; ");
    }
    return Object.entries(record)
      .map(([k, v]) => {
        const text = formatValue(v);
        return text ? `${k}: ${text}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Orphaned data / editing
// ---------------------------------------------------------------------------

/**
 * Data keys that no top-level field of the schema reads anymore (renamed or
 * removed fields). Shown separately so nothing becomes invisible.
 */
export function orphanKeys(
  data: Record<string, unknown> | null | undefined,
  schema: PortfolioSchema,
): string[] {
  if (!data) return [];
  const names = new Set(schema.fields.map((f) => f.name));
  return Object.keys(data).filter(
    (k) => !names.has(k) && !isEmptyValue(data[k]),
  );
}

/**
 * Merge an edited submission into the stored data: fields of the schema
 * take the edited value (cleared → removed), keys the schema doesn't know
 * (orphans, parent-only data) are kept untouched.
 */
export function mergeEditedResponse(
  original: Record<string, unknown>,
  edited: Record<string, unknown>,
  schema: PortfolioSchema,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...original };
  for (const field of schema.fields) {
    const value = edited[field.name];
    if (value === undefined) delete merged[field.name];
    else merged[field.name] = value;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Coercion (column actions)
// ---------------------------------------------------------------------------

export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "ja", "checked", "x"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "nein", "unchecked"]);

/** Field kinds a text-producing column action can write. */
export function canCoerceKind(kind: Field["type"]["kind"]): boolean {
  return kind !== "file" && kind !== "group" && kind !== "reference";
}

function parseNumber(raw: string, unit?: string): number | null {
  let s = raw.trim();
  if (unit && s.toLowerCase().endsWith(unit.toLowerCase())) {
    s = s.slice(0, -unit.length).trim();
  }
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  // Thousands separators: "1,234,567.8"
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  s = s.replace(/[\s_]/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Normalize a date-ish string to YYYY-MM-DD (null when unparseable). */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [y, m, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    const d = new Date(Date.UTC(y, m - 1, day));
    // Reject roll-overs like 2024-02-30 → March 1
    return d.getUTCFullYear() === y &&
      d.getUTCMonth() === m - 1 &&
      d.getUTCDate() === day
      ? `${iso[1]}-${iso[2]}-${iso[3]}`
      : null;
  }
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function matchOption(
  raw: string,
  options: { label: string; value: string }[],
): string | null {
  const s = raw.trim();
  const lower = s.toLowerCase();
  return (
    options.find((o) => o.value === s)?.value ??
    options.find((o) => o.value.toLowerCase() === lower)?.value ??
    options.find((o) => o.label.toLowerCase() === lower)?.value ??
    null
  );
}

/**
 * Convert a string produced by a column action (LLM output) into the value
 * shape the field stores. Empty input clears the value (`value: undefined`).
 */
export function coerceValueForField(field: Field, raw: unknown): CoerceResult {
  const type = field.type;
  if (raw === null || raw === undefined) return { ok: true, value: undefined };
  const text =
    typeof raw === "string"
      ? raw
      : typeof raw === "number" || typeof raw === "boolean"
        ? String(raw)
        : null;
  if (text === null) return { ok: false, reason: "not a text value" };
  if (text.trim() === "") return { ok: true, value: undefined };

  switch (type.kind) {
    case "text": {
      if (type.maxLength && text.length > type.maxLength) {
        return { ok: false, reason: `longer than ${type.maxLength} characters` };
      }
      return { ok: true, value: text };
    }
    case "number":
    case "scale": {
      const n = parseNumber(text, type.kind === "number" ? type.unit : undefined);
      if (n === null) return { ok: false, reason: "not a number" };
      const min = type.min;
      const max = type.max;
      if (type.kind === "scale" && !Number.isInteger(n)) {
        return { ok: false, reason: "not a whole number" };
      }
      if (min !== undefined && n < min) {
        return { ok: false, reason: `below the minimum (${min})` };
      }
      if (max !== undefined && n > max) {
        return { ok: false, reason: `above the maximum (${max})` };
      }
      return { ok: true, value: n };
    }
    case "boolean": {
      const w = text.trim().toLowerCase();
      if (TRUE_WORDS.has(w)) return { ok: true, value: true };
      if (FALSE_WORDS.has(w)) return { ok: true, value: false };
      return { ok: false, reason: "not yes/no" };
    }
    case "select": {
      if (type.options.length === 0) return { ok: true, value: text.trim() };
      if (!type.multiple) {
        const v = matchOption(text, type.options);
        return v === null
          ? { ok: false, reason: "not one of the options" }
          : { ok: true, value: v };
      }
      let parts: unknown[];
      const trimmed = text.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed: unknown = JSON.parse(trimmed);
          parts = Array.isArray(parsed) ? parsed : [trimmed];
        } catch {
          parts = trimmed.slice(1, -1).split(/[,;]/);
        }
      } else {
        parts = trimmed.split(/[,;\n]/);
      }
      const values: string[] = [];
      for (const part of parts) {
        if (typeof part !== "string" || !part.trim()) continue;
        const v = matchOption(part, type.options);
        if (v === null) {
          return { ok: false, reason: `"${part.trim()}" is not an option` };
        }
        if (!values.includes(v)) values.push(v);
      }
      return { ok: true, value: values.length ? values : undefined };
    }
    case "date": {
      const iso = toIsoDate(text);
      if (!iso) return { ok: false, reason: "not a date" };
      if (type.range?.min && iso < type.range.min) {
        return { ok: false, reason: `before ${type.range.min}` };
      }
      if (type.range?.max && iso > type.range.max) {
        return { ok: false, reason: `after ${type.range.max}` };
      }
      return { ok: true, value: iso };
    }
    default:
      return { ok: false, reason: `${type.kind} fields can't be set from text` };
  }
}

/** Equality for response values, treating all empty values as equal. */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
