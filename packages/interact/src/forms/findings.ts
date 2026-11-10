/**
 * Findings: what the responses say about the form — the second half of
 * backpropagation. A finding (an option nobody picks, a question everyone
 * answers the same way, ...) can be sent to the Design workspace as a
 * elicitation question whose answers apply instantly.
 *
 * Deterministic: computed from `response-stats`, no LLM. A finding's key is
 * stable (`data:<kind>:<fieldId>[:<detail>]`), so the same finding isn't
 * sent twice, and a probe's patches are rebuilt from the *current* form
 * when shown — never replayed from when the finding was sent, which could
 * drop options added since.
 */

import type { DesignProbeOption, Field, PortfolioSchema, ProbeOptionPreview } from "./types";
import type { FieldStats } from "./response-stats";
import { patchFieldFromField, type SchemaPatch } from "./schema-patch";

export const FINDING_THRESHOLDS = {
  /** No findings before this many responses — too little to go on */
  minResponses: 20,
  /** Unused options are only flagged among at least this many */
  minOptions: 3,
  /** A single answer this common makes the question uninformative */
  dominantShare: 0.95,
  /** An optional question skipped this often */
  skippedShare: 0.7,
  /** Answers the form doesn't offer: at least this many and this share */
  unknownMin: 3,
  unknownShare: 0.05,
  /** Numbers outside the field's range: at least this many and this share */
  outOfRangeMin: 3,
  outOfRangeShare: 0.05,
};

export type FindingKind =
  | "unused-option"
  | "dominant-answer"
  | "mostly-skipped"
  | "unknown-values"
  | "out-of-range"
  /** Free-text answers that fall into a few themes (found on request, by a model) */
  | "text-themes";

export interface Finding {
  /** `data:<kind>:<fieldId>[:<detail>]` — stable across visits */
  key: string;
  kind: FindingKind;
  fieldId: string;
  /** Headline, e.g. Nobody picks "Other" */
  text: string;
  /** The numbers behind it, e.g. "0 of 42 answers" */
  evidence: string;
}

const pct = (part: number, whole: number) => Math.round((part / Math.max(1, whole)) * 100);

/** Values listed in an unknown-values finding (and encoded in its key). */
const MAX_LISTED_VALUES = 5;

function findingKey(kind: FindingKind, fieldId: string, detail?: string): string {
  return detail === undefined ? `data:${kind}:${fieldId}` : `data:${kind}:${fieldId}:${detail}`;
}

export function parseFindingKey(
  key: string | null | undefined,
): { kind: FindingKind; fieldId: string; detail?: string } | null {
  const match = key?.match(/^data:([a-z-]+):([^:]+)(?::([\s\S]*))?$/);
  if (!match) return null;
  return { kind: match[1] as FindingKind, fieldId: match[2], detail: match[3] };
}

/** Findings for every field, most actionable first. */
export function detectFindings(
  schema: PortfolioSchema,
  stats: ReadonlyMap<string, FieldStats>,
  t = FINDING_THRESHOLDS,
): Finding[] {
  const findings: Finding[] = [];

  for (const field of schema.fields) {
    const entry = stats.get(field.id);
    if (!entry || entry.stats.total < t.minResponses) continue;
    const { total, empty } = entry.stats;

    if (!field.required && empty / total >= t.skippedShare) {
      findings.push({
        key: findingKey("mostly-skipped", field.id),
        kind: "mostly-skipped",
        fieldId: field.id,
        text: `Most people skip "${field.label}"`,
        evidence: `${pct(empty, total)}% of ${total} responses leave it empty`,
      });
    }

    if (entry.kind === "category") {
      const { buckets, answered, multiple } = entry.stats;
      if (answered < t.minResponses) continue;
      const known = buckets.filter((b) => b.known);
      const unknown = buckets.filter((b) => !b.known);

      if (field.type.kind === "select" && known.length >= t.minOptions) {
        for (const b of known.filter((b) => b.count === 0)) {
          findings.push({
            key: findingKey("unused-option", field.id, b.key),
            kind: "unused-option",
            fieldId: field.id,
            text: `Nobody picks "${b.label}" for "${field.label}"`,
            evidence: `0 of ${answered} answers`,
          });
        }
      }

      const top = known.reduce((a, b) => (b.count > a.count ? b : a), known[0]);
      if (!multiple && top && top.count / answered >= t.dominantShare) {
        findings.push({
          key: findingKey("dominant-answer", field.id, top.key),
          kind: "dominant-answer",
          fieldId: field.id,
          text: `Almost everyone answers "${top.label}" to "${field.label}"`,
          evidence: `${top.count} of ${answered} answers (${pct(top.count, answered)}%)`,
        });
      }

      const unknownCount = unknown.reduce((a, b) => a + b.count, 0);
      if (unknownCount >= t.unknownMin && unknownCount / answered >= t.unknownShare) {
        const listed = unknown.slice(0, MAX_LISTED_VALUES).map((b) => b.key);
        findings.push({
          key: findingKey("unknown-values", field.id, JSON.stringify(listed)),
          kind: "unknown-values",
          fieldId: field.id,
          text: `"${field.label}" has answers the form doesn't offer`,
          evidence: `${unknownCount} answers: ${listed.map((v) => `"${v}"`).join(", ")}${unknown.length > listed.length ? ", …" : ""}`,
        });
      }
    }

    if (entry.kind === "numeric") {
      const { outOfRange, count } = entry.stats;
      if (outOfRange >= t.outOfRangeMin && outOfRange / Math.max(1, count) >= t.outOfRangeShare) {
        findings.push({
          key: findingKey("out-of-range", field.id),
          kind: "out-of-range",
          fieldId: field.id,
          text: `Many answers to "${field.label}" are outside its range`,
          evidence: `${outOfRange} of ${count} answers (${pct(outOfRange, count)}%)`,
        });
      }
    }
  }

  const order: Record<FindingKind, number> = {
    "unknown-values": 0,
    "out-of-range": 1,
    "unused-option": 2,
    "dominant-answer": 3,
    "mostly-skipped": 4,
    "text-themes": 5,
  };
  return findings.sort((a, b) => order[a.kind] - order[b.kind]);
}

