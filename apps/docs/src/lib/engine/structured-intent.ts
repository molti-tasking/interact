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
  Field,
  FieldType,
  IntentSection,
  PortfolioSchema,
  PipelineStrategy,
  SectionKey,
  StructuredIntent,
} from "../types";
import { pruneGroups } from "./schema-patch";

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

const SECTION_KEYS: SectionKey[] = [
  "purpose",
  "audience",
  "exclusions",
  "constraints",
];

/**
 * Section key for a `## Heading` line, or null. Tolerates the decorated
 * headings `serializeForLLM` emits ("## Exclusions (fields/topics to NOT
 * include)") and trailing colons, since LLMs echo those back.
 */
function sectionKeyForLine(line: string): SectionKey | null {
  const match = line.match(/^##\s+(.+?)\s*$/);
  if (!match) return null;
  const heading = match[1]
    .replace(/\s*\(.*\)$/, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
  return HEADING_TO_KEY[heading] ?? null;
}

/** Split text on recognized section headings. Text before the first heading is purpose. */
function splitSections(text: string): {
  contents: Record<SectionKey, string>;
  present: Set<SectionKey>;
} {
  const buckets: Record<SectionKey, string[]> = {
    purpose: [],
    audience: [],
    exclusions: [],
    constraints: [],
  };
  const present = new Set<SectionKey>();
  let currentKey: SectionKey = "purpose";

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const key = sectionKeyForLine(line);
    if (key) {
      currentKey = key;
      present.add(key);
      continue;
    }
    buckets[currentKey].push(line);
  }

  const contents = {} as Record<SectionKey, string>;
  for (const key of SECTION_KEYS) contents[key] = buckets[key].join("\n").trim();
  return { contents, present };
}

/** Keep the previous section object (and timestamp) when content is unchanged. */
function withContent(
  prev: IntentSection,
  content: string,
  now: string,
): IntentSection {
  return content.trim() === prev.content.trim()
    ? prev
    : { content, updatedAt: now };
}

/** Whether `serializeToMarkdown(intent)` renders section headings. */
function rendersHeadings(intent: StructuredIntent): boolean {
  return SECTION_KEYS.some(
    (k) => k !== "purpose" && intent[k].content.trim() !== "",
  );
}

/**
 * Parse markdown from the editor back into StructuredIntent.
 *
 * The editor shows `serializeToMarkdown(prev)`, so the text is treated as
 * the complete projection of the intent:
 * - Text with at least one recognized `## Section` heading: content is split
 *   by heading; text before the first heading is purpose; any section
 *   without a heading is cleared (the user deleted that block).
 * - Text without any recognized heading maps to purpose (kept verbatim so
 *   typing a trailing newline isn't swallowed). Nothing else is cleared —
 *   except when the editor was showing headings (`prev` has a non-purpose
 *   section) and the user removed all of them: then the other sections are
 *   cleared too, otherwise the deleted blocks would silently survive and
 *   reappear on the next render.
 *
 * Use `mergeIntentText` for LLM output, where a missing section means
 * "unchanged" rather than "deleted".
 */
export function parseFromMarkdown(
  markdown: string,
  prev: StructuredIntent,
): StructuredIntent {
  const now = new Date().toISOString();
  const { contents, present } = splitSections(markdown);

  if (present.size === 0) {
    // Compare verbatim: a trimmed comparison would drop a just-typed newline.
    const purpose =
      markdown === prev.purpose.content
        ? prev.purpose
        : { content: markdown, updatedAt: now };
    if (!rendersHeadings(prev)) return { ...prev, purpose };
    return {
      purpose,
      audience: withContent(prev.audience, "", now),
      exclusions: withContent(prev.exclusions, "", now),
      constraints: withContent(prev.constraints, "", now),
    };
  }

  const result = {} as StructuredIntent;
  for (const key of SECTION_KEYS) {
    result[key] = withContent(prev[key], contents[key], now);
  }
  return result;
}

/**
 * Map intent text returned by an LLM (usually an edited echo of
 * `serializeForLLM`) back onto a StructuredIntent.
 *
 * Unlike `parseFromMarkdown`, a section the model left out is kept — an
 * omission is not a deletion. Text without any heading is the new purpose.
 * The purpose is passed through `sanitizePurposeText`.
 */
export function mergeIntentText(
  text: string,
  prev: StructuredIntent,
): StructuredIntent {
  const now = new Date().toISOString();
  const { contents, present } = splitSections(text);

  if (present.size === 0) {
    const purpose = sanitizePurposeText(text);
    return purpose
      ? { ...prev, purpose: withContent(prev.purpose, purpose, now) }
      : prev;
  }

  const result: StructuredIntent = { ...prev };
  for (const key of SECTION_KEYS) {
    // Purpose is "present" when there's text before the first heading too.
    const isPresent =
      present.has(key) || (key === "purpose" && contents.purpose !== "");
    if (!isPresent) continue;
    const content =
      key === "purpose" ? sanitizePurposeText(contents[key]) : contents[key];
    result[key] = withContent(prev[key], content, now);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

export interface IntentDelta {
  changedSections: SectionKey[];
  isFirstGeneration: boolean;
  /**
   * An exclusion term present before is gone now (deleted or reworded).
   * Filtering can't bring back fields an old exclusion removed, so this
   * forces a full run.
   */
  exclusionsRemoved?: boolean;
}

export function computeDelta(
  prev: StructuredIntent,
  next: StructuredIntent,
): IntentDelta {
  const isFirstGeneration = SECTION_KEYS.every(
    (k) => prev[k].content.trim() === "",
  );

  const changedSections = SECTION_KEYS.filter(
    (k) =>
      hashSection(prev[k].content.trim()) !==
      hashSection(next[k].content.trim()),
  );

  let exclusionsRemoved = false;
  if (changedSections.includes("exclusions")) {
    const nextTerms = new Set(
      parseExclusionTerms(next.exclusions.content).map((t) => t.join(" ")),
    );
    exclusionsRemoved = parseExclusionTerms(prev.exclusions.content).some(
      (t) => !nextTerms.has(t.join(" ")),
    );
  }

  return { changedSections, isFirstGeneration, exclusionsRemoved };
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
    // Filtering only removes fields — it can't restore what a deleted
    // exclusion had removed.
    return delta.exclusionsRemoved ? { kind: "full" } : { kind: "filter-only" };
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

/**
 * Filler words in exclusion text ("Don't ask about their salary or phone
 * number") — dropped so only the topic words remain.
 */
const EXCLUSION_STOPWORDS = new Set([
  "a", "an", "the", "any", "anything", "all", "some", "no", "not", "none",
  "never", "nothing", "dont", "do", "does", "doesnt", "didnt", "wont", "cant",
  "cannot", "should", "shouldnt", "must", "mustnt", "need", "needs", "please",
  "ask", "asking", "asked", "about", "for", "of", "to", "on", "in", "at", "by",
  "with", "without", "from", "into", "regarding", "related", "relating",
  "concerning", "include", "including", "included", "includes", "collect",
  "collecting", "collected", "capture", "capturing", "request", "requesting",
  "require", "requiring", "exclude", "excluding", "excluded", "skip", "avoid",
  "omit", "leave", "out", "remove", "drop", "field", "fields", "question",
  "questions", "topic", "topics", "info", "information", "detail", "details",
  "data", "number", "numbers", "their", "them", "they", "his", "her", "its",
  "my", "our", "your", "we", "us", "you", "it", "this", "that", "these",
  "those", "also", "other", "etc", "be", "is", "are", "was", "were", "either",
  "neither", "only", "just", "such", "as", "eg", "ie",
]);

/** Crude singularization so "phones"/"phone" and "addresses"/"address" match. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** Lowercase words; apostrophes and in-word hyphens are joined ("e-mail" → "email"). */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/(\p{L})-(?=\p{L})/gu, "$1")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Split camelCase / snake_case / digit boundaries: "scope3Emissions" → scope 3 emissions. */
function splitIdentifier(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2");
}

/**
 * Parse free-text exclusions into terms (each a list of stemmed words).
 * Splits on newlines, punctuation and "and"/"or"/"nor", then drops filler:
 * "Don't ask about salary or phone number" → [["salary"], ["phone"]].
 */
export function parseExclusionTerms(text: string): string[][] {
  const terms: string[][] = [];
  const seen = new Set<string>();
  for (const chunk of text.split(/[\n,;:/|&+•.!?()[\]]|\b(?:and|or|nor|plus)\b/i)) {
    const term = words(chunk)
      .filter((w) => w.length >= 2 && !EXCLUSION_STOPWORDS.has(w))
      .map(stem);
    const key = term.join(" ");
    if (term.length > 0 && !seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

/** Stemmed tokens of a field's name (camelCase split) and label. */
function fieldTokens(field: Field): Set<string> {
  const nameWords = words(splitIdentifier(field.name));
  const tokens = new Set([...nameWords, ...words(field.label)].map(stem));
  // Adjacent name parts joined, so "followUp" also matches "follow-up".
  for (let i = 0; i + 1 < nameWords.length; i++) {
    tokens.add(stem(nameWords[i] + nameWords[i + 1]));
  }
  return tokens;
}

export interface ExclusionFilterResult {
  schema: PortfolioSchema;
  /** Fields that matched an exclusion term and were removed */
  removedFields: Field[];
  /** Parsed terms, for display ("salary", "phone") */
  terms: string[];
}

/**
 * Remove fields matching the exclusions. A term matches a field when every
 * word of the term is a whole word of the field's name or label (so "age"
 * matches `age`/`ageGroup` but not `message` or `pageCount`, and "date of
 * birth" matches `birthDate`). Descriptions are not matched.
 */
export function filterExcludedFields(
  schema: PortfolioSchema,
  exclusionsText: string,
): ExclusionFilterResult {
  const terms = parseExclusionTerms(exclusionsText);
  const display = terms.map((t) => t.join(" "));
  if (terms.length === 0) return { schema, removedFields: [], terms: display };

  const removedFields: Field[] = [];
  const keptFields = schema.fields.filter((field) => {
    const tokens = fieldTokens(field);
    const excluded = terms.some((term) => term.every((w) => tokens.has(w)));
    if (excluded) removedFields.push(field);
    return !excluded;
  });

  if (removedFields.length === 0) {
    return { schema, removedFields, terms: display };
  }

  return {
    schema: {
      ...schema,
      fields: keptFields,
      groups: pruneGroups(
        schema.groups ?? [],
        new Set(keptFields.map((f) => f.id)),
      ),
      version: schema.version + 1,
    },
    removedFields,
    terms: display,
  };
}

/** `filterExcludedFields` returning only the schema (unchanged when nothing matched). */
export function applyExclusions(
  schema: PortfolioSchema,
  exclusionsText: string,
): PortfolioSchema {
  return filterExcludedFields(schema, exclusionsText).schema;
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

/** Compact one-line description of a field type for prompts. */
function describeFieldType(type: FieldType): string {
  switch (type.kind) {
    case "text":
      return type.maxLength ? `string, max ${type.maxLength} chars` : "string";
    case "number": {
      const parts = ["number"];
      if (type.min !== undefined) parts.push(`min ${type.min}`);
      if (type.max !== undefined) parts.push(`max ${type.max}`);
      if (type.unit) parts.push(`unit ${type.unit}`);
      return parts.join(", ");
    }
    case "select": {
      const options = type.options
        .map((o) => (o.label === o.value ? o.label : `${o.label}=${o.value}`))
        .join(" | ");
      return `select${type.multiple ? " multiple" : ""}: [${options}]`;
    }
    case "date":
      return type.range ? `date ${type.range.min}..${type.range.max}` : "date";
    case "boolean":
      return "boolean";
    case "file":
      return type.accept.length ? `file: ${type.accept.join(", ")}` : "file";
    case "scale":
      return `scale ${type.min}-${type.max}${type.labels ? ` (${type.labels.low} … ${type.labels.high})` : ""}`;
    case "reference":
      return `reference → ${type.targetPortfolioId}`;
    case "group":
      return `group {${type.fields.map((f) => f.name).join(", ")}}`;
  }
}

/**
 * Compact schema rendering for prompts where the model only needs to READ
 * the schema — one line per field instead of pretty-printed JSON:
 * `- key: "Label" (type[, options][, required]) — description`.
 */
export function serializeSchemaForLLM(
  schema: PortfolioSchema,
  opts: { ids?: boolean; constraints?: boolean; groups?: boolean } = {},
): string {
  if (schema.fields.length === 0) return "(no fields yet)";

  const lines = schema.fields.map((f) => {
    const id = opts.ids ? `[${f.id}] ` : "";
    const required = f.required ? ", required" : "";
    const description = f.description ? ` — ${f.description}` : "";
    let line = `- ${id}${f.name}: ${JSON.stringify(f.label)} (${describeFieldType(f.type)}${required})${description}`;
    if (opts.constraints && f.constraints.length > 0) {
      const constraints = f.constraints
        .map((c) => `${c.type} ${JSON.stringify(c.rule)} → ${JSON.stringify(c.message)}`)
        .join("; ");
      line += `\n    constraints: ${constraints}`;
    }
    return line;
  });

  if (opts.groups && schema.groups.length > 0) {
    const nameById = new Map(schema.fields.map((f) => [f.id, f.name]));
    lines.push("Groups:");
    for (const g of schema.groups) {
      const members = g.fieldIds.map((id) => nameById.get(id) ?? `${id} (missing)`);
      const id = opts.ids ? `[${g.id}] ` : "";
      lines.push(`- ${id}${JSON.stringify(g.label)}: ${members.join(", ")}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// LLM output normalization
// ---------------------------------------------------------------------------

/** Lowercase the first letter, or a leading acronym run ("GTIN14" → "gtin14"). */
function lowerFirst(word: string): string {
  const acronym = word.match(/^(\p{Lu}+)(?=\p{Lu}\p{Ll}|[^\p{L}]|$)/u);
  if (acronym && acronym[1].length > 1) {
    return acronym[1].toLowerCase() + word.slice(acronym[1].length);
  }
  return word.charAt(0).toLowerCase() + word.slice(1);
}

/**
 * Coerce an LLM-proposed field key to a camelCase identifier ("First Name",
 * "first_name" → "firstName"). Field names are the merge key between
 * regenerations and the key of stored responses, so they must be stable,
 * valid identifiers. Keys that already are identifiers only get a lowercase
 * first letter.
 */
export function normalizeFieldKey(raw: string, fallback = "field"): string {
  const trimmed = raw.trim();
  if (/^\p{L}[\p{L}\p{N}]*$/u.test(trimmed)) return lowerFirst(trimmed);
  const parts = trimmed.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return fallback;
  const key = parts
    .map((p, i) =>
      i === 0
        ? lowerFirst(p === p.toUpperCase() ? p.toLowerCase() : p)
        : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join("");
  return /^\p{N}/u.test(key) ? `${fallback}${key}` : key;
}

// ---------------------------------------------------------------------------
// Dimension cache key
// ---------------------------------------------------------------------------

export function dimensionCacheKey(intent: StructuredIntent): string {
  return `${hashSection(intent.purpose.content.trim())}:${hashSection(intent.audience.content.trim())}`;
}
