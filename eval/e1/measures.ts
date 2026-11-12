/**
 * E1's measures, per request. Pure: computed from schemas, gold specs and
 * responses, so every number can be recomputed offline from a run's saved
 * states. Definitions follow eval-harness-prompt.md §5 and are frozen with
 * the material (eval/FROZEN.md).
 */

import type { Field, PortfolioSchema } from "@/lib/types";

// ---------------------------------------------------------------------------
// Gold specs
// ---------------------------------------------------------------------------

/** A field named by its key (exact) or its label (regex text, "/…/flags"). */
export interface Selector {
  key?: string;
  label?: string;
}

export interface Assertion {
  field: Selector;
  /** Default true */
  exists?: boolean;
  type?: string;
  required?: boolean;
  multiple?: boolean;
  options?: { includes?: string[]; exactly?: string[] };
  scale?: { min?: number; max?: number };
}

export interface GoldSpec {
  reviewed: boolean;
  scope: {
    change?: Selector[];
    remove?: Selector[];
    add?: Selector[];
    include?: Selector[];
    exclude?: Selector[];
  };
  assertions: Assertion[];
}

export function parseRegex(text: string): RegExp {
  const m = text.match(/^\/(.*)\/([a-z]*)$/);
  return m ? new RegExp(m[1], m[2]) : new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

export function matches(field: Field, selector: Selector): boolean {
  if (selector.key !== undefined && field.name === selector.key) return true;
  if (selector.label !== undefined && parseRegex(selector.label).test(field.label)) return true;
  return false;
}

const matchesAny = (field: Field, selectors: readonly Selector[] | undefined) =>
  (selectors ?? []).some((s) => matches(field, s));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The type a stored answer depends on: the kind, and one choice vs several. */
export function answerType(field: Field): string {
  return field.type.kind === "select" && field.type.multiple ? "select-multiple" : field.type.kind;
}

/** Families within which fields can be aligned by label. */
const FAMILY: Record<string, string> = {
  text: "text",
  number: "numeric",
  scale: "numeric",
  select: "choice",
  date: "date",
  boolean: "boolean",
  file: "file",
  reference: "reference",
  group: "group",
};

const familyOf = (field: Field) => FAMILY[field.type.kind] ?? field.type.kind;

// ---------------------------------------------------------------------------
// Alignment between two versions of a form
// ---------------------------------------------------------------------------

export function labelTokens(label: string): Set<string> {
  return new Set(
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export const LABEL_THRESHOLD = 0.6;

/**
 * Maximum-weight assignment on a rectangular weight matrix (Hungarian
 * method on the padded square matrix). Returns, per row, the chosen column
 * or -1. Pairs with weight 0 are not returned.
 */
export function maxWeightMatching(weights: number[][]): number[] {
  const rows = weights.length;
  const cols = rows ? weights[0].length : 0;
  const n = Math.max(rows, cols);
  if (n === 0) return [];
  const max = Math.max(0, ...weights.flat());
  // Cost matrix for minimisation, 1-indexed (classic e-maxx formulation)
  const cost = (i: number, j: number) => (i < rows && j < cols ? max - weights[i][j] : max);
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const result = new Array(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j] - 1;
    if (i >= 0 && i < rows && j - 1 < cols && weights[i][j - 1] > 0) result[i] = j - 1;
  }
  return result;
}

export interface Alignment {
  pairs: { before: Field; after: Field; by: "key" | "label" }[];
  /** Fields of `before` without a counterpart */
  removed: Field[];
  /** Fields of `after` without a counterpart */
  added: Field[];
}

/**
 * Fields matched by key; with `byLabel`, the rest by normalised-label token
 * Jaccard ≥ 0.6 within the same type family, as a maximum-weight matching.
 */
export function align(before: PortfolioSchema, after: PortfolioSchema, byLabel = true): Alignment {
  const afterByKey = new Map(after.fields.map((f) => [f.name, f]));
  const pairs: Alignment["pairs"] = [];
  const restBefore: Field[] = [];
  const usedAfter = new Set<Field>();
  for (const b of before.fields) {
    const a = afterByKey.get(b.name);
    if (a && !usedAfter.has(a)) {
      pairs.push({ before: b, after: a, by: "key" });
      usedAfter.add(a);
    } else {
      restBefore.push(b);
    }
  }
  const restAfter = after.fields.filter((f) => !usedAfter.has(f));
  if (byLabel && restBefore.length && restAfter.length) {
    const weights = restBefore.map((b) =>
      restAfter.map((a) => {
        if (familyOf(a) !== familyOf(b)) return 0;
        const s = jaccard(labelTokens(b.label), labelTokens(a.label));
        return s >= LABEL_THRESHOLD ? s : 0;
      }),
    );
    const chosen = maxWeightMatching(weights);
    const matchedAfter = new Set<number>();
    const unmatchedBefore: Field[] = [];
    chosen.forEach((j, i) => {
      if (j >= 0) {
        pairs.push({ before: restBefore[i], after: restAfter[j], by: "label" });
        matchedAfter.add(j);
      } else {
        unmatchedBefore.push(restBefore[i]);
      }
    });
    return {
      pairs,
      removed: unmatchedBefore,
      added: restAfter.filter((_, j) => !matchedAfter.has(j)),
    };
  }
  return { pairs, removed: restBefore, added: restAfter };
}

// ---------------------------------------------------------------------------
// Collateral changes
// ---------------------------------------------------------------------------

function optionLabels(field: Field): string[] {
  return field.type.kind === "select" ? field.type.options.map((o) => o.label.trim().toLowerCase()) : [];
}

/** What changed about an aligned field that the request's measures look at. */
export function changedProperties(before: Field, after: Field): string[] {
  const out: string[] = [];
  if (answerType(before) !== answerType(after)) out.push("type");
  if (before.label.trim() !== after.label.trim()) out.push("label");
  if (before.required !== after.required) out.push("required");
  if (JSON.stringify(optionLabels(before)) !== JSON.stringify(optionLabels(after))) out.push("options");
  return out;
}

export interface Collateral {
  changed: string[];
  added: string[];
  removed: string[];
  total: number;
}

/**
 * Changes outside a request's gold scope: aligned fields outside `change`
 * whose type, label, requiredness or options changed; added fields that no
 * `add` descriptor covers; removed fields outside `remove`.
 *
 * For a derive request (`before` = the base, `after` = the derived form):
 * an inherited field changed in any of those ways, a new field no `add`
 * descriptor covers, and a base field from `include` that is missing.
 */
export function collateral(
  before: PortfolioSchema,
  after: PortfolioSchema,
  gold: GoldSpec,
  opts: { byLabel?: boolean; derive?: boolean } = {},
): Collateral {
  const { pairs, added, removed } = align(before, after, opts.byLabel ?? true);
  const changed = pairs
    .filter(({ before: b, after: a }) => !matchesAny(b, gold.scope.change) && changedProperties(b, a).length > 0)
    .map(({ before: b }) => b.name);
  const addedOut = added.filter((f) => !matchesAny(f, gold.scope.add)).map((f) => f.name);
  const removedOut = opts.derive
    ? removed.filter((f) => matchesAny(f, gold.scope.include)).map((f) => f.name)
    : removed.filter((f) => !matchesAny(f, gold.scope.remove)).map((f) => f.name);
  return {
    changed,
    added: addedOut,
    removed: removedOut,
    total: changed.length + addedOut.length + removedOut.length,
  };
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

export function holds(schema: PortfolioSchema, a: Assertion): boolean {
  const candidates = schema.fields.filter((f) => matches(f, a.field));
  const wantExists = a.exists ?? true;
  if (!wantExists) return candidates.length === 0;
  return candidates.some((f) => {
    if (a.type !== undefined && f.type.kind !== a.type) return false;
    if (a.required !== undefined && f.required !== a.required) return false;
    if (a.multiple !== undefined && !(f.type.kind === "select" && f.type.multiple === a.multiple)) return false;
    if (a.options) {
      if (f.type.kind !== "select") return false;
      const labels = f.type.options.map((o) => o.label.trim());
      const inc = (a.options.includes ?? []).map(parseRegex);
      if (!inc.every((re) => labels.some((l) => re.test(l)))) return false;
      if (a.options.exactly) {
        const ex = a.options.exactly.map(parseRegex);
        if (labels.length !== ex.length) return false;
        if (!ex.every((re) => labels.some((l) => re.test(l)))) return false;
        if (!labels.every((l) => ex.some((re) => re.test(l)))) return false;
      }
    }
    if (a.scale) {
      if (f.type.kind !== "scale") return false;
      if (a.scale.min !== undefined && f.type.min !== a.scale.min) return false;
      if (a.scale.max !== undefined && f.type.max !== a.scale.max) return false;
    }
    return true;
  });
}

export function fulfilment(schema: PortfolioSchema, assertions: readonly Assertion[]) {
  const satisfied = assertions.filter((a) => holds(schema, a)).length;
  return { satisfied, total: assertions.length, share: assertions.length ? satisfied / assertions.length : 1 };
}

// ---------------------------------------------------------------------------
// Bound responses
// ---------------------------------------------------------------------------

export function answered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Of the answers in `responses` (keyed by the base form's field keys),
 * those to fields the gold specs so far don't intend to remove: how many
 * still bind to a field of `schema` with the same key and a compatible type.
 */
export function boundResponses(
  responses: readonly { data: Record<string, unknown> }[],
  base: PortfolioSchema,
  schema: PortfolioSchema,
  intendedRemoved: ReadonlySet<string>,
  compatible: Record<string, string[]>,
) {
  const baseByKey = new Map(base.fields.map((f) => [f.name, f]));
  const nowByKey = new Map(schema.fields.map((f) => [f.name, f]));
  let bound = 0;
  let total = 0;
  for (const r of responses) {
    for (const [key, value] of Object.entries(r.data)) {
      const original = baseByKey.get(key);
      if (!original || !answered(value) || intendedRemoved.has(key)) continue;
      total++;
      const now = nowByKey.get(key);
      if (now && (compatible[answerType(original)] ?? []).includes(answerType(now))) bound++;
    }
  }
  return { bound, total, share: total ? bound / total : 1 };
}

// ---------------------------------------------------------------------------
// Agreement between runs
// ---------------------------------------------------------------------------

/** A form without ids and order: keys, types, labels, requiredness, options. */
export function canonical(schema: PortfolioSchema): string {
  return JSON.stringify(
    schema.fields
      .map((f) => ({
        key: f.name,
        type: answerType(f),
        label: f.label.trim(),
        required: f.required,
        options: optionLabels(f),
      }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.label.localeCompare(b.label)),
  );
}

/** Share of run pairs whose forms are canonically identical (10 pairs for 5 runs). */
export function agreement(canonicals: readonly string[]): number | null {
  let same = 0;
  let pairs = 0;
  for (let i = 0; i < canonicals.length; i++) {
    for (let j = i + 1; j < canonicals.length; j++) {
      pairs++;
      if (canonicals[i] === canonicals[j]) same++;
    }
  }
  return pairs ? same / pairs : null;
}

// ---------------------------------------------------------------------------
// Link integrity of derived forms
// ---------------------------------------------------------------------------

/**
 * Of a derived form's inherited fields, how many still point at a field of
 * the base as it is now.
 * - `"link"` (Malleable Forms): an inherited field carries `derivedFrom`
 *   (the base field's id); it resolves if the base still has that id.
 * - `"key"` (baselines, which keep no links): a derived field whose key a
 *   base field had at derive time is inherited, and resolves if the base
 *   still has a field with that key — generous to the baselines.
 */
export function linkIntegrity(
  derived: PortfolioSchema,
  baseAtDerive: PortfolioSchema,
  baseNow: PortfolioSchema,
  mode: "link" | "key",
) {
  let inherited = 0;
  let resolved = 0;
  if (mode === "link") {
    const nowIds = new Set(baseNow.fields.map((f) => f.id));
    for (const f of derived.fields) {
      if (!f.derivedFrom) continue;
      inherited++;
      if (nowIds.has(f.derivedFrom)) resolved++;
    }
  } else {
    const thenKeys = new Set(baseAtDerive.fields.map((f) => f.name));
    const nowKeys = new Set(baseNow.fields.map((f) => f.name));
    for (const f of derived.fields) {
      if (!thenKeys.has(f.name)) continue;
      inherited++;
      if (nowKeys.has(f.name)) resolved++;
    }
  }
  return { inherited, resolved, share: inherited ? resolved / inherited : null };
}
