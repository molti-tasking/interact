// @vitest-environment node
/**
 * The 2026-11-13 export files and columns: the raters' recall and why
 * sheets (blind: form codes, no condition, no participant, no field origin),
 * the analyst's new columns (appended, so existing ones keep their
 * positions), the why key and the assistant's turns.
 */
import { describe, expect, it } from "vitest";
import type { StudyExport } from "@/hooks/query/study";
import {
  assistantTurnsCsv,
  codingKeyCsv,
  codingRecallCsv,
  codingWhyCsv,
  formCode,
  participantsCsv,
  stepSeconds,
  weightedKappa,
  whyKeyCsv,
} from "@/lib/study/coding";
import { parseCsv } from "@/lib/study/export";

const at = (minute: number, second = 0) =>
  `2026-11-13T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}Z`;

let eventId = 0;
const event = (
  participant: string,
  type: string,
  created: string,
  extra: { phase?: string; portfolio_id?: string | null; payload?: unknown } = {},
) => ({
  id: ++eventId,
  participant_id: participant,
  type,
  created_at: created,
  phase: extra.phase ?? null,
  portfolio_id: extra.portfolio_id ?? null,
  payload: extra.payload ?? {},
});

/** The steps a participant entered, at these minutes after 10:00 */
const walk = (participant: string, steps: [string, number][]) =>
  steps.map(([step, minute]) =>
    step === "consent"
      ? event(participant, "joined", at(minute))
      : event(participant, "step_entered", at(minute), { phase: step }),
  );

function fixture(): StudyExport {
  eventId = 0;
  const schema = (labels: string[]) => ({
    fields: labels.map((label, i) => ({ id: `f${i}`, name: `f${i}`, label, required: false, type: { kind: "text" } })),
  });
  return {
    exportedAt: "2026-11-13T12:00:00.000Z",
    session: { settings: { mode: "briefs", briefs: ["camp"], postTaskMeasures: true } },
    responses: [],
    provenance: [],
    designProbes: [],
    participants: [
      { id: "pa", display_name: "Participant 1", joined_at: at(0) },
      { id: "pf", display_name: "Participant 2", joined_at: at(0) },
    ],
    assignments: [
      { participant_id: "pa", condition: "assistant", task_order: 0 },
      { participant_id: "pf", condition: "full", task_order: 0 },
    ],
    progress: [
      { participant_id: "pa", outcome: "completed", step: "done", completed_at: at(30) },
      { participant_id: "pf", outcome: "completed", step: "done", completed_at: at(30) },
    ],
    tasks: [
      { id: "ta", participant_id: "pa", position: 1, brief: "camp", portfolio_id: "fa", started_at: at(3), finished_at: at(13), finished_by: "participant" },
      { id: "tf", participant_id: "pf", position: 1, brief: "camp", portfolio_id: "ff", started_at: at(3), finished_at: at(15), finished_by: "timeout" },
    ],
    portfolios: [
      { id: "fa", schema: schema(["Child's name", "Allergies"]) },
      { id: "ff", schema: schema(["Child's name"]) },
    ],
    snapshots: [],
    events: [
      ...walk("pa", [["consent", 0], ["intro", 1], ["brief:1", 2], ["task:1", 3], ["ratings:1", 13], ["recall:1", 14], ["why:1", 16], ["quiz:1", 18], ["questionnaire", 19], ["done", 27]]),
      event("pa", "assistant_message", at(4), { portfolio_id: "fa", payload: { turn: 1, text: "A sign-up form for a football week" } }),
      event("pa", "first_prompt", at(4, 20), { portfolio_id: "fa", payload: { text: "A sign-up form for a football week" } }),
      event("pa", "assistant_turn", at(4, 20), {
        portfolio_id: "fa",
        payload: { turn: 1, reply: "Which days? Any allergies?", replyChars: 26, questionSentences: 2, patchOps: null, latencyMs: 4100, promptVersion: "assistant-1" },
      }),
      event("pa", "assistant_message", at(5), { portfolio_id: "fa", payload: { turn: 2, text: "All five days, and yes, allergies" } }),
      event("pa", "assistant_turn", at(5, 30), {
        portfolio_id: "fa",
        payload: { turn: 2, reply: "I built the form.", replyChars: 17, questionSentences: 0, patchOps: 2, added: 2, changed: 0, removed: 0, latencyMs: 6200, promptVersion: "assistant-1" },
      }),
      ...walk("pf", [["consent", 0], ["intro", 1], ["brief:1", 2], ["task:1", 3], ["ratings:1", 15], ["recall:1", 16], ["why:1", 17], ["quiz:1", 19], ["questionnaire", 20], ["done", 28]]),
    ],
    questionnaires: [
      { participant_id: "pa", instrument: "ratings:1", answers: { brief: "camp", know: 6, confident: 5, ms: 20000 } },
      { participant_id: "pa", instrument: "recall:1", answers: { brief: "camp", lines: ["Name of the child", "Allergies, food"], ms: 90000 } },
      {
        participant_id: "pa",
        instrument: "why:1",
        answers: {
          brief: "camp",
          items: [
            { fieldId: "f1", label: "Allergies", origin: "system", answer: "A boy had a nut allergy last year" },
            { fieldId: "f0", label: "Child's name", origin: "participant", answer: "To know who it is" },
          ],
        },
      },
      { participant_id: "pf", instrument: "ratings:1", answers: { brief: "camp", know: 4, confident: 3 } },
      { participant_id: "pf", instrument: "recall:1", answers: { brief: "camp", lines: ["Name"] } },
    ],
  } as unknown as StudyExport;
}

