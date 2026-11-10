/**
 * Study additions for the revised paper: NCS-6, the per-answer export, form
 * diversity, the run settings in every export, and the wave-2 settings.
 */
import { describe, expect, it } from "vitest";
import type { StudyExport } from "@/hooks/query/study";
import { BRIEFS, BRIEF_KEYS, VARIANT_BRIEF_KEYS } from "@/lib/study/briefs";
import { BRIEF_DEFINITIONS } from "@/lib/study/briefs.server";
import {
  codingKeyCsv,
  formCode,
  formDiversityCsv,
  formDiversityPairsCsv,
  participantsCsv,
  questionAnswersCsv,
  sessionRun,
  withRunColumns,
  withRunLine,
} from "@/lib/study/coding";
import { parseCsv } from "@/lib/study/export";
import {
  BRIEFS_INSTRUMENT,
  BRIEFS_QUESTIONNAIRE,
  NCS6_ITEMS,
  ncs6Score,
} from "@/lib/study/instruments";
import {
  parseHandoff,
  parseRunSettings,
  parseSettings,
  runSettingsFromEnv,
} from "@/lib/study/types";

// ---------------------------------------------------------------------------
// NCS-6
// ---------------------------------------------------------------------------

describe("NCS-6 (Lins de Holanda Coelho, Hanel & Wolf 2020)", () => {
  it("has the six published items, in order, with items 3 and 4 reversed", () => {
    // The paper's appendix: numbers of the 18-item scale, (R) = reversed
    expect(NCS6_ITEMS.map((i) => [i.item, i.reverse])).toEqual([
      [1, false],
      [2, false],
      [3, true],
      [4, true],
      [11, false],
      [15, false],
    ]);
    expect(NCS6_ITEMS.map((i) => i.label)).toEqual([
      "I would prefer complex to simple problems.",
      "I like to have the responsibility of handling a situation that requires a lot of thinking.",
      "Thinking is not my idea of fun.",
      "I would rather do something that requires little thought than something that is sure to challenge my thinking abilities.",
      "I really enjoy a task that involves coming up with new solutions to problems.",
      "I would prefer a task that is intellectual, difficult, and important to one that is somewhat important but does not require much thought.",
    ]);
  });

  it("is asked on the published 1–5 scale, required, in every questionnaire", () => {
    for (const { name } of NCS6_ITEMS) {
      const field = BRIEFS_QUESTIONNAIRE.fields.find((f) => f.name === name)!;
      expect(field.required).toBe(true);
      expect(field.type).toEqual({
        kind: "scale",
        min: 1,
        max: 5,
        labels: {
          low: "Extremely uncharacteristic of me",
          high: "Extremely characteristic of me",
        },
      });
    }
    // One questionnaire for all conditions: the items are part of it as such
    const section = BRIEFS_QUESTIONNAIRE.groups.find((g) => g.id === "ncs")!;
    expect(section.fieldIds).toEqual(NCS6_ITEMS.map((i) => i.name));
    // No wording about the tool, a condition or the study task
    const text = NCS6_ITEMS.map((i) => i.label).join(" ");
    expect(text).not.toMatch(/tool|form|question|suggest/i);
  });

  const answers = (values: number[]) =>
    Object.fromEntries(NCS6_ITEMS.map((item, i) => [item.name, values[i]]));

  it("scores the mean with the reversed items flipped", () => {
    expect(ncs6Score(answers([5, 5, 1, 1, 5, 5]))).toBe(5);
    expect(ncs6Score(answers([1, 1, 5, 5, 1, 1]))).toBe(1);
    expect(ncs6Score(answers([3, 3, 3, 3, 3, 3]))).toBe(3);
    // 4 + 2 + (6−2) + (6−5) + 3 + 5 = 19 → 19/6
    expect(ncs6Score(answers([4, 2, 2, 5, 3, 5]))).toBeCloseTo(19 / 6);
    // Agreeing with everything is not a high score
    expect(ncs6Score(answers([5, 5, 5, 5, 5, 5]))).toBeCloseTo(22 / 6);
  });

  it("has no score when an item is missing or out of range", () => {
    expect(ncs6Score({})).toBeNull();
    expect(ncs6Score({ ...answers([3, 3, 3, 3, 3, 3]), ncs_4: undefined })).toBeNull();
    expect(ncs6Score(answers([3, 3, 3, 3, 3, 6]))).toBeNull();
    expect(ncs6Score(answers([3, 3, 3, 3, 3, 0]))).toBeNull();
    expect(ncs6Score({ ...answers([3, 3, 3, 3, 3, 3]), ncs_1: "" })).toBeNull();
    // Stored as text by some clients
    expect(ncs6Score({ ...answers([3, 3, 3, 3, 3, 3]), ncs_1: "5" })).toBeCloseTo(20 / 6);
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const RUN = { model: "test-model-1", questionStrategy: "committee", committeeSize: 4, recordedAt: "2026-11-10T09:00:00.000Z" };

function fixture(): StudyExport {
  const schema = (...labels: string[]) => ({
    fields: labels.map((label, i) => ({
      id: `f${i}`,
      name: label.toLowerCase().replace(/[^a-z]+(.)?/g, (_m, c: string) => (c ?? "").toUpperCase()),
      label,
      required: false,
      type: { kind: "text" },
    })),
  });
  const participant = (n: number) => ({
    id: `p${n}`,
    display_name: `Participant ${n}`,
    joined_at: "2026-11-10T10:00:00Z",
  });
  const done = (n: number) => ({
    participant_id: `p${n}`,
    outcome: "completed",
    step: "done",
    completed_at: "2026-11-10T10:30:00Z",
  });
  const task = (n: number, portfolio: string, extra = {}) => ({
    id: `t${n}`,
    participant_id: `p${n}`,
    position: 1,
    brief: "camp",
    portfolio_id: portfolio,
    started_at: "2026-11-10T10:02:00Z",
    finished_at: "2026-11-10T10:10:00Z",
    finished_by: "participant",
    start_kind: null,
    source_portfolio_id: null,
    ...extra,
  });
  let eventId = 0;
  const event = (participant: string, portfolio: string, type: string, payload: unknown, at: string) => ({
    id: ++eventId,
    participant_id: participant,
    portfolio_id: portfolio,
    type,
    payload,
    created_at: `2026-11-10T10:0${at}Z`,
    client_at: null,
    phase: "task:1",
  });
  return {
    exportedAt: "2026-11-10T12:00:00.000Z",
    session: { settings: { mode: "briefs", run: RUN } },
    responses: [],
    provenance: [],
    designProbes: [],
    snapshots: [],
    participants: [1, 2, 3, 4, 5].map(participant),
    assignments: [
      { participant_id: "p1", condition: "full", task_order: 0 },
      { participant_id: "p2", condition: "full", task_order: 0 },
      { participant_id: "p3", condition: "full", task_order: 0 },
      { participant_id: "p4", condition: "baseline", task_order: 0 },
      { participant_id: "p5", condition: "baseline", task_order: 0 },
    ],
    progress: [1, 2, 3, 4, 5].map(done),
    tasks: [
      task(1, "f1"),
      task(2, "f2"),
      task(3, "f3"),
      task(4, "f4"),
      task(5, "f5", { start_kind: "portfolio", source_portfolio_id: "f1" }),
    ],
    portfolios: [
      // The full arm converged; the baseline arm did not
      { id: "f1", schema: schema("Child's name", "Allergies", "T-shirt size") },
      { id: "f2", schema: schema("Child name", "Allergies", "T-shirt size") },
      { id: "f3", schema: schema("Child's name", "Allergy", "Emergency phone") },
      { id: "f4", schema: schema("Child's name", "School") },
      { id: "f5", schema: schema("Favourite team", "Shoe size") },
    ],
    events: [
      event("p1", "f1", "probe_shown", { id: "q1" }, "3:00"),
      // Looked at two answers, the chosen one twice
      event("p1", "f1", "option_previewed", { ownerId: "q1", option: "askSize", ms: 900 }, "3:05"),
      event("p1", "f1", "option_previewed", { ownerId: "q1", option: "keepAsIs", ms: 400 }, "3:08"),
      event("p1", "f1", "option_previewed", { ownerId: "q1", option: "askSize", ms: 600 }, "3:10"),
      // Another question's preview doesn't count for q1
      event("p1", "f1", "option_previewed", { ownerId: "q2", option: "other", ms: 5000 }, "3:11"),
      event(
        "p1",
        "f1",
        "probe_answered",
        {
          id: "q1",
          text: "Ask for a T-shirt size?",
          source: "committee",
          option: "askSize",
          position: 2,
          modelPosition: 0,
          optionCount: 3,
          noChange: false,
          typed: false,
        },
        "3:20",
      ),
      // A look after the answer doesn't count either
      event("p1", "f1", "option_previewed", { ownerId: "q1", option: "askSize", ms: 700 }, "3:30"),
      // Kept the form as it was, without looking at the form preview
      event(
        "p1",
        "f1",
        "probe_answered",
        { id: "q2", text: "Ask for the school?", source: "llm", option: "keepAsIs", position: 0, modelPosition: null, optionCount: 3, noChange: true, typed: false },
        "4:00",
      ),
      // A typed answer, previewed first; logged before `typed` existed
      event("p2", "f2", "option_previewed", { ownerId: "q9", option: "custom:only for under-10s", ms: 1500 }, "5:00"),
      event(
        "p2",
        "f2",
        "probe_answered",
        { id: "q9", text: "Ask for the age?", source: "llm", option: "custom:only for under-10s", position: 3, optionCount: 3, noChange: false, answerSource: "custom" },
        "5:10",
      ),
    ],
    questionnaires: [
      {
        participant_id: "p1",
        instrument: BRIEFS_INSTRUMENT,
        answers: {
          ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`sus_${i + 1}`, 3])),
          ...Object.fromEntries(NCS6_ITEMS.map((item) => [item.name, item.reverse ? 2 : 4])),
        },
      },
    ],
  } as unknown as StudyExport;
}

describe("per answered question export", () => {
  const [header, ...rows] = parseCsv(questionAnswersCsv(fixture()));
  const cell = (row: string[], name: string) => row[header.indexOf(name)];

  it("has one row per applied answer", () => {
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => cell(r, "question_id"))).toEqual(["q1", "q2", "q9"]);
    expect(cell(rows[0], "participant")).toBe("Participant 1");
    expect(cell(rows[0], "condition")).toBe("full");
    expect(cell(rows[0], "form")).toBe(formCode("t1"));
    expect(cell(rows[0], "situation")).toBe("camp");
  });

  it("gives the displayed position of the chosen answer next to the model's", () => {
    expect(cell(rows[0], "displayed_position")).toBe("2");
    expect(cell(rows[0], "model_position")).toBe("0");
    expect(cell(rows[0], "answer_count")).toBe("3");
    // The added unchanged answer has no model position
    expect(cell(rows[1], "displayed_position")).toBe("0");
    expect(cell(rows[1], "model_position")).toBe("");
  });

  it("says whether it was the unchanged answer and whether it was typed", () => {
    expect([cell(rows[0], "unchanged_answer"), cell(rows[0], "typed")]).toEqual(["0", "0"]);
    expect([cell(rows[1], "unchanged_answer"), cell(rows[1], "typed")]).toEqual(["1", "0"]);
    expect([cell(rows[2], "unchanged_answer"), cell(rows[2], "typed")]).toEqual(["0", "1"]);
  });

  it("says whether a preview was viewed first, for how long, and how many answers were previewed", () => {
    // q1: the chosen answer twice (900 + 600 ms), two different answers
    expect(cell(rows[0], "preview_viewed_first")).toBe("1");
    expect(cell(rows[0], "preview_viewed_ms")).toBe("1500");
    expect(cell(rows[0], "answers_previewed")).toBe("2");
    expect(cell(rows[0], "seconds_since_shown")).toBe("20");
    // q2: only another answer of that question was looked at
    expect(cell(rows[1], "preview_viewed_first")).toBe("0");
    expect(cell(rows[1], "preview_viewed_ms")).toBe("0");
    expect(cell(rows[1], "answers_previewed")).toBe("1");
    // q9: the typed answer's own preview
    expect(cell(rows[2], "preview_viewed_first")).toBe("1");
    expect(cell(rows[2], "preview_viewed_ms")).toBe("1500");
  });
});

