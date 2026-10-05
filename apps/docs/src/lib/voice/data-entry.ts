import type {
  Field,
  PortfolioSchema,
  ReferenceValue,
  SelectOption,
} from "@/lib/types";
import {
  resolveReferenceMatch,
  type ReferenceCandidate,
} from "@/lib/voice/reference-resolution";

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

export type ValueIssueReason =
  /** Couldn't be read as the field's kind — left empty */
  | "unparsed"
  /** Not one of the select options — kept as spoken */
  | "not-an-option"
  /** Couldn't be read as a date — kept as spoken */
  | "unparsed-date"
  /** Outside the scale — clamped to the nearest end */
  | "clamped"
  /** The field kind can't be dictated (files, groups) */
  | "unsupported";

export interface ValueIssue {
  field: string;
  value: string;
  reason: ValueIssueReason;
}

export interface BuiltResponse {
  /** Response `data`, keyed by field name and typed per field kind. */
  data: Record<string, unknown>;
  /** Names of required fields the utterance left empty. */
  missingRequired: string[];
  /** Values that were skipped, kept raw, or adjusted. */
  issues: ValueIssue[];
}

const TRUE_WORDS = new Set([
  "true", "yes", "y", "yeah", "yep", "yup", "sure", "correct", "right",
  "checked", "check", "on", "ok", "okay", "1", "x",
  "ja", "jo", "jep", "doch", "richtig", "oui", "si", "sí",
]);
const FALSE_WORDS = new Set([
  "false", "no", "n", "nope", "nah", "not", "none", "unchecked", "off", "0",
  "nein", "nej", "non", "falsch",
]);

/** "yes"/"no" and friends → boolean; anything else → null (unknown). */
export function parseSpokenBoolean(value: string): boolean | null {
  const v = value
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "");
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

/**
 * Parse a dictated number: plain numbers, units/words around a number
 * ("2 kg", "about 3"), and decimal commas ("1,5"). A comma followed by
 * exactly three digits is a thousands separator ("1,000"). Empty → null.
 */
export function parseSpokenNumber(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;

  const match = s.replace(/\s+/g, "").match(/[-+]?\d[\d.,]*/);
  if (!match) return null;
  let digits = match[0].replace(/[.,]$/, "");
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(digits)) {
    digits = digits.replace(/,/g, ""); // 1,000 / 12,345.6
  } else if (/^[-+]?\d+,\d+$/.test(digits)) {
    digits = digits.replace(",", "."); // 1,5
  } else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(digits)) {
    digits = digits.replace(/\./g, ""); // 1.000 (European thousands)
  }
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function validYmd(y: number, m: number, d: number): string | null {
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return null;
  }
  return formatLocalDate(date);
}

const RELATIVE_DAYS: Record<string, number> = {
  today: 0,
  heute: 0,
  "i dag": 0,
  yesterday: -1,
  gestern: -1,
  "i går": -1,
  tomorrow: 1,
  morgen: 1,
  "i morgen": 1,
};

/**
 * Parse a dictated date into ISO `yyyy-mm-dd` (the date input's format),
 * in local time. Accepts ISO dates, European `dd.mm.yyyy`, relative words
 * ("today", "yesterday") and anything `Date.parse` understands ("March 3,
 * 2026"). Returns null when the text isn't a recognizable date.
 */
export function parseSpokenDate(
  value: string,
  now: Date = new Date(),
): string | null {
  const s = value.trim().toLowerCase().replace(/[.!?]+$/, "");
  if (!s) return null;

  if (s in RELATIVE_DAYS) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() + RELATIVE_DAYS[s]);
    return formatLocalDate(d);
  }

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t\s].*)?$/);
  if (m) return validYmd(Number(m[1]), Number(m[2]), Number(m[3]));

  // dd.mm.yyyy — the dotted form is unambiguously day-first.
  m = s.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/);
  if (m) return validYmd(Number(m[3]), Number(m[2]), Number(m[1]));

  // Slashed numeric dates (3/4/2026) are ambiguous between US and European
  // order — don't guess.
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return null;

  const parsed = Date.parse(value.trim());
  if (Number.isNaN(parsed)) return null;
  return formatLocalDate(new Date(parsed));
}

function findOption(
  options: SelectOption[],
  spoken: string,
): SelectOption | undefined {
  const v = spoken.trim().toLowerCase();
  return (
    options.find((o) => o.value === spoken.trim()) ??
    options.find((o) => o.value.toLowerCase() === v) ??
    options.find((o) => o.label.toLowerCase() === v)
  );
}

const LIST_PUNCTUATION = /\s*[,;/&]\s*/;
const LIST_CONJUNCTIONS =
  /\s+(?:and|or|und|oder|og|eller|et|ou)\s+/i;

/**
 * Split a dictated multi-select value into items: JSON arrays, then
 * punctuation, then conjunctions ("red and blue") — but never split an
 * item that is itself an option ("Black and white").
 */