const table = (csv: string) => {
  const [header, ...rows] = parseCsv(csv);
  return { header, rows, cell: (row: string[], name: string) => row[header.indexOf(name)] };
};

describe("raters' sheets", () => {
  const data = fixture();

  it("coding-recall.csv: one row per recall line, codes blank", () => {
    const { header, rows } = table(codingRecallCsv(data));
    expect(header).toEqual(["form", "situation", "line_no", "text", "matches_field", "requirement_id"]);
    expect(rows).toEqual([
      [formCode("ta"), "camp", "1", "Name of the child", "", ""],
      [formCode("ta"), "camp", "2", "Allergies, food", "", ""],
      [formCode("tf"), "camp", "1", "Name", "", ""],
    ].sort((a, b) => a[0].localeCompare(b[0])));
  });

  it("coding-why.csv: one row per item, score blank, origin not shown", () => {
    const { header, rows } = table(codingWhyCsv(data));
    expect(header).toEqual(["form", "situation", "item_no", "field_label", "answer", "score"]);
    expect(rows).toEqual([
      [formCode("ta"), "camp", "1", "Allergies", "A boy had a nut allergy last year", ""],
      [formCode("ta"), "camp", "2", "Child's name", "To know who it is", ""],
    ]);
  });

  it("carry no condition, participant or field origin", () => {
    const rater = codingRecallCsv(data) + codingWhyCsv(data);
    expect(rater).not.toMatch(/assistant|\bfull\b|baseline|Participant \d|\bpa\b|\bpf\b|system|participant\b|inherited/i);
  });
});