// ---------------------------------------------------------------------------
// Themes in text answers
//
// The one finding that needs a model: it reads the answers to one question
// and assigns each to a theme. Only the assignment comes from the model —
// which answers are sent, how many fall under a theme and whether that is
// worth a finding are decided here.
// ---------------------------------------------------------------------------

export const THEME_LIMITS = {
  /** Fewer answers than this aren't worth clustering */
  minAnswers: 8,
  /** Distinct unlisted values of a choice question worth clustering */
  minUnknownValues: 3,
  /** Answers sent per question (the newest) and characters per answer */
  maxAnswers: 150,
  maxAnswerChars: 300,
  /** A theme needs this many answers; a finding needs this many themes */
  minThemeCount: 2,
  minThemes: 2,
  maxThemes: 6,
  /** Questions looked at per request */
  maxFields: 4,
};

export interface ThemeCandidate {
  field: Field;
  /** The answers to cluster, each at most `maxAnswerChars` long */
  answers: string[];
  /** How many responses gave each answer (unlisted choice values repeat) */
  weights: number[];
  /** Responses that answered the question */
  answered: number;
}

const IDENTIFYING_WORDS =
  /\b(name|surname|e-?mail|phone|mobile|telephone|address|street|postcode|zip|contact|birthday|date of birth)\b/i;
const EMAIL_OR_PHONE = /^\S+@\S+\.\S+$|^\+?[\d\s().-]{7,}$/;

/**
 * A free-text question that asks who the respondent is or how to reach
 * them: by its key or label, or because most answers are email addresses
 * or phone numbers.
 */
export function identifiesRespondent(field: Field, answers: readonly string[]): boolean {
  const words = `${field.label} ${field.name.replace(/([a-z\d])([A-Z])/g, "$1 $2")}`;
  if (IDENTIFYING_WORDS.test(words)) return true;
  const contact = answers.filter((a) => EMAIL_OR_PHONE.test(a.trim())).length;
  return answers.length > 0 && contact * 2 >= answers.length;
}

/**
 * The questions whose answers could hide themes: free-text questions with
 * enough answers, and choice questions with several answers the form
 * doesn't offer.
 */
export function themeCandidates(
  schema: PortfolioSchema,
  stats: ReadonlyMap<string, FieldStats>,
  rows: readonly { data: Record<string, unknown>; submittedAt: string }[],
  t = THEME_LIMITS,
): ThemeCandidate[] {
  const candidates: ThemeCandidate[] = [];
  for (const field of schema.fields) {
    if (field.locked) continue;
    const entry = stats.get(field.id);
    if (!entry) continue;

    if (entry.kind === "text" && field.type.kind === "text") {
      if (entry.stats.answered < t.minAnswers) continue;
      const answers = [...rows]
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((row) => row.data[field.name])
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .slice(0, t.maxAnswers)
        .map((v) => v.trim().slice(0, t.maxAnswerChars));
      if (answers.length < t.minAnswers) continue;
      // Names and contact details have no themes, and are the last thing to
      // send to a model
      if (identifiesRespondent(field, answers)) continue;
      candidates.push({
        field,
        answers,
        weights: answers.map(() => 1),
        answered: entry.stats.answered,
      });
    }

    if (entry.kind === "category" && field.type.kind === "select") {
      const unknown = entry.stats.buckets
        .filter((b) => !b.known && b.count > 0)
        .slice(0, t.maxAnswers);
      if (unknown.length < t.minUnknownValues) continue;
      candidates.push({
        field,
        answers: unknown.map((b) => b.key.slice(0, t.maxAnswerChars)),
        weights: unknown.map((b) => b.count),
        answered: entry.stats.answered,
      });
    }
  }
  return candidates.slice(0, t.maxFields);
}

