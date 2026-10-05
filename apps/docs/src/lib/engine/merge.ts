/**
 * Three-way merges for the intent portfolio.
 *
 * Writers compute their change (`ours`) from a snapshot (`base`) taken before
 * a slow operation — usually an LLM call. By the time they commit, the
 * database may hold a newer state (`theirs`). Instead of overwriting
 * `theirs` with `ours`, these helpers replay only what the writer actually
 * changed (base → ours) on top of `theirs`.
 *
 * When base === theirs (nobody else wrote in between) the result equals
 * `ours`, so the common case behaves exactly as before.
 */

import type {
  Field,
  PortfolioSchema,
  SectionKey,
  StructuredIntent,
} from "../types";

export type ConflictPolicy = "ours" | "theirs";

const SECTION_KEYS: SectionKey[] = [
  "purpose",
  "audience",
  "exclusions",
  "constraints",
];

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function mergeField(
  base: Field,
  ours: Field,
  theirs: Field,
  policy: ConflictPolicy,
): Field {
  const result: Record<string, unknown> = { ...theirs };
  const keys = new Set([...Object.keys(base), ...Object.keys(ours)]);
  for (const key of keys) {
    const b = (base as unknown as Record<string, unknown>)[key];
    const o = (ours as unknown as Record<string, unknown>)[key];
    const t = (theirs as unknown as Record<string, unknown>)[key];
    if (same(b, o)) continue; // we didn't touch it → keep theirs
    if (same(b, t) || policy === "ours") {
      if (o === undefined) delete result[key];
      else result[key] = o;
    }
  }
  return result as unknown as Field;
}

/**
 * Replay the field-level changes between `base` and `ours` onto `theirs`.
 * - fields we removed are removed (if they still exist);
 * - fields we added are appended (or merged by name if someone else added
 *   a field with the same name meanwhile);
 * - fields we modified are merged property by property; properties changed
 *   on both sides are resolved by `policy`;
 * - schema-level metadata (groups, standards, column actions) follows the
 *   same rule.
 */
export function mergeSchemaChange(
  base: PortfolioSchema,
  ours: PortfolioSchema,
  theirs: PortfolioSchema,
  policy: ConflictPolicy = "ours",
): PortfolioSchema {
  const baseById = new Map(base.fields.map((f) => [f.id, f]));
  const oursById = new Map(ours.fields.map((f) => [f.id, f]));

  const removedIds = new Set(
    base.fields.filter((f) => !oursById.has(f.id)).map((f) => f.id),
  );

  let fields: Field[] = theirs.fields
    .filter((f) => !removedIds.has(f.id))
    .map((t) => {
      const b = baseById.get(t.id);
      const o = oursById.get(t.id);
      if (!b || !o || same(b, o)) return t;
      return mergeField(b, o, t, policy);
    });

  const theirsIds = new Set(fields.map((f) => f.id));
  const theirsByName = new Map(fields.map((f) => [f.name, f]));
  for (const o of ours.fields) {
    if (baseById.has(o.id) || theirsIds.has(o.id)) continue; // not ours to add
    const clash = theirsByName.get(o.name);
    if (clash) {
      // Someone else added a field with the same name — merge into theirs
      // rather than creating a duplicate key.
      const merged =
        policy === "ours" ? { ...clash, ...o, id: clash.id } : clash;
      fields = fields.map((f) => (f.id === clash.id ? merged : f));
    } else {
      fields.push(o);
    }
  }

  const pick = <K extends keyof PortfolioSchema>(key: K) =>
    same(base[key], ours[key]) ? theirs[key] : ours[key];

  const survivingIds = new Set(fields.map((f) => f.id));
  const groups = (pick("groups") ?? [])
    .map((g) => ({
      ...g,
      fieldIds: g.fieldIds.filter((id) => survivingIds.has(id)),
    }))
    .filter((g) => g.fieldIds.length > 0);

  return {
    ...theirs,
    fields,
    groups,
    acceptedStandards: pick("acceptedStandards"),
    columnActions: pick("columnActions"),
    version: Math.max(theirs.version, ours.version) + (same(base, theirs) ? 0 : 1),
  };
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

/**
 * Section-wise three-way merge of the structured intent. A section we
 * changed replaces theirs unless they also changed it and policy is
 * "theirs" (e.g. an automated purpose rewrite must not clobber a newer
 * human edit).
 */
export function mergeIntentChange(
  base: StructuredIntent,
  ours: StructuredIntent,
  theirs: StructuredIntent,
  policy: ConflictPolicy = "ours",
): StructuredIntent {
  const result = { ...theirs };
  for (const key of SECTION_KEYS) {
    const b = base[key]?.content ?? "";
    const o = ours[key]?.content ?? "";
    const t = theirs[key]?.content ?? "";
    if (b === o) continue;
    if (b === t || policy === "ours") result[key] = ours[key];
  }
  return result;
}

/** True when the given intent section changed between two states. */
export function sectionChanged(
  a: StructuredIntent,
  b: StructuredIntent,
  key: SectionKey,
): boolean {
  return (a[key]?.content ?? "") !== (b[key]?.content ?? "");
}