describe("form diversity export", () => {
  const data = fixture();
  const [header, ...rows] = parseCsv(formDiversityCsv(data));
  const cell = (row: string[], name: string) => row[header.indexOf(name)];
  const arm = (condition: string, start = "") =>
    rows.find((r) => cell(r, "condition") === condition && cell(r, "start_kind") === start)!;

  it("has one row per situation and condition (and starting point)", () => {
    expect(rows.map((r) => [cell(r, "situation"), cell(r, "condition"), cell(r, "start_kind")])).toEqual([
      ["camp", "baseline", ""],
      ["camp", "baseline", "portfolio"],
      ["camp", "full", ""],
    ]);
  });

  it("measures the mean pairwise overlap of the field sets within an arm", () => {
    const full = arm("full");
    expect(cell(full, "forms")).toBe("3");
    expect(cell(full, "pairs")).toBe("3");
    // f1–f2: 3 of 3 (aligned: "Child name" = "Child's name"); f1–f3 and
    // f2–f3: 2 of 4 → (1 + 0.5 + 0.5) / 3
    expect(Number(cell(full, "mean_overlap"))).toBeCloseTo(2 / 3, 3);
    expect(Number(cell(full, "diversity"))).toBeCloseTo(1 / 3, 3);
    expect(cell(full, "max_overlap")).toBe("1");
    expect(cell(full, "min_overlap")).toBe("0.5");
    expect(cell(full, "mean_fields")).toBe("3");
  });

  it("leaves the measure empty for an arm with a single form", () => {
    const baseline = arm("baseline");
    expect(cell(baseline, "forms")).toBe("1");
    expect(cell(baseline, "pairs")).toBe("0");
    expect(cell(baseline, "mean_overlap")).toBe("");
  });

  it("lists every pair, by form code, without participants", () => {
    const text = formDiversityPairsCsv(data);
    const [pairHeader, ...pairs] = parseCsv(text);
    expect(pairHeader).toEqual(["situation", "condition", "start_kind", "form_a", "form_b", "overlap"]);
    expect(pairs).toHaveLength(3);
    expect(text).not.toMatch(/Participant/);
    expect(pairs.every((p) => /^[0-9A-Z]{6}$/.test(p[3]) && /^[0-9A-Z]{6}$/.test(p[4]))).toBe(true);
  });
});