function splitOptionList(value: string, options: SelectOption[]): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      /* not JSON — split as text */
    }
  }
  if (findOption(options, trimmed)) return [trimmed];
  return trimmed
    .split(LIST_PUNCTUATION)
    .flatMap((part) =>
      findOption(options, part) ? [part] : part.split(LIST_CONJUNCTIONS),
    )
    .map((v) => v.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Addressing fields (group children are stored nested)
// ---------------------------------------------------------------------------

/**
 * A field values can be dictated into. Group children are stored nested
 * (`data[group.name][child.name]`), so each field has a `path`; its `key`
 * is the dotted path ("address.city") used in prompts and value lists.
 */
export interface DictatableField {
  key: string;
  path: string[];
  field: Field;
  /** Human label, with group labels prefixed ("Address › City"). */
  label: string;
  /** Enclosing groups, outermost first. */
  groups: Field[];
}

/** Every non-group field of the schema, with its storage path. */
export function dictatableFields(schema: PortfolioSchema): DictatableField[] {
  const out: DictatableField[] = [];
  const walk = (fields: Field[], groups: Field[]) => {
    for (const f of fields) {
      if (f.type.kind === "group") {
        walk(f.type.fields, [...groups, f]);
        continue;
      }
      const path = [...groups.map((g) => g.name), f.name];
      out.push({
        key: path.join("."),
        path,
        field: f,
        label: [...groups, f].map((x) => x.label || x.name).join(" › "),
        groups,
      });
    }
  };
  walk(schema.fields, []);
  return out;
}

/**
 * Look up a dictated field key: the dotted path, or a group child's bare
 * name when no other field shares it.
 */
function fieldIndex(schema: PortfolioSchema) {
  const fields = dictatableFields(schema);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const bareCounts = new Map<string, number>();
  for (const f of fields) {
    bareCounts.set(f.field.name, (bareCounts.get(f.field.name) ?? 0) + 1);
  }
  const groupNames = new Set(
    schema.fields.filter((f) => f.type.kind === "group").map((f) => f.name),
  );
  return {
    fields,
    groupNames,
    resolve(key: string): DictatableField | undefined {
      const exact = byKey.get(key);
      if (exact) return exact;
      if (bareCounts.get(key) !== 1) return undefined;
      return fields.find((f) => f.field.name === key);
    },
  };
}

export function getAtPath(
  data: Record<string, unknown>,
  path: string[],
): unknown {
  let cur: unknown = data;
  for (const segment of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

export function setAtPath(
  data: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cur = data;
  for (const segment of path.slice(0, -1)) {
    const next = cur[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[segment] = {};
    }
    cur = cur[segment] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
}

function isEmptyValue(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    (typeof v === "string" && !v.trim()) ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.values(v).every(isEmptyValue))
  );
}

/**
 * Convert LLM-extracted string values into a response `data` object shaped
 * like a FormRenderer submission — keyed by field name (group children
 * nested under their group), typed per field kind — and report what couldn't
 * be used and which required fields are still empty. Partial records are
 * allowed (the caller decides how to surface the gaps); only values that
 * can't be represented are dropped. Files can't be dictated and are never
 * written.
 */
export function buildResponseEntry(
  schema: PortfolioSchema,
  values: { field: string; value: string }[],
  options: { now?: Date } = {},
): BuiltResponse {
  const index = fieldIndex(schema);
  const data: Record<string, unknown> = {};
  const issues: ValueIssue[] = [];

  for (const { field: key, value: rawValue } of values) {
    const value = String(rawValue ?? "");
    if (!value.trim()) continue;
    const target = index.resolve(key);
    if (!target) {
      // A whole group can't take a single spoken value.
      if (index.groupNames.has(key)) {
        issues.push({ field: key, value, reason: "unsupported" });
      }
      continue;
    }
    const def = target.field;
    const field = target.key;
    const set = (v: unknown) => setAtPath(data, target.path, v);
    const issue = (reason: ValueIssueReason) =>
      issues.push({ field, value, reason });

    switch (def.type.kind) {
      case "number": {
        const n = parseSpokenNumber(value);
        if (n === null) issue("unparsed");
        else set(n);
        break;
      }
      case "scale": {
        const n = parseSpokenNumber(value);
        if (n === null) {
          issue("unparsed");
          break;
        }
        const { min, max } = def.type;
        const rounded = Math.round(n);
        const clamped = Math.min(max, Math.max(min, rounded));
        if (clamped !== rounded) issue("clamped");
        set(clamped);
        break;
      }
      case "boolean": {
        const b = parseSpokenBoolean(value);
        if (b === null) issue("unparsed");
        else set(b);
        break;
      }
      case "date": {
        const iso = parseSpokenDate(value, options.now);
        if (iso) {
          set(iso);
        } else {
          issue("unparsed-date");
          set(value.trim());
        }
        break;
      }
      case "select": {
        const { options: selectOptions, multiple } = def.type;
        if (multiple) {
          // Merge with values dictated earlier in the same record.
          const existing = getAtPath(data, target.path);
          const next = Array.isArray(existing) ? [...(existing as string[])] : [];
          for (const item of splitOptionList(value, selectOptions)) {
            const match = findOption(selectOptions, item);
            if (!match) issue("not-an-option");
            const v = match ? match.value : item;
            if (!next.includes(v)) next.push(v);
          }
          if (next.length > 0) set(next);
        } else {
          // Accept an option value directly, or map a label to its value
          const match = findOption(selectOptions, value);
          if (!match) issue("not-an-option");
          set(match ? match.value : value.trim());
        }
        break;
      }
      case "file":
        issue("unsupported");
        break;
      default:
        // text, reference (resolved to a link afterwards)
        set(value.trim());
    }
  }

  // Required fields inside a group only count when the group is required
  // or was partly filled in.
  const missingRequired = index.fields
    .filter((f) => {
      if (!f.field.required) return false;
      if (!isEmptyValue(getAtPath(data, f.path))) return false;
      return f.groups.every(
        (g, i) =>
          g.required ||
          !isEmptyValue(getAtPath(data, f.path.slice(0, i + 1))),
      );
    })
    .map((f) => f.key);

  return { data, missingRequired, issues };
}

/**
 * Typed response `data` only — see {@link buildResponseEntry} for the
 * missing-field and issue report.
 */
export function buildResponseData(
  schema: PortfolioSchema,
  values: { field: string; value: string }[],
): Record<string, unknown> {
  return buildResponseEntry(schema, values).data;
}

// ---------------------------------------------------------------------------
// Reference resolution
// ---------------------------------------------------------------------------

/**
 * IO needed to resolve reference fields; injected so the resolution logic
 * stays pure and testable. The hook wires these to Supabase.
 */
export interface ReferenceIO {
  /** Candidate rows of the target portfolio, as (responseId, label) pairs */
  candidatesFor(
    targetPortfolioId: string,
    displayFieldName?: string,
  ): Promise<ReferenceCandidate[]>;
  /**
   * Create a new row in the target portfolio for an unmatched spoken label
   * ("relation by usage"). Returns null when the target can't hold it
   * (e.g. its schema has no text field) — the value then stays a plain string.
   */
  createTarget(
    targetPortfolioId: string,
    label: string,
    displayFieldName?: string,
  ): Promise<ReferenceCandidate | null>;
}

export interface CreatedReference {
  field: string;
  targetPortfolioId: string;
  candidate: ReferenceCandidate;
}

/** A spoken label that fits several target rows equally well. */
export interface AmbiguousReference {
  field: string;
  spoken: string;
  targetPortfolioId: string;
  candidates: ReferenceCandidate[];
}

/**
 * Replace spoken string values of reference fields with resolved
 * `ReferenceValue` links. Unmatched labels create a new target row and link
 * to it; if creation isn't possible the spoken string is kept as-is.
 * Ambiguous labels (several rows match equally) are neither guessed nor
 * duplicated: the spoken string is kept and reported in `ambiguous`.
 */
export async function resolveReferenceFields(
  schema: PortfolioSchema,
  data: Record<string, unknown>,
  io: ReferenceIO,
): Promise<{
  data: Record<string, unknown>;
  created: CreatedReference[];
  ambiguous: AmbiguousReference[];
}> {
  const created: CreatedReference[] = [];
  const ambiguous: AmbiguousReference[] = [];
  // Deep copy: group values are nested objects we may write into.
  const resolved = structuredClone(data);

  for (const { field, key, path } of dictatableFields(schema)) {
    if (field.type.kind !== "reference") continue;
    const spoken = getAtPath(resolved, path);
    if (typeof spoken !== "string" || !spoken.trim()) continue;

    const targetId = field.type.targetPortfolioId;
    const displayFieldName = field.type.displayFieldName;
    const candidates = await io.candidatesFor(targetId, displayFieldName);
    const match = resolveReferenceMatch(spoken, candidates);

    if (match.kind === "match") {
      setAtPath(resolved, path, {
        responseId: match.candidate.responseId,
        label: match.candidate.label,
      } satisfies ReferenceValue);
      continue;
    }
    if (match.kind === "ambiguous") {
      ambiguous.push({
        field: key,
        spoken: spoken.trim(),
        targetPortfolioId: targetId,
        candidates: match.candidates,
      });
      continue;
    }

    const createdCandidate = await io.createTarget(
      targetId,
      spoken.trim(),
      displayFieldName,
    );
    if (createdCandidate) {
      setAtPath(resolved, path, {
        responseId: createdCandidate.responseId,
        label: createdCandidate.label,
      } satisfies ReferenceValue);
      created.push({
        field: key,
        targetPortfolioId: targetId,
        candidate: createdCandidate,
      });
    }
  }

  return { data: resolved, created, ambiguous };
}
