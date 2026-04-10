/**
 * Structured Intent utilities.
 *
 * The intent portfolio is decomposed into typed sections so that
 * per-section change detection, pipeline strategy, and provenance
 * are first-class concepts rather than opaque string diffs.
 *
 * The user edits a single markdown editor. Sections are parsed from
 * ## headings and serialized back. The JSONB in the DB is the source
 * of truth; markdown is a UI projection.
 */

import type {
  PortfolioSchema,
  PipelineStrategy,
  SectionKey,
  StructuredIntent,
} from "../types";
import { emptyIntentSection } from "../types";

// ---------------------------------------------------------------------------
// Hashing — lightweight deterministic hash for change detection
// ---------------------------------------------------------------------------

export function hashSection(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = (Math.imul(31, h) + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------------------
// Sanitise LLM-returned purpose text
// ---------------------------------------------------------------------------

/**
 * Strip section headings (## Purpose, ## Constraints, …) that the LLM
 * sometimes echoes back inside `updatedPurpose`.  Only the first heading
 * is expected to be Purpose — if we find other section headings we strip
 * everything from that point on, because it belongs to a different section.
 */
export function sanitizePurposeText(raw: string): string {
  let text = raw.trim();

  // Remove a leading "## Purpose" heading if the LLM copied it
  text = text.replace(/^##\s+Purpose\s*\n+/i, "");

  // If the LLM included other section headings, drop them and everything after
  const otherHeadingMatch = text.search(
    /\n##\s+(Audience|Exclusions|Constraints)\b/i,
  );
  if (otherHeadingMatch !== -1) {
    text = text.slice(0, otherHeadingMatch);
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Markdown ↔ StructuredIntent (single editor projection)
// ---------------------------------------------------------------------------

const SECTION_HEADINGS: Record<SectionKey, string> = {
  purpose: "Purpose",
  audience: "Audience",
  exclusions: "Exclusions",
  constraints: "Constraints",
};

const HEADING_TO_KEY: Record<string, SectionKey> = {};
for (const [key, heading] of Object.entries(SECTION_HEADINGS)) {
  HEADING_TO_KEY[heading.toLowerCase()] = key as SectionKey;
}

/**
 * Serialize a StructuredIntent into markdown for the editor.
 * Only includes non-empty sections. If only purpose has content,
 * returns it without a heading for a cleaner UX.
 */
export function serializeToMarkdown(intent: StructuredIntent): string {
  const nonEmpty = (Object.keys(SECTION_HEADINGS) as SectionKey[]).filter(
    (k) => intent[k].content.trim() !== "",
  );

  // If only purpose, skip the heading for minimal friction
  if (nonEmpty.length <= 1 && nonEmpty[0] === "purpose") {
    return intent.purpose.content;
  }

  const sections: string[] = [];
  for (const key of Object.keys(SECTION_HEADINGS) as SectionKey[]) {
    const content = intent[key].content.trim();
    if (content) {
      sections.push(`## ${SECTION_HEADINGS[key]}\n${content}`);
    }
  }

  return sections.join("\n\n");
}

/**
 * Parse markdown from the editor back into StructuredIntent.
 *
 * If no ## headings are found, everything goes into `purpose`.
 * Otherwise, content is split by ## headings into the corresponding sections.
 */
export function parseFromMarkdown(
  markdown: string,
  prev: StructuredIntent,
): StructuredIntent {
  const now = new Date().toISOString();

  // No headings → everything is purpose
  if (!markdown.includes("## ")) {
    return {
      ...prev,
      purpose: { content: markdown, updatedAt: now },
    };
  }

  // Split on ## headings
  const result: StructuredIntent = {
    purpose: { ...prev.purpose, content: "" },
    audience: { ...prev.audience, content: "" },
    exclusions: { ...prev.exclusions, content: "" },
    constraints: { ...prev.constraints, content: "" },
  };

  const lines = markdown.split("\n");
  let currentKey: SectionKey = "purpose";
  const buckets: Record<SectionKey, string[]> = {
    purpose: [],
    audience: [],
    exclusions: [],
    constraints: [],
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      const heading = headingMatch[1].trim().toLowerCase();
      const mappedKey = HEADING_TO_KEY[heading];
      if (mappedKey) {
        currentKey = mappedKey;
        continue;
      }
    }
    buckets[currentKey].push(line);
  }

  for (const key of Object.keys(buckets) as SectionKey[]) {
    const content = buckets[key].join("\n").trim();
    if (content !== prev[key].content.trim()) {
      result[key] = { content, updatedAt: now };
    } else {
      result[key] = prev[key];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

export interface IntentDelta {
  changedSections: SectionKey[];
  isFirstGeneration: boolean;
}

export function computeDelta(
  prev: StructuredIntent,
  next: StructuredIntent,
): IntentDelta {
  const keys: SectionKey[] = ["purpose", "audience", "exclusions", "constraints"];

  const isFirstGeneration = keys.every(
    (k) => prev[k].content.trim() === "",
  );

  const changedSections = keys.filter(
    (k) =>
      hashSection(prev[k].content.trim()) !==
      hashSection(next[k].content.trim()),
  );

  return { changedSections, isFirstGeneration };
}

// ---------------------------------------------------------------------------
// Pipeline strategy
// ---------------------------------------------------------------------------

export function determinePipelineStrategy(
  delta: IntentDelta,
  hasExistingSchema: boolean,
): PipelineStrategy {
  const { changedSections, isFirstGeneration } = delta;

  if (isFirstGeneration || !hasExistingSchema) {
    return { kind: "full" };
  }

  if (changedSections.length === 0) {
    return { kind: "noop" };
  }

  if (
    changedSections.includes("purpose") ||
    changedSections.includes("audience")
  ) {
    return { kind: "full" };
  }

  if (
    changedSections.length === 1 &&
    changedSections[0] === "exclusions"
  ) {
    return { kind: "filter-only" };
  }

  if (
    changedSections.length === 1 &&
    changedSections[0] === "constraints"
  ) {
    return { kind: "recheck-constraints" };
  }

  // Multiple non-core sections changed → full to be safe
  return { kind: "full" };
}

// ---------------------------------------------------------------------------
// Exclusion filtering (deterministic, no LLM)
// ---------------------------------------------------------------------------

export function applyExclusions(
  schema: PortfolioSchema,
  exclusionsText: string,
): PortfolioSchema {
  if (!exclusionsText.trim()) return schema;

  const keywords = exclusionsText
    .toLowerCase()
    .split(/[,;\n]|\band\b/)
    .map((k) => k.trim())
    .filter((k) => k.length > 2);

  if (keywords.length === 0) return schema;

  const removedFieldIds = new Set<string>();

  const filteredFields = schema.fields.filter((field) => {
    const nameLC = field.name.toLowerCase();
    const labelLC = field.label.toLowerCase();
    const descLC = (field.description ?? "").toLowerCase();

    const excluded = keywords.some(
      (kw) =>
        nameLC.includes(kw) || labelLC.includes(kw) || descLC.includes(kw),
    );

    if (excluded) removedFieldIds.add(field.id);
    return !excluded;
  });

  const filteredGroups = schema.groups
    .map((g) => ({
      ...g,
      fieldIds: g.fieldIds.filter((id) => !removedFieldIds.has(id)),
    }))
    .filter((g) => g.fieldIds.length > 0);

  return {
    ...schema,
    fields: filteredFields,
    groups: filteredGroups,
    version: schema.version + 1,
  };
}

// ---------------------------------------------------------------------------
// LLM serialization
// ---------------------------------------------------------------------------

/**
 * Flatten a structured intent into readable text for LLM prompts.
 * NOT for storage — only for constructing prompt context.
 */
export function serializeForLLM(intent: StructuredIntent): string {
  const sections: string[] = [];

  if (intent.purpose.content.trim()) {
    sections.push(`## Purpose\n${intent.purpose.content.trim()}`);
  }

  if (intent.audience.content.trim()) {
    sections.push(`## Audience\n${intent.audience.content.trim()}`);
  }

  if (intent.exclusions.content.trim()) {
    sections.push(
      `## Exclusions (fields/topics to NOT include)\n${intent.exclusions.content.trim()}`,
    );
  }

  if (intent.constraints.content.trim()) {
    sections.push(`## Constraints\n${intent.constraints.content.trim()}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Dimension cache key
// ---------------------------------------------------------------------------

export function dimensionCacheKey(intent: StructuredIntent): string {
  return `${hashSection(intent.purpose.content.trim())}:${hashSection(intent.audience.content.trim())}`;
}
