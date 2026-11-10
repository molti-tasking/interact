/**
 * Pretest: what simulated respondents say about a draft form.
 *
 * Before anyone real answers, a model plays a varied set of respondents
 * (`simulateRespondentsAction`). Each fills in the form and notes where it
 * had trouble — a question it didn't understand, couldn't answer, found too
 * personal, or whose options didn't include its answer.
 *
 * Everything here is deterministic. The model only supplies answers and
 * notes; how many respondents had a problem is counted from them, and the
 * answers go through the same statistics and findings as real responses
 * (`response-stats`, `detectFindings`). Simulated answers are never stored
 * as responses.
 */

import { coerceValueForField } from "./values";
import type {
  DesignProbeOption,
  Field,
  PatchScope,
  PortfolioSchema,
  ProbeOptionPreview,
} from "./types";
import {
  detectFindings,
  findingProbe,
  FINDING_THRESHOLDS,
  type Finding,
} from "./findings";
import { buildFieldStats, type StatsRow } from "./response-stats";
import { applySchemaPatch, type SchemaPatch } from "./schema-patch";

export const TROUBLE_KINDS = [
  "unclear",
  "cant-answer",
  "missing-option",
  "too-personal",
] as const;
export type TroubleKind = (typeof TROUBLE_KINDS)[number];

export interface RespondentTrouble {
  /** Field key (`Field.name`) */
  field: string;
  kind: TroubleKind;
  /** In the respondent's words, one short sentence */
  note: string;
  /** For "missing-option": the answer the respondent wanted to give */
  suggestion?: string | null;
}

export interface SimulatedRespondent {
  /** Who this is, one line — e.g. "Retired teacher, first time at the club" */
  persona: string;
  /** Answers by field key, as the model wrote them (strings; null = skipped) */
  answers: Record<string, string | null>;
  troubles: RespondentTrouble[];
}

/** Field kinds a simulated respondent can answer. */
export function pretestFields(schema: PortfolioSchema): Field[] {
  return schema.fields.filter(
    (f) => f.type.kind !== "file" && f.type.kind !== "group" && f.type.kind !== "reference",
  );
}

/**
 * Keep only what refers to the form: answers and troubles for fields that
 * exist, known trouble kinds, bounded text. Respondents left with nothing
 * (no answers, no troubles) are dropped.
 */
