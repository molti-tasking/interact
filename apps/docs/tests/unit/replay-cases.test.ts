import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { caseProblem, parseCases, serializeCases, type ReplayCase } from "../evaluation/replay/cases";
import {
  casesFromStudyExport,
  parseDecisionRationale,
  parseSyncRationale,
  type StudyExportLike,
} from "../evaluation/replay/from-study-export";
import {
  formatValue,
  renderMarkdown,
  summarize,
  type RunMeta,
} from "../evaluation/replay/summary";
import type { CaseResult } from "../evaluation/replay/execute";

const intent = (purpose: string) => ({
  purpose: { content: purpose, updatedAt: "t" },
  audience: { content: "", updatedAt: "t" },
  exclusions: { content: "", updatedAt: "t" },
  constraints: { content: "", updatedAt: "t" },
});
const schema = (...names: string[]) => ({
  fields: names.map((name) => ({
    id: `f-${name}`,
    name,
    label: name,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
  })),
  groups: [],
  version: 1,
});

describe("case files", () => {
  it("ships a valid seed dataset covering every operation", () => {
    const file = path.resolve(__dirname, "../evaluation/replay/cases/seed.jsonl");
    const cases = parseCases(fs.readFileSync(file, "utf8"), file);
    expect(new Set(cases.map((c) => c.op))).toEqual(
      new Set(["preview-probe-options", "resolve-probe", "refine-schema", "sync-intent", "generate-probes"]),
    );
  });

  it("round-trips, skips comments, and rejects bad lines with their position", () => {
    const one: ReplayCase = {
      id: "a",
      op: "resolve-probe",
      source: "seed",
      input: { intent: intent("x"), schema: schema("name") as never, question: "Q?", answer: "A" },
    };
    const text = `// a comment\n\n${serializeCases([one])}`;
    expect(parseCases(text)).toEqual([one]);
    expect(() => parseCases(`${serializeCases([one])}${serializeCases([one])}`, "f")).toThrow("f:2: duplicate id a");
    expect(() => parseCases("{nope", "f")).toThrow("f:1: not valid JSON");
    expect(caseProblem({ ...one, op: "delete-everything" })).toMatch(/unknown op/);
    expect(caseProblem({ ...one, input: { ...one.input, answer: 3 } })).toBe("input needs question and answer");
    expect(caseProblem({ ...one, input: { ...one.input, intent: "plain text" } })).toMatch(/intent/);
  });
});

describe("rationale parsing", () => {
  it("reads decisions, re-edits and answers with quotes in them", () => {
    expect(parseDecisionRationale('"Track weight?" → "Yes, in kg"')).toEqual({
      question: "Track weight?",
      answer: "Yes, in kg",
    });
    expect(
      parseDecisionRationale('Re-edited: "Track weight?" → "No" (was: "yesKg")'),
    ).toEqual({ question: "Track weight?", answer: "No" });
    expect(parseDecisionRationale("Sections changed: purpose")).toBeNull();
    expect(parseDecisionRationale(null)).toBeNull();
  });

  it("reads what an intent sync was about", () => {
    expect(parseSyncRationale('Purpose updated after design decisions: "Q?" → "A"')).toEqual({
      editDescription: '"Q?" → "A"',
      kind: "design-decision",
    });
    expect(parseSyncRationale('Purpose updated after field edits: Renamed field "A" to "B"')).toEqual({
      editDescription: 'Renamed field "A" to "B"',
      kind: "field-edit",
    });
    expect(parseSyncRationale("Generated 4 fields from intent")).toBeNull();
  });
});

