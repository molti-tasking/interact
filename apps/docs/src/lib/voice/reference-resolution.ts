import type { PortfolioSchema } from "@/lib/types";

/**
 * Matching a spoken label against the rows of a referenced table.
 *
 * Spoken references are messy ("the SuperGlue", "super glue 50 milliliters"),
 * so matching is tiered: exact normalized match, then containment either way,
 * then token overlap. All of it is deterministic and LLM-free — the LLM only
 * extracts *what* was said; *which row* it denotes is resolved here, where it
 * can be tested and explained.
 */

export interface ReferenceCandidate {
  /** Row id in the target portfolio's `responses` table */
  responseId: string;
  /** Human-readable label derived from the row's data */
  label: string;
}

/**
 * Derive the display label for a row of the target portfolio: the configured
 * display field if it holds text, otherwise the first text field with a
 * value, otherwise the first string value at all.
 */
export function referenceLabelFor(
  targetSchema: PortfolioSchema,
  data: Record<string, unknown>,
  displayFieldName?: string,
): string | null {
  if (displayFieldName) {
    const v = data[displayFieldName];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  for (const field of targetSchema.fields) {
    if (field.type.kind !== "text") continue;
    const v = data[field.name];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  for (const v of Object.values(data)) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  return null;
}

/**
 * The field of the target schema a newly created row's label should be
 * written into: the configured display field if it exists as a text field,
 * otherwise the first text field.
 */
export function referenceEntryFieldName(
  targetSchema: PortfolioSchema,
  displayFieldName?: string,
): string | null {
  if (displayFieldName) {
    const field = targetSchema.fields.find((f) => f.name === displayFieldName);
    if (field?.type.kind === "text") return field.name;
  }
  const firstText = targetSchema.fields.find((f) => f.type.kind === "text");
  return firstText?.name ?? null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(normalize(text).split(" ").filter(Boolean));
}

/**
 * Match a spoken label against candidate rows. Tiers, strongest first:
 * 1. exact normalized equality
 * 2. containment (one label contains the other), longest overlap wins
 * 3. token overlap (Jaccard >= 0.5), highest overlap wins
 *
 * Returns null when nothing clears the bar — the caller decides whether to
 * create a new target row from the spoken label.
 */
export function matchReference(
  spoken: string,
  candidates: ReferenceCandidate[],
): ReferenceCandidate | null {
  const spokenNorm = normalize(spoken);
  if (!spokenNorm) return null;

  const exact = candidates.find((c) => normalize(c.label) === spokenNorm);
  if (exact) return exact;

  let bestContainment: { candidate: ReferenceCandidate; overlap: number } | null =
    null;
  for (const c of candidates) {
    const labelNorm = normalize(c.label);
    if (!labelNorm) continue;
    if (labelNorm.includes(spokenNorm) || spokenNorm.includes(labelNorm)) {
      const overlap = Math.min(labelNorm.length, spokenNorm.length);
      if (!bestContainment || overlap > bestContainment.overlap) {
        bestContainment = { candidate: c, overlap };
      }
    }
  }
  if (bestContainment) return bestContainment.candidate;

  const spokenTokens = tokens(spoken);
  let bestOverlap: { candidate: ReferenceCandidate; score: number } | null =
    null;
  for (const c of candidates) {
    const labelTokens = tokens(c.label);
    if (labelTokens.size === 0) continue;
    let shared = 0;
    for (const t of spokenTokens) if (labelTokens.has(t)) shared += 1;
    const union = new Set([...spokenTokens, ...labelTokens]).size;
    const score = union === 0 ? 0 : shared / union;
    if (score >= 0.5 && (!bestOverlap || score > bestOverlap.score)) {
      bestOverlap = { candidate: c, score };
    }
  }
  return bestOverlap?.candidate ?? null;
}
