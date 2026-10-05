import type { DetectedStandard, DomainStandard } from "../domain-standards";
import { esrsE1Climate } from "./esrs-e1-climate";
import { fhirPatientIntake } from "./fhir-patient-intake";
import { gs1Gtin } from "./gs1-gtin";
import { schemaOrgJobPosting } from "./schema-org-job-posting";

/**
 * Registry of all domain standard profiles.
 * To add a new standard, import it and add it to this array.
 */
const standardRegistry: DomainStandard[] = [
  fhirPatientIntake,
  esrsE1Climate,
  gs1Gtin,
  schemaOrgJobPosting,
];

/** Returns all registered domain standards. */
export function getAllStandards(): DomainStandard[] {
  return standardRegistry;
}

/** Finds a standard by its ID, or undefined if not found. */
export function getStandardById(id: string): DomainStandard | undefined {
  return standardRegistry.find((s) => s.id === id);
}

/** Lowercase word tokens; punctuation is a separator ("patient," → patient). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(singularize);
}

/** Crude singularization so "products"/"GTINs" match "product"/"gtin". */
function singularize(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** Whether `needle` occurs as a contiguous token sequence in `haystack`. */
function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Saturation constant for the confidence curve score / (score + K):
 * two plain hits ≈ 0.4, a strong keyword plus one hit ≈ 0.57.
 */
const SATURATION_K = 3;

/**
 * Detects which domain standards are relevant to a user's prompt
 * using keyword matching. Returns standards sorted by confidence (descending).
 *
 * This is a pure function — no LLM call, no server-only dependencies (the
 * client calls it directly). Keywords match whole tokens (multi-word
 * keywords as a contiguous phrase). A standard is detected when at least
 * two distinct keywords match, or one of its `strongKeywords` does — a
 * single generic word ("department", "order") is not enough.
 *
 * Weights: single-word keyword 1, multi-word 2, strong keyword +1.
 */
export function detectStandards(prompt: string): DetectedStandard[] {
  if (!prompt || prompt.trim().length < 3) return [];

  const tokens = tokenize(prompt);
  const tokenSet = new Set(tokens);

  const results: DetectedStandard[] = [];

  for (const standard of standardRegistry) {
    const strong = new Set(
      (standard.strongKeywords ?? []).map((k) => k.toLowerCase()),
    );
    const keywords = [...new Set([...standard.keywords, ...strong])];
    const matchedKeywords: string[] = [];
    let weightedScore = 0;
    let strongHit = false;

    for (const keyword of keywords) {
      const keywordTokens = tokenize(keyword);
      const matched =
        keywordTokens.length === 1
          ? tokenSet.has(keywordTokens[0])
          : containsSequence(tokens, keywordTokens);
      if (!matched) continue;

      matchedKeywords.push(keyword);
      weightedScore += keywordTokens.length > 1 ? 2 : 1;
      if (strong.has(keyword.toLowerCase())) {
        strongHit = true;
        weightedScore += 1;
      }
    }

    if (matchedKeywords.length < 2 && !strongHit) continue;

    results.push({
      standard,
      confidence: weightedScore / (weightedScore + SATURATION_K),
      matchedKeywords,
      relevantConstraints: standard.fieldConstraints,
    });
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

/**
 * Re-resolve detected standards received from the client against the
 * registry, so prompts only ever contain curated standard data — a server
 * action payload is caller-controlled. Unknown ids are dropped; confidence
 * and matched keywords are kept for display.
 */
export function resolveDetectedStandards(
  input:
    | {
        standard: { id: string };
        confidence?: number;
        matchedKeywords?: string[];
      }[]
    | undefined,
): DetectedStandard[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const resolved: DetectedStandard[] = [];
  for (const item of input) {
    const standard = getStandardById(String(item?.standard?.id ?? ""));
    if (!standard || seen.has(standard.id)) continue;
    seen.add(standard.id);
    resolved.push({
      standard,
      confidence: typeof item.confidence === "number" ? item.confidence : 1,
      matchedKeywords: Array.isArray(item.matchedKeywords)
        ? item.matchedKeywords.filter((k) => typeof k === "string").slice(0, 50)
        : [],
      relevantConstraints: standard.fieldConstraints,
    });
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Pattern constraints
// ---------------------------------------------------------------------------

/**
 * Turn standard `validationRules.pattern`s into regex constraints on the
 * matching fields (by field key). Applied when the standard field is
 * mandatory or the generated field is required — an optional field left
 * empty would otherwise fail the pattern. Existing identical rules are not
 * duplicated.
 */
export function applyStandardPatterns<
  F extends {
    name: string;
    required: boolean;
    constraints: { type: string; rule: string; message: string }[];
  },
>(
  fields: F[],
  standards: Pick<DetectedStandard, "standard" | "relevantConstraints">[],
): F[] {
  const patterns = new Map<
    string,
    { rule: string; message: string; mandatory: boolean }[]
  >();
  for (const { standard, relevantConstraints } of standards) {
    for (const c of relevantConstraints) {
      const rule = c.validationRules?.pattern;
      if (!rule) continue;
      const list = patterns.get(c.fieldKey) ?? [];
      list.push({
        rule,
        message: `${c.label} must match the ${standard.name} format (${c.standardReference})`,
        mandatory: c.required === "mandatory",
      });
      patterns.set(c.fieldKey, list);
    }
  }
  if (patterns.size === 0) return fields;

  return fields.map((field) => {
    const applicable = (patterns.get(field.name) ?? []).filter(
      (p) =>
        (p.mandatory || field.required) &&
        !field.constraints.some((c) => c.type === "regex" && c.rule === p.rule),
    );
    if (applicable.length === 0) return field;
    return {
      ...field,
      constraints: [
        ...field.constraints,
        ...applicable.map((p) => ({
          type: "regex" as const,
          rule: p.rule,
          message: p.message,
        })),
      ],
    };
  });
}