export interface AnswerTheme {
  label: string;
  /** Responses whose answer falls under the theme */
  count: number;
}

/**
 * Count the themes from the model's assignment of answer indices to labels.
 * An index counts once (for the first theme that names it); indices outside
 * the answers, empty labels and repeated labels are ignored. Themes with
 * too few answers are dropped; the rest come back largest first.
 */
export function countThemes(
  assignments: readonly { label: string; indices: readonly number[] }[],
  weights: readonly number[],
  t = THEME_LIMITS,
): AnswerTheme[] {
  const claimed = new Set<number>();
  const themes = new Map<string, AnswerTheme>();
  for (const assignment of assignments) {
    const label = assignment.label?.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!label) continue;
    const key = label.toLowerCase();
    const theme = themes.get(key) ?? { label, count: 0 };
    for (const i of assignment.indices ?? []) {
      if (!Number.isInteger(i) || i < 0 || i >= weights.length || claimed.has(i)) continue;
      claimed.add(i);
      theme.count += weights[i];
    }
    themes.set(key, theme);
  }
  return [...themes.values()]
    .filter((theme) => theme.count >= t.minThemeCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, t.maxThemes);
}

/**
 * The finding for the themes of one question, or null when they don't
 * amount to one. For a choice question the themes are options it could
 * offer (an "unknown-values" finding); for a text question they are the
 * choices it could become.
 */
export function themeFinding(
  candidate: Pick<ThemeCandidate, "field" | "answered">,
  themes: readonly AnswerTheme[],
  t = THEME_LIMITS,
): Finding | null {
  const { field } = candidate;
  const summary = (list: readonly AnswerTheme[]) =>
    list.map((theme) => `${theme.label} (${theme.count})`).join(", ");

  if (field.type.kind === "select") {
    const offered = new Set(field.type.options.map((o) => o.label.trim().toLowerCase()));
    const fresh = themes.filter((theme) => !offered.has(theme.label.toLowerCase()));
    if (fresh.length === 0) return null;
    return {
      key: findingKey("unknown-values", field.id, JSON.stringify(fresh.map((x) => x.label))),
      kind: "unknown-values",
      fieldId: field.id,
      text: `Unlisted answers to "${field.label}" fall into ${fresh.length === 1 ? "one theme" : `${fresh.length} themes`}`,
      evidence: `Grouped by AI: ${summary(fresh)}`,
    };
  }

  if (field.type.kind !== "text" || themes.length < t.minThemes) return null;
  const covered = themes.reduce((a, theme) => a + theme.count, 0);
  return {
    key: findingKey("text-themes", field.id, JSON.stringify(themes.map((x) => x.label))),
    kind: "text-themes",
    fieldId: field.id,
    text: `Answers to "${field.label}" fall into ${themes.length} themes`,
    evidence: `Grouped by AI, ${covered} of ${candidate.answered} answers: ${summary(themes)}`,
  };
}

// ---------------------------------------------------------------------------
// Findings as elicitation questions
// ---------------------------------------------------------------------------

const KEEP: ProbeOptionPreview = { summary: "Keeps the form as it is", schemaPatch: {} };

function optionLabelOf(field: Field, value: string): string {
  return field.type.kind === "select"
    ? (field.type.options.find((o) => o.value === value)?.label ?? value)
    : value;
}

/**
 * A finding's probe answers, built from the form as it is now. Empty when
 * the finding no longer applies (field gone, option already removed, ...).
 */