describe("what the session ran with, in every export", () => {
  const data = fixture();

  it("is read from the session", () => {
    expect(sessionRun(data)).toMatchObject({ model: "test-model-1", questionStrategy: "committee", committeeSize: 4 });
    expect(sessionRun({ session: { settings: {} } } as unknown as StudyExport)).toBeNull();
  });

  it("is the last three columns of every CSV, on every row", () => {
    for (const csv of [
      participantsCsv(data),
      codingKeyCsv(data),
      questionAnswersCsv(data),
      formDiversityCsv(data),
      formDiversityPairsCsv(data),
    ]) {
      const [before] = parseCsv(csv);
      const [header, ...rows] = parseCsv(withRunColumns(csv, sessionRun(data)));
      // Existing columns keep their names and places
      expect(header.slice(0, before.length)).toEqual(before);
      expect(header.slice(-3)).toEqual(["model", "question_strategy", "committee_size"]);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.slice(-3)).toEqual(["test-model-1", "committee", "4"]);
    }
  });

  it("survives cells with commas, quotes and line breaks", () => {
    const csv = 'a,b\n"x, y","say ""hi""\nthere"\n';
    const [, row] = parseCsv(withRunColumns(csv, sessionRun(data)));
    expect(row).toEqual(["x, y", 'say "hi"\nthere', "test-model-1", "committee", "4"]);
  });

  it("is a line under the title of a Markdown file", () => {
    const lines = withRunLine("# Forms to code\n\n2 forms.", sessionRun(data)).split("\n");
    expect(lines[0]).toBe("# Forms to code");
    expect(lines[2]).toBe("Run: model test-model-1 · committee questions · committee of 4");
    expect(lines.at(-1)).toBe("2 forms.");
  });

  it("puts the NCS-6 score and the starting point into the analyst's files", () => {
    const [header, row] = parseCsv(participantsCsv(data));
    // 4, 4, (6−2), (6−2), 4, 4 → 4
    expect(row[header.indexOf("ncs6_score")]).toBe("4");
    for (const { name } of NCS6_ITEMS) expect(header).toContain(name);

    const [keyHeader, ...keyRows] = parseCsv(codingKeyCsv(data));
    const handed = keyRows.find((r) => r[0] === formCode("t5"))!;
    expect(handed[keyHeader.indexOf("start_kind")]).toBe("portfolio");
    expect(handed[keyHeader.indexOf("source_portfolio_id")]).toBe("f1");
  });
});

