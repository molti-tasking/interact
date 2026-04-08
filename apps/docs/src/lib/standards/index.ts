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

/**
 * Minimum confidence threshold for a standard to be considered detected.
 * Standards below this threshold are not returned.
 */
const DETECTION_THRESHOLD = 0.15;

/**
 * Detects which domain standards are relevant to a user's prompt
 * using keyword matching. Returns standards sorted by confidence (descending).
 *
 * This is a pure function — no LLM call. It tokenizes the prompt and
 * counts how many of each standard's keywords appear.
 */
export function detectStandards(prompt: string): DetectedStandard[] {
  if (!prompt || prompt.trim().length < 3) return [];

  const normalizedPrompt = prompt.toLowerCase();
  // Tokenize into words for whole-word matching, but also keep the full string
  // for multi-word keyword matching (e.g., "electronic health record")
  const promptWords = new Set(normalizedPrompt.split(/\s+/));

  const results: DetectedStandard[] = [];

  for (const standard of standardRegistry) {
    const matchedKeywords: string[] = [];

    for (const keyword of standard.keywords) {
      const normalizedKeyword = keyword.toLowerCase();
      // Multi-word keywords: check if the phrase appears in the prompt
      // Single-word keywords: check if the word is present
      if (normalizedKeyword.includes(" ")) {
        if (normalizedPrompt.includes(normalizedKeyword)) {
          matchedKeywords.push(keyword);
        }
      } else {
        if (promptWords.has(normalizedKeyword)) {
          matchedKeywords.push(keyword);
        }
      }
    }

    if (matchedKeywords.length === 0) continue;

    // Confidence based on absolute weighted match count, not ratio.
    // This avoids penalizing standards with broad keyword lists.
    // Multi-word matches count double (they're more specific).
    // A saturating curve maps score → [0, 1]: score / (score + K)
    // K=3 means 3 weighted matches ≈ 0.5 confidence, 6 ≈ 0.67, 9 ≈ 0.75
    const SATURATION_K = 3;
    const multiWordMatches = matchedKeywords.filter((k) =>
      k.includes(" "),
    ).length;
    const singleWordMatches = matchedKeywords.length - multiWordMatches;
    const weightedScore = singleWordMatches + multiWordMatches * 2;
    const confidence = weightedScore / (weightedScore + SATURATION_K);

    if (confidence < DETECTION_THRESHOLD) continue;

    results.push({
      standard,
      confidence,
      matchedKeywords,
      relevantConstraints: standard.fieldConstraints,
    });
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}
