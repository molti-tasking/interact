import type { PortfolioSchema } from "@/lib/types";

/**
 * Matching a spoken label against the rows of a referenced table.
 *
 * Spoken references are messy ("the SuperGlue", "super glue 50 milliliters"),
 * so matching is tiered: exact normalized match, then whole-token containment
 * either way, then token overlap; equally good rows are reported as ambiguous
 * rather than picked arbitrarily. All of it is deterministic and LLM-free — the LLM only
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

function tokenList(norm: string): string[] {
  return norm ? norm.split(" ") : [];
}

export type ReferenceMatch =
  | { kind: "match"; candidate: ReferenceCandidate }
  /** Several rows fit equally well — the spoken label can't tell them apart. */
  | { kind: "ambiguous"; candidates: ReferenceCandidate[] }
  | { kind: "none" };

interface Scored {
  candidate: ReferenceCandidate;
  /** Jaccard overlap of the token sets (0..1) */
  overlap: number;
  /**
   * Difference in token count. Measured in tokens, not characters, so
   * "blue" stays ambiguous between "Blue Beanie" and "Blue Scarf" instead of
   * being decided by which word happens to be shorter.
   */
  lengthDiff: number;
}

/** Best-first; ties (same overlap and length difference) are ambiguous. */
function pickBest(scored: Scored[]): ReferenceMatch {
  if (scored.length === 0) return { kind: "none" };
  const sorted = [...scored].sort(
    (a, b) => b.overlap - a.overlap || a.lengthDiff - b.lengthDiff,
  );
  const [best] = sorted;
  const tied = sorted.filter(
    (s) => s.overlap === best.overlap && s.lengthDiff === best.lengthDiff,
  );
  return tied.length > 1
    ? { kind: "ambiguous", candidates: tied.map((s) => s.candidate) }
    : { kind: "match", candidate: best.candidate };
}

/**
 * Match a spoken label against candidate rows, on whole-token boundaries
 * ("ink" never matches "Pink hoodie"). Tiers, strongest first:
 * 1. exact normalized equality (also ignoring spaces: "super glue" = "SuperGlue")
 * 2. token containment — every token of one label appears in the other
 * 3. token overlap (Jaccard >= 0.5)
 *
 * Within a tier, the highest token overlap wins, then the closest length
 * (in tokens).
 * If two rows remain tied the result is `ambiguous` — the caller must not
 * guess (or create a duplicate row); it should keep the spoken text and say so.
 */
export function resolveReferenceMatch(
  spoken: string,
  candidates: ReferenceCandidate[],
): ReferenceMatch {
  const spokenNorm = normalize(spoken);
  if (!spokenNorm) return { kind: "none" };
  const spokenCompact = spokenNorm.replace(/ /g, "");
  const spokenTokens = new Set(tokenList(spokenNorm));

  const exact: Scored[] = [];
  const contained: Scored[] = [];
  const overlapping: Scored[] = [];

  for (const candidate of candidates) {
    const labelNorm = normalize(candidate.label);
    if (!labelNorm) continue;
    const labelCompact = labelNorm.replace(/ /g, "");
    const labelTokens = new Set(tokenList(labelNorm));

    let shared = 0;
    for (const t of spokenTokens) if (labelTokens.has(t)) shared += 1;
    const union = spokenTokens.size + labelTokens.size - shared;
    const scored: Scored = {
      candidate,
      overlap: union === 0 ? 0 : shared / union,
      lengthDiff: Math.abs(labelTokens.size - spokenTokens.size),
    };

    if (labelNorm === spokenNorm || labelCompact === spokenCompact) {
      exact.push(scored);
    } else if (
      shared > 0 &&
      (shared === spokenTokens.size || shared === labelTokens.size)
    ) {
      contained.push(scored);
    } else if (scored.overlap >= 0.5) {
      overlapping.push(scored);
    }
  }

  if (exact.length > 0) {
    return exact.length === 1
      ? { kind: "match", candidate: exact[0].candidate }
      : { kind: "ambiguous", candidates: exact.map((s) => s.candidate) };
  }
  if (contained.length > 0) return pickBest(contained);
  return pickBest(overlapping);
}

/**
 * Convenience wrapper: the single matching row, or null when nothing (or
 * more than one row equally) matches. Use `resolveReferenceMatch` to tell
 * "no match" from "ambiguous".
 */
export function matchReference(
  spoken: string,
  candidates: ReferenceCandidate[],
): ReferenceCandidate | null {
  const result = resolveReferenceMatch(spoken, candidates);
  return result.kind === "match" ? result.candidate : null;
}