// ---------------------------------------------------------------------------
// Run settings and wave 2
// ---------------------------------------------------------------------------

describe("run settings", () => {
  const env = { LLM_MODEL_NAME: "some-model", PROBE_STRATEGY: "committee", PROBE_COMMITTEE_SIZE: "4" };

  it("are read when all three are set explicitly", () => {
    const result = runSettingsFromEnv(env, new Date("2026-11-10T09:00:00Z"));
    expect(result).toEqual({
      run: {
        model: "some-model",
        fastModel: "some-model",
        questionStrategy: "committee",
        committeeSize: 4,
        recordedAt: "2026-11-10T09:00:00.000Z",
      },
      missing: [],
    });
  });

  it("record the second model when one is set for background checks", () => {
    const { run } = runSettingsFromEnv({ ...env, LLM_FAST_MODEL_NAME: "small-model" });
    expect(run?.fastModel).toBe("small-model");
    // Recorded before the field existed: the one model
    expect(parseRunSettings({ model: "m", questionStrategy: "prompted", committeeSize: 2 })?.fastModel).toBe("m");
  });

  it("name what is missing — a default is not a setting", () => {
    expect(runSettingsFromEnv({}).missing).toHaveLength(3);
    expect(runSettingsFromEnv({ ...env, PROBE_STRATEGY: undefined }).missing).toEqual([
      "PROBE_STRATEGY (committee or prompted)",
    ]);
    expect(runSettingsFromEnv({ ...env, PROBE_STRATEGY: "smart" }).run).toBeNull();
    expect(runSettingsFromEnv({ ...env, PROBE_COMMITTEE_SIZE: "" }).run).toBeNull();
    expect(runSettingsFromEnv({ ...env, PROBE_COMMITTEE_SIZE: "40" }).run).toBeNull();
    expect(runSettingsFromEnv({ ...env, LLM_MODEL_NAME: "default" }).run).toBeNull();
    expect(runSettingsFromEnv({ ...env, LLM_MODEL_NAME: "  " }).run).toBeNull();
  });

  it("survive a round trip through the session settings, and nothing else passes as them", () => {
    const { run } = runSettingsFromEnv(env);
    expect(parseSettings({ mode: "briefs", run }).run).toEqual(run);
    expect(parseSettings({ mode: "briefs" }).run).toBeNull();
    expect(parseRunSettings({ model: "m", questionStrategy: "committee" })).toBeNull();
    expect(parseRunSettings({ model: "", questionStrategy: "committee", committeeSize: 4 })).toBeNull();
    expect(parseRunSettings("gpt")).toBeNull();
  });
});

