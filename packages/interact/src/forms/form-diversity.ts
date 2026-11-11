/**
 * How alike are the forms different people built for the same brief?
 *
 * When suggested answers steer everyone to the same fields, forms converge.
 * This measures it: the overlap of two forms' field sets (Jaccard, with
 * fields matched the way committee drafts are aligned — `sameQuestion`),
 * averaged over every pair. 1 = all forms ask for the same things; 0 =
 * no two forms share a field. Diversity is 1 − overlap.
 */

import { sameQuestion } from "./probe-disagreement";

export interface FormFields {
  /** Stable id of the form, for the pair listing */
  id: string;
  fields: { key: string; label: string }[];
}

/**
 * Jaccard overlap of two field sets. Each field of `a` is matched with at
 * most one field of `b` (the first unmatched one that asks the same thing).
 * Two empty forms have nothing to compare: null.
 */
export function fieldOverlap(
  a: FormFields["fields"],
  b: FormFields["fields"],
): number | null {
  if (a.length === 0 && b.length === 0) return null;
  const taken = new Set<number>();
  let shared = 0;
  for (const field of a) {
    const match = b.findIndex((other, i) => !taken.has(i) && sameQuestion(field, other));
    if (match >= 0) {
      taken.add(match);
      shared++;
    }
  }
  return shared / (a.length + b.length - shared);
}

export interface PairOverlap {
  a: string;
  b: string;
  overlap: number;
}

export interface DiversitySummary {
  forms: number;
  pairs: number;
  /** Mean pairwise overlap; null with fewer than two comparable forms */
  meanOverlap: number | null;
  minOverlap: number | null;
  maxOverlap: number | null;
  /** Mean number of fields per form */
  meanFields: number | null;
}

/** The overlap of every pair of forms. */
export function pairwiseOverlaps(forms: readonly FormFields[]): PairOverlap[] {
  const pairs: PairOverlap[] = [];
  for (let i = 0; i < forms.length; i++) {
    for (let j = i + 1; j < forms.length; j++) {
      const overlap = fieldOverlap(forms[i].fields, forms[j].fields);
      if (overlap !== null) pairs.push({ a: forms[i].id, b: forms[j].id, overlap });
    }
  }
  return pairs;
}

export function summarizeDiversity(forms: readonly FormFields[]): DiversitySummary {
  const overlaps = pairwiseOverlaps(forms).map((p) => p.overlap);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : null;
  return {
    forms: forms.length,
    pairs: overlaps.length,
    meanOverlap: mean(overlaps),
    minOverlap: overlaps.length ? Math.min(...overlaps) : null,
    maxOverlap: overlaps.length ? Math.max(...overlaps) : null,
    meanFields: mean(forms.map((f) => f.fields.length)),
  };
}
