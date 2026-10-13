/**
 * Findings: what the responses say about the form — the second half of
 * backpropagation. A finding (an option nobody picks, a question everyone
 * answers the same way, ...) can be sent to the Design workspace as a
 * design probe whose answers apply instantly.
 *
 * Deterministic: computed from `response-stats`, no LLM. A finding's key is
 * stable (`data:<kind>:<fieldId>[:<detail>]`), so the same finding isn't
 * sent twice, and a probe's patches are rebuilt from the *current* form
 * when shown — never replayed from when the finding was sent, which could
 * drop options added since.
 */

import type { DesignProbeOption, Field, PortfolioSchema, ProbeOptionPreview } from "../types";
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
  | "out-of-range";

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
  };
  return findings.sort((a, b) => order[a.kind] - order[b.kind]);
}

// ---------------------------------------------------------------------------
// Findings as design probes
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

/** The design probe for a finding; null when it can't (or no longer) become one. */
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