describe("wave 2: handoff", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";

  it("reads the forms to start from and defaults to both starting points", () => {
    expect(parseSettings({}).handoff).toBeNull();
    const handoff = parseHandoff({ sourceSessionId: A, sources: { "camp-2": [A, B, A, "nope", 3] } });
    expect(handoff).toEqual({
      sourceSessionId: A,
      sources: { "camp-2": [A, B] },
      starts: ["portfolio", "form"],
    });
    expect(parseHandoff({ sources: {}, starts: ["form", "other"] })?.starts).toEqual(["form"]);
    expect(parseHandoff({ sources: { x: [] } })?.sources).toEqual({});
    expect(parseHandoff({ starts: ["form"] })).toBeNull();
  });

  it("has a variant situation for each wave-1 situation", () => {
    expect(BRIEF_KEYS).toEqual(["camp", "foster"]);
    expect(VARIANT_BRIEF_KEYS.map((key) => BRIEFS[key].variantOf)).toEqual(BRIEF_KEYS);
    for (const key of VARIANT_BRIEF_KEYS) {
      const brief = BRIEF_DEFINITIONS[key];
      expect(brief.variantOf).toBe(BRIEFS[key].variantOf);
      // The participant is told the form is not theirs
      expect(brief.story.join(" ")).toMatch(/You did not build it/);
      // Something to add, something to take out, something that must survive
      const changes = new Set(brief.requirements.map((r) => r.change));
      expect([...changes].sort()).toEqual(["add", "keep", "remove"]);
      expect(new Set(brief.requirements.map((r) => r.id)).size).toBe(brief.requirements.length);
    }
  });
});