describe("casesFromStudyExport", () => {
  const row = (
    id: string,
    at: string,
    action: string,
    rationale: string | null,
    prev: { schema: unknown; intent: unknown },
  ) => ({
    id,
    portfolio_id: "pf-1",
    action,
    created_at: at,
    rationale,
    prev_schema: prev.schema,
    prev_intent: prev.intent,
    // Columns the converter must never carry over
    actor: "Maria Example",
    actor_user_id: "user-123",
  });

  const s0 = schema();
  const s1 = schema("name");
  const s2 = schema("name", "goal");
  const s3 = schema("name", "goal", "diet");
  const i0 = intent("Running group sign-up");
  const i1 = intent("Running group sign-up. Ask about food.");

  const data = {
    session: { join_code: "H7VTHW", name: "Pilot" },
    participants: [{ id: "part-1", display_name: "Maria Example", portfolio_id: "pf-1" }],
    assignments: [{ panel_pid: "PROLIFIC-SECRET" }],
    portfolios: [{ id: "pf-1", schema: s3, intent: i1, owner: "user-123" }],
    provenance: [
      // Out of order on purpose: the converter sorts by time
      row("r3", "2026-10-27T10:02:00Z", "intent_updated", "Sections changed: purpose", { schema: s2, intent: i0 }),
      row("r1", "2026-10-27T10:00:00Z", "schema_generated", "Generated 1 fields from intent", { schema: s0, intent: i0 }),
      row("r2", "2026-10-27T10:01:00Z", "design_probe_resolved", '"Ask for a goal?" → "Yes"', { schema: s1, intent: i0 }),
      row("r4", "2026-10-27T10:02:05Z", "schema_refined", "Added a diet field.", { schema: s2, intent: i1 }),
      row("r5", "2026-10-27T10:03:00Z", "intent_synced_from_edit", 'Purpose updated after field edits: Renamed field "name" to "Name"', { schema: s3, intent: i1 }),
      row("r6", "2026-10-27T10:04:00Z", "field_modified", "Modified name", { schema: s3, intent: i1 }),
      row("r7", "2026-10-27T10:05:00Z", "design_probe_resolved", "not a decision", { schema: s3, intent: i1 }),
    ],
    designProbes: [
      {
        id: "probe-1",
        portfolio_id: "pf-1",
        text: "Ask for a goal?",
        explanation: null,
        source: "llm",
        selected_option: "yes",
        resolved_by: "Maria Example",
        options: [
          {
            value: "yes",
            label: "Yes",
            preview: {
              summary: "Adds a goal field",
              schemaPatch: { addFields: [{ key: "goal", label: "goal", type: "string", required: false }] },
              scope: { added: ["goal"], updated: [], removed: [] },
            },
          },
          { value: "no", label: "No" },
        ],
      },
    ],
  } as unknown as StudyExportLike;

  const { cases, skipped } = casesFromStudyExport(data);

  it("turns each automated change into a case, in time order", () => {
    expect(cases.map((c) => [c.id, c.op])).toEqual([
      ["H7VTHW-p1-001-probes", "generate-probes"],
      ["H7VTHW-p1-002-resolve", "resolve-probe"],
      ["H7VTHW-p1-003-preview", "preview-probe-options"],
      ["H7VTHW-p1-004-refine", "refine-schema"],
      ["H7VTHW-p1-005-sync", "sync-intent"],
    ]);
    expect(skipped).toEqual({ "decision rationale not parsable": 1 });
  });

  it("uses the form as it was at that moment", () => {
    const [probes, resolve, preview, refine, sync] = cases;
    // Probes are generated for the form generation produced
    expect(probes.input.schema.fields.map((f) => f.name)).toEqual(["name"]);
    expect(resolve.input).toMatchObject({ question: "Ask for a goal?", answer: "Yes" });
    expect(resolve.input.schema.fields.map((f) => f.name)).toEqual(["name"]);

    if (preview.op !== "preview-probe-options") throw new Error("expected a preview case");
    expect(preview.input.probe.options).toEqual([
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ]);
    expect(preview.input.laterSchema!.fields).toHaveLength(3);
    expect(preview.recorded!.selected).toBe("yes");

    if (refine.op !== "refine-schema") throw new Error("expected a refine case");
    expect(refine.input.previousIntent.purpose.content).toBe("Running group sign-up");
    expect(refine.input.intent.purpose.content).toBe("Running group sign-up. Ask about food.");
    expect(refine.input.decisions).toEqual([{ question: "Ask for a goal?", answer: "Yes" }]);

    if (sync.op !== "sync-intent") throw new Error("expected a sync case");
    expect(sync.input.kind).toBe("field-edit");
  });

  it("carries no participant identifiers", () => {
    const text = serializeCases(cases);
    for (const secret of ["Maria Example", "user-123", "part-1", "PROLIFIC-SECRET", "pf-1", "probe-1"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("summary", () => {
  const meta: RunMeta = {
    startedAt: "2026-11-10T00:00:00Z",
    model: "m1",
    fastModel: "m1",
    dataset: "cases",
    cases: 3,
    offline: false,
  };
  const call = (ms: number, outputTokens: number) => ({
    functionId: "f",
    ms,
    inputTokens: 1000,
    outputTokens,
    cachedInputTokens: 500,
  });
  const result = (id: string, metrics: Record<string, number>, extra: Partial<CaseResult> = {}): CaseResult => ({
    id,
    op: "resolve-probe",
    source: "seed",
    ok: true,
    ms: 2000,
    calls: [call(2000, 100)],
    metrics,
    details: {},
    ...extra,
  });
  const clean = { ops: 2, skippedUnknown: 0, skippedLocked: 0, unmentionedFields: 0, hasExpectation: 1, unwantedFields: 0, purposePreserved: 1, purposeChanged: 1, purposeLost: 0, purposeGrownBy: 30 };

  it("rolls cases up per operation and strategy", () => {
    const summary = summarize(meta, [
      result("a", clean),
      result("b", { ...clean, skippedUnknown: 1, unwantedFields: 2, purposePreserved: 0, purposeLost: 2 }),
      result("c", {}, { ok: false, error: "timeout", calls: [] }),
      result("g", { probes: 4, readyPreviewShare: 1, drafts: 4, committeeOps: 6, committeeMeanEntropy: 0.8, committeeUnanimousOps: 1, fellBack: 0 }, { op: "generate-probes", variant: "committee" }),
    ]);
    const resolve = summary.groups["resolve-probe"];
    expect(resolve.cases).toBe(3);
    expect(resolve.failed).toBe(1);
    expect(resolve["skipped op share"]).toBe(0.25);
    expect(resolve["cases with unwanted changes"]).toBe(0.5);
    expect(resolve["purpose kept verbatim"]).toBe(0.5);
    expect(resolve["cached input share"]).toBe(0.5);
    expect(summary.groups["generate-probes/committee"]["mean vote entropy (bits)"]).toBe(0.8);
    expect(summary.groups.total).toMatchObject({ cases: 4, failed: 1, "LLM calls": 3, "output tokens": 300 });
  });

  it("says whether a change against the previous run is better or worse", () => {
    const before = summarize(meta, [result("a", { ...clean, unwantedFields: 1 })]);
    const now = summarize({ ...meta, model: "m2" }, [result("a", clean, { calls: [call(4000, 100)], ms: 4000 })]);
    const markdown = renderMarkdown(now, before);
    expect(markdown).toContain("| cases with unwanted changes | 0.0% | 100.0% | −100.0 pt (better) |");
    expect(markdown).toContain("| case latency p50 (s) | 4 | 2 | +2 (worse) |");
    expect(markdown).toContain("| cases | 1 | 1 | = |");
    expect(markdown).toContain("Compared with: 2026-11-10T00:00:00Z, model m1");
  });

  it("formats shares as percentages and counts as numbers", () => {
    expect(formatValue("skipped op share", 0.125)).toBe("12.5%");
    expect(formatValue("patch ops", 12)).toBe("12");
    expect(formatValue("mean vote entropy (bits)", 0.8113)).toBe("0.81");
  });
});