function findingOptions(
  key: string,
  schema: PortfolioSchema,
): { text: string; options: (DesignProbeOption & { preview: ProbeOptionPreview })[] } | null {
  const parsed = parseFindingKey(key);
  const field = parsed && schema.fields.find((f) => f.id === parsed.fieldId);
  if (!parsed || !field) return null;
  const base = patchFieldFromField(field);
  const update = (patch: Partial<typeof base>): SchemaPatch => ({
    updateFields: [{ ...base, ...patch }],
  });
  const keep = { value: "keep", label: "Keep it", preview: KEEP };
  const removeField = {
    value: "removeField",
    label: "Remove the question",
    preview: {
      summary: `Removes "${field.label}"`,
      schemaPatch: { removeFieldKeys: [field.name] },
    },
  };

  switch (parsed.kind) {
    case "unused-option": {
      if (field.type.kind !== "select") return null;
      const value = parsed.detail ?? "";
      const options = field.type.options;
      if (!options.some((o) => o.value === value)) return null;
      const label = optionLabelOf(field, value);
      return {
        text: `Remove "${label}" from "${field.label}"?`,
        options: [
          {
            value: "removeOption",
            label: `Remove "${label}"`,
            preview: {
              summary: `Removes the option "${label}"`,
              schemaPatch: update({
                validation: { options: options.filter((o) => o.value !== value) },
              }),
            },
          },
          keep,
        ],
      };
    }
    case "dominant-answer": {
      const answer = optionLabelOf(field, parsed.detail ?? "");
      return {
        text: `Everyone answers "${answer}" — keep asking "${field.label}"?`,
        options: [
          removeField,
          ...(field.required
            ? [
                {
                  value: "makeOptional",
                  label: "Make it optional",
                  preview: {
                    summary: `Makes "${field.label}" optional`,
                    schemaPatch: update({ required: false }),
                  },
                },
              ]
            : []),
          keep,
        ],
      };
    }
    case "mostly-skipped":
      return {
        text: `Most people skip "${field.label}" — keep it?`,
        options: [removeField, keep],
      };
    case "unknown-values": {
      if (field.type.kind !== "select") return null;
      let values: string[] = [];
      try {
        values = JSON.parse(parsed.detail ?? "[]");
      } catch {
        return null;
      }
      const existing = new Set(field.type.options.map((o) => o.label.trim().toLowerCase()));
      const fresh = values.filter((v) => typeof v === "string" && !existing.has(v.trim().toLowerCase()));
      if (fresh.length === 0) return null;
      return {
        text: `Add ${fresh.map((v) => `"${v}"`).join(", ")} as options of "${field.label}"?`,
        options: [
          {
            value: "addOptions",
            label: fresh.length === 1 ? "Add it" : "Add them",
            preview: {
              summary: `Adds ${fresh.length === 1 ? "an option" : `${fresh.length} options`}`,
              schemaPatch: update({
                validation: {
                  options: [
                    ...field.type.options,
                    ...fresh.map((v) => ({ label: v, value: v })),
                  ],
                },
              }),
            },
          },
          { ...keep, label: "Keep the options" },
        ],
      };
    }
    case "text-themes": {
      if (field.type.kind !== "text") return null;
      let labels: string[] = [];
      try {
        labels = (JSON.parse(parsed.detail ?? "[]") as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.trim() !== "",
        );
      } catch {
        return null;
      }
      if (labels.length < 2) return null;
      const hasOther = labels.some((l) => l.trim().toLowerCase() === "other");
      const choices = hasOther ? labels : [...labels, "Other"];
      return {
        text: `Turn "${field.label}" into a choice?`,
        options: [
          {
            value: "makeChoice",
            label: "Offer these choices",
            preview: {
              summary: `Makes it a choice: ${choices.join(", ")}`,
              schemaPatch: update({
                type: "select",
                validation: { options: choices.map((l) => ({ label: l, value: l })) },
              }),
            },
          },
          { ...keep, label: "Keep free text" },
        ],
      };
    }
    case "out-of-range": {
      if (field.type.kind !== "number") return null;
      const { min, max } = field.type;
      const range = `${min ?? "any"} to ${max ?? "any"}`;
      return {
        text: `Answers to "${field.label}" fall outside ${range} — explain the range?`,
        options: [
          {
            value: "addHint",
            label: "Explain the range",
            preview: {
              summary: `Tells respondents to enter ${range}`,
              schemaPatch: update({ tooltip: `Enter a number from ${range}.` }),
            },
          },
          keep,
        ],
      };
    }
  }
}

/** The elicitation question for a finding; null when it can't (or no longer) become one. */
export function findingProbe(
  finding: Finding,
  schema: PortfolioSchema,
): { text: string; explanation: string; options: DesignProbeOption[] } | null {
  const built = findingOptions(finding.key, schema);
  if (!built) return null;
  return {
    text: built.text,
    explanation: `From the responses: ${finding.evidence}.`,
    options: built.options,
  };
}

/**
 * The live preview of a finding probe's answer, rebuilt on the current form;
 * null when the finding no longer applies — the probe is stale.
 */
export function findingOptionPreview(
  key: string | null | undefined,
  optionValue: string,
  schema: PortfolioSchema,
): ProbeOptionPreview | null {
  if (!key) return null;
  return findingOptions(key, schema)?.options.find((o) => o.value === optionValue)?.preview ?? null;
}

/** Whether a finding (by key) still applies to the current form. */
export function findingApplies(key: string | null | undefined, schema: PortfolioSchema): boolean {
  return !!key && findingOptions(key, schema) !== null;
}