export function sanitizeRespondents(
  schema: PortfolioSchema,
  raw: readonly {
    persona?: string | null;
    answers?: readonly { field: string; value: string | null }[] | null;
    troubles?: readonly {
      field: string;
      kind: string;
      note?: string | null;
      suggestion?: string | null;
    }[] | null;
  }[],
): SimulatedRespondent[] {
  const keys = new Set(pretestFields(schema).map((f) => f.name));
  const result: SimulatedRespondent[] = [];
  for (const r of raw) {
    const answers: Record<string, string | null> = {};
    for (const a of r.answers ?? []) {
      const key = a.field?.trim();
      if (!key || !keys.has(key) || key in answers) continue;
      const value = typeof a.value === "string" ? a.value.trim().slice(0, 500) : null;
      answers[key] = value ? value : null;
    }
    const troubles: RespondentTrouble[] = [];
    const seen = new Set<string>();
    for (const t of r.troubles ?? []) {
      const key = t.field?.trim();
      if (!key || !keys.has(key)) continue;
      if (!(TROUBLE_KINDS as readonly string[]).includes(t.kind)) continue;
      // One trouble of a kind per field and respondent
      const id = `${key}:${t.kind}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const suggestion = t.suggestion?.trim().slice(0, 80);
      troubles.push({
        field: key,
        kind: t.kind as TroubleKind,
        note: (t.note ?? "").trim().slice(0, 240),
        ...(t.kind === "missing-option" && suggestion ? { suggestion } : {}),
      });
    }
    if (Object.keys(answers).length === 0 && troubles.length === 0) continue;
    result.push({
      persona: (r.persona ?? "").trim().slice(0, 160) || "Respondent",
      answers,
      troubles,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Answers as rows for the response statistics
// ---------------------------------------------------------------------------

/**
 * The simulated answers as response rows, typed per field like stored
 * responses. An answer that isn't one of a select's options is kept as
 * written, so it counts as an answer the form doesn't offer; anything else
 * that doesn't fit the field's type is left empty.
 */
export function pretestRows(
  schema: PortfolioSchema,
  respondents: readonly SimulatedRespondent[],
): StatsRow[] {
  const fields = pretestFields(schema);
  return respondents.map((respondent, i) => {
    const data: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = respondent.answers[field.name];
      if (raw === null || raw === undefined) continue;
      const coerced = coerceValueForField(field, raw);
      if (coerced.ok) {
        if (coerced.value !== undefined) data[field.name] = coerced.value;
      } else if (field.type.kind === "select") {
        data[field.name] = raw;
      }
    }
    return {
      id: `pretest-${i + 1}`,
      data,
      // Stable and distinct, so "newest first" orderings keep the given order
      submittedAt: new Date(Date.UTC(2000, 0, 1, 0, 0, i)).toISOString(),
    };
  });
}

/**
 * Thresholds for findings from a pretest: a handful of simulated
 * respondents, so shares must be near-total and the count-based checks that
 * need a real sample (unused options) are left out (`PRETEST_FINDING_KINDS`).
 */
export const PRETEST_THRESHOLDS: typeof FINDING_THRESHOLDS = {
  ...FINDING_THRESHOLDS,
  minResponses: 6,
  dominantShare: 1,
  skippedShare: 0.75,
  unknownMin: 2,
  unknownShare: 0.15,
  outOfRangeMin: 2,
  outOfRangeShare: 0.15,
};

const PRETEST_FINDING_KINDS: ReadonlySet<Finding["kind"]> = new Set([
  "mostly-skipped",
  "unknown-values",
  "out-of-range",
  "dominant-answer",
]);

/** Findings the simulated answers support (same detection as real responses). */
export function pretestFindings(
  schema: PortfolioSchema,
  respondents: readonly SimulatedRespondent[],
): Finding[] {
  const rows = pretestRows(schema, respondents);
  return detectFindings(schema, buildFieldStats(schema, rows), PRETEST_THRESHOLDS).filter(
    (f) => PRETEST_FINDING_KINDS.has(f.kind),
  );
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface PretestIssue {
  /** Stable for a field and kind: `pretest:<kind>:<fieldId>` */
  key: string;
  kind: TroubleKind | "answers";
  fieldId: string;
  fieldLabel: string;
  /** Headline, e.g. `3 of 12 couldn't answer "Member number"` */
  text: string;
  /** Respondents with this issue, and how many were simulated */
  count: number;
  total: number;
  /** Up to three of them, in their words */
  examples: { persona: string; note: string }[];
  /** The design question it becomes */
  probe: {
    text: string;
    options: DesignProbeOption[];
    /** True when every option's change is already worked out */
    ready: boolean;
  };
}

const KIND_RANK: Record<PretestIssue["kind"], number> = {
  "cant-answer": 0,
  "missing-option": 1,
  answers: 2,
  unclear: 3,
  "too-personal": 4,
};

const MAX_EXAMPLES = 3;
const MAX_SUGGESTED_OPTIONS = 4;

function withScope(
  schema: PortfolioSchema,
  summary: string,
  schemaPatch: SchemaPatch,
): ProbeOptionPreview {
  const { applied } = applySchemaPatch(schema, schemaPatch);
  const scope: PatchScope = {
    added: applied.added,
    updated: applied.updated,
    removed: applied.removed,
  };
  return { summary, schemaPatch, scope };
}

function option(
  schema: PortfolioSchema,
  value: string,
  label: string,
  summary: string,
  patch: SchemaPatch,
): DesignProbeOption {
  return { value, label, preview: withScope(schema, summary, patch) };
}

const keep = (schema: PortfolioSchema, label = "Keep it"): DesignProbeOption =>
  option(schema, "keep", label, "Keeps the form as it is", {});

function removeOption(schema: PortfolioSchema, field: Field): DesignProbeOption {
  return option(schema, "removeField", "Remove the question", `Removes "${field.label}"`, {
    removeFieldKeys: [field.name],
  });
}

function optionalOption(schema: PortfolioSchema, field: Field): DesignProbeOption {
  return option(schema, "makeOptional", "Make it optional", `Makes "${field.label}" optional`, {
    updateFields: [{ key: field.name, required: false }],
  });
}

/** The design question for one kind of trouble with one field. */
function troubleProbe(
  schema: PortfolioSchema,
  field: Field,
  kind: TroubleKind,
  suggestions: string[],
): PretestIssue["probe"] | null {
  // Locked fields are never changed by a probe answer — nothing to offer
  if (field.locked) return null;

  switch (kind) {
    case "missing-option": {
      if (field.type.kind !== "select") return null;
      const existing = new Set(field.type.options.map((o) => o.label.trim().toLowerCase()));
      const fresh = suggestions.filter((s) => !existing.has(s.trim().toLowerCase()));
      if (fresh.length === 0) return null;
      const quoted = fresh.map((s) => `"${s}"`).join(", ");
      return {
        text: `Add ${quoted} to "${field.label}"?`,
        ready: true,
        options: [
          option(
            schema,
            "addOptions",
            fresh.length === 1 ? "Add it" : "Add them",
            `Adds ${fresh.length === 1 ? `the option "${fresh[0]}"` : `${fresh.length} options`}`,
            {
              updateFields: [
                {
                  key: field.name,
                  validation: {
                    options: [
                      ...field.type.options,
                      ...fresh.map((label) => ({ label, value: label })),
                    ],
                  },
                },
              ],
            },
          ),
          keep(schema, "Keep the options"),
        ],
      };
    }
    case "cant-answer":
      return {
        text: `Some can't answer "${field.label}" — keep it?`,
        ready: true,
        options: [
          ...(field.required ? [optionalOption(schema, field)] : []),
          removeOption(schema, field),
          keep(schema),
        ],
      };
    case "too-personal":
      return {
        text: `"${field.label}" feels too personal — keep it?`,
        ready: true,
        options: [
          ...(field.required ? [optionalOption(schema, field)] : []),
          removeOption(schema, field),
          keep(schema),
        ],
      };
    case "unclear":
      // How to reword depends on what was unclear: the answers' changes are
      // worked out in the background like any other design question
      return {
        text: `"${field.label}" is unclear to some — fix it?`,
        ready: false,
        options: [
          { value: "reword", label: "Reword the question" },
          { value: "explain", label: "Add a short explanation" },
          { value: "keep", label: "Keep it" },
        ],
      };
  }
}

const HEADLINE: Record<TroubleKind, (count: number, total: number, label: string) => string> = {
  "cant-answer": (c, t, l) => `${c} of ${t} couldn't answer "${l}"`,
  "missing-option": (c, t, l) => `${c} of ${t} didn't find their answer in "${l}"`,
  unclear: (c, t, l) => `${c} of ${t} found "${l}" unclear`,
  "too-personal": (c, t, l) => `${c} of ${t} found "${l}" too personal`,
};

/** Suggestions by how many respondents made them (case-insensitive), most first. */
function rankSuggestions(troubles: readonly RespondentTrouble[]): string[] {
  const tally = new Map<string, { label: string; count: number }>();
  for (const t of troubles) {
    const label = t.suggestion?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    const entry = tally.get(key) ?? { label, count: 0 };
    entry.count++;
    tally.set(key, entry);
  }
  return [...tally.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SUGGESTED_OPTIONS)
    .map((e) => e.label);
}

/**
 * What the pretest found, most serious first: troubles the respondents
 * noted (counted per field and kind), then what their answers show
 * (`pretestFindings`). Every count is the number of simulated respondents
 * whose own answers or notes show the issue.
 */
export function pretestIssues(
  schema: PortfolioSchema,
  respondents: readonly SimulatedRespondent[],
): PretestIssue[] {
  const total = respondents.length;
  if (total === 0) return [];
  const byName = new Map(pretestFields(schema).map((f) => [f.name, f]));

  const groups = new Map<
    string,
    {
      field: Field;
      kind: TroubleKind;
      troubles: RespondentTrouble[];
      personas: string[];
      who: Set<number>;
    }
  >();
  respondents.forEach((respondent, index) => {
    for (const trouble of respondent.troubles) {
      const field = byName.get(trouble.field);
      if (!field) continue;
      const id = `${trouble.kind}:${field.id}`;
      const group = groups.get(id) ?? {
        field,
        kind: trouble.kind,
        troubles: [],
        personas: [],
        who: new Set<number>(),
      };
      // A respondent counts once per issue, however many notes they left
      if (!group.who.has(index)) {
        group.who.add(index);
        group.troubles.push(trouble);
        group.personas.push(respondent.persona);
      }
      groups.set(id, group);
    }
  });

  const issues: PretestIssue[] = [];
  for (const { field, kind, troubles, personas } of groups.values()) {
    const probe = troubleProbe(schema, field, kind, rankSuggestions(troubles));
    if (!probe) continue;
    issues.push({
      key: `pretest:${kind}:${field.id}`,
      kind,
      fieldId: field.id,
      fieldLabel: field.label,
      text: HEADLINE[kind](troubles.length, total, field.label),
      count: troubles.length,
      total,
      examples: troubles
        .map((t, i) => ({ persona: personas[i], note: t.note || t.suggestion || "" }))
        .filter((e) => e.note)
        .slice(0, MAX_EXAMPLES),
      probe,
    });
  }

  // What the answers themselves show. A field whose trouble is already
  // listed for the same reason isn't listed twice.
  const hasMissingOption = new Set(
    issues.filter((i) => i.kind === "missing-option").map((i) => i.fieldId),
  );
  for (const finding of pretestFindings(schema, respondents)) {
    if (finding.kind === "unknown-values" && hasMissingOption.has(finding.fieldId)) continue;
    const field = schema.fields.find((f) => f.id === finding.fieldId);
    const built = field && !field.locked ? findingProbe(finding, schema) : null;
    if (!field || !built) continue;
    issues.push({
      key: `pretest:${finding.kind}:${field.id}`,
      kind: "answers",
      fieldId: field.id,
      fieldLabel: field.label,
      text: finding.text,
      // The share is in the evidence line; the finding met its threshold
      count: 0,
      total,
      examples: [{ persona: "Answers", note: finding.evidence }],
      probe: {
        text: built.text,
        ready: true,
        options: built.options.map((o) =>
          o.preview
            ? { ...o, preview: withScope(schema, o.preview.summary, o.preview.schemaPatch) }
            : o,
        ),
      },
    });
  }

  return issues.sort(
    (a, b) => b.count - a.count || KIND_RANK[a.kind] - KIND_RANK[b.kind],
  );
}

/** The explanation shown on a pretest probe: where the question comes from. */
export function pretestExplanation(issue: PretestIssue): string {
  const first = issue.examples[0];
  const evidence =
    issue.kind === "answers"
      ? (first?.note ?? "")
      : `${issue.count} of ${issue.total}${first ? ` — e.g. “${first.note}”` : ""}`;
  return `From a pretest with ${issue.total} simulated respondents${evidence ? `: ${evidence}` : ""}.`.slice(
    0,
    400,
  );
}