describe("analyst files", () => {
  const data = fixture();

  it("times each step by the server's clock", () => {
    const seconds = stepSeconds(data, "pa");
    expect(seconds.get("consent")).toBe(60);
    expect(seconds.get("task:1")).toBe(600);
    expect(seconds.get("ratings:1")).toBe(60);
    expect(seconds.get("recall:1")).toBe(120);
    expect(seconds.get("why:1")).toBe(120);
    expect(seconds.get("quiz:1")).toBe(60);
    expect(seconds.has("done")).toBe(false);
  });

  it("coding-key.csv keeps its columns and appends the new ones", () => {
    const { header, rows, cell } = table(codingKeyCsv(data));
    expect(header.slice(0, 19)).toEqual([
      "form", "participant", "condition", "order", "position", "situation", "portfolio_id",
      "start_kind", "source_portfolio_id", "task_seconds", "finished_by", "field_count",
      "first_prompt_chars", "probes_shown", "probes_answered", "chat_messages", "direct_edits",
      "situation_reopened", "quiz_score",
    ]);
    expect(header.slice(19)).toEqual([
      "rating_know", "rating_confident", "recall_lines", "ratings_seconds", "recall_seconds",
      "why_seconds", "quiz_seconds", "why_origins", "assistant_turns",
      "assistant_question_sentences", "assistant_patches",
    ]);
    const assistant = rows.find((r) => r[0] === formCode("ta"))!;
    expect(cell(assistant, "condition")).toBe("assistant");
    expect(cell(assistant, "first_prompt_chars")).toBe("34");
    expect(cell(assistant, "rating_know")).toBe("6");
    expect(cell(assistant, "rating_confident")).toBe("5");
    expect(cell(assistant, "recall_lines")).toBe("2");
    expect(cell(assistant, "recall_seconds")).toBe("120");
    expect(cell(assistant, "why_origins")).toBe("participant;system");
    expect(cell(assistant, "assistant_turns")).toBe("2");
    expect(cell(assistant, "assistant_question_sentences")).toBe("2");
    expect(cell(assistant, "assistant_patches")).toBe("1");

    const full = rows.find((r) => r[0] === formCode("tf"))!;
    expect(cell(full, "condition")).toBe("full");
    expect(cell(full, "rating_know")).toBe("4");
    expect(cell(full, "why_origins")).toBe("");
    expect(cell(full, "assistant_turns")).toBe("");
  });

  it("participants.csv appends seconds per step and the measures per task", () => {
    const { header, rows, cell } = table(participantsCsv(data));
    expect(header).toContain("seconds_ratings_1");
    expect(header).toContain("seconds_why_1");
    expect(header.indexOf("seconds_consent")).toBeGreaterThan(header.indexOf("attention_passed"));
    expect(header.slice(-6)).toEqual([
      "t1_rating_know", "t1_rating_confident", "t1_why_origins",
      "t1_assistant_turns", "t1_assistant_question_sentences", "t1_assistant_patches",
    ]);
    const [pa, pf] = rows;
    expect(cell(pa, "seconds_task_1")).toBe("600");
    expect(cell(pa, "seconds_questionnaire")).toBe("480");
    expect(cell(pa, "t1_assistant_turns")).toBe("2");
    expect(cell(pf, "t1_assistant_turns")).toBe("");
    expect(cell(pf, "t1_rating_confident")).toBe("3");
  });

  it("why-key.csv says where each field came from, by form and item", () => {
    const { header, rows } = table(whyKeyCsv(data));
    expect(header).toEqual(["form", "item_no", "field_id", "field_label", "origin"]);
    expect(rows).toEqual([
      [formCode("ta"), "1", "f1", "Allergies", "system"],
      [formCode("ta"), "2", "f0", "Child's name", "participant"],
    ]);
  });

  it("assistant-turns.csv: one row per turn with the message that started it", () => {
    const { header, rows, cell } = table(assistantTurnsCsv(data));
    expect(header).toEqual([
      "participant", "condition", "form", "situation", "position", "turn", "reply_chars",
      "question_sentences", "patch_ops", "fields_added", "fields_changed", "fields_removed",
      "latency_ms", "prompt_version", "message", "reply", "created_at",
    ]);
    expect(rows).toHaveLength(2);
    expect(cell(rows[0], "turn")).toBe("1");
    expect(cell(rows[0], "question_sentences")).toBe("2");
    expect(cell(rows[0], "patch_ops")).toBe("");
    expect(cell(rows[0], "message")).toBe("A sign-up form for a football week");
    expect(cell(rows[1], "patch_ops")).toBe("2");
    expect(cell(rows[1], "fields_added")).toBe("2");
    expect(cell(rows[1], "message")).toBe("All five days, and yes, allergies");
    expect(cell(rows[1], "form")).toBe(formCode("ta"));
  });
});

describe("weightedKappa (the why sheet's score)", () => {
  const cats = ["0", "1", "2"];

  it("is 1 for identical codes", () => {
    expect(weightedKappa(["0", "1", "2", "2"], ["0", "1", "2", "2"], cats)).toBe(1);
  });

  it("matches a worked example (linear 3/7, quadratic 7/11)", () => {
    const a = ["0", "1", "2", "2"];
    const b = ["0", "2", "2", "1"];
    expect(weightedKappa(a, b, cats, "linear")).toBeCloseTo(3 / 7, 10);
    expect(weightedKappa(a, b, cats, "quadratic")).toBeCloseTo(7 / 11, 10);
  });

  it("counts a near miss as better than a far one", () => {
    const a = ["0", "1", "2", "0", "2"];
    const near = weightedKappa(a, ["1", "1", "2", "0", "2"], cats)!;
    const far = weightedKappa(a, ["2", "1", "2", "0", "2"], cats)!;
    expect(near).toBeGreaterThan(far);
  });

  it("leaves out codes outside the scale, and is null with nothing to compare", () => {
    expect(weightedKappa(["0", "x"], ["0", "1"], cats)).toBe(weightedKappa(["0"], ["0"], cats));
    expect(weightedKappa([], [], cats)).toBeNull();
  });
});
