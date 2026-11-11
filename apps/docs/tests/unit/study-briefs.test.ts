import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import type { StudyExport } from "@/hooks/query/study";
import { BRIEFS, BRIEF_KEYS, VARIANT_BRIEF_KEYS } from "@/lib/study/briefs";
import { BRIEF_DEFINITIONS } from "@/lib/study/briefs.server";
import {
  codedForms,
  codingFieldsCsv,
  codingFormsMarkdown,
  codingKeyCsv,
  codingRequirementsCsv,
  cohenKappa,
  formCode,
  participantsCsv,
} from "@/lib/study/coding";
import { parseCsv } from "@/lib/study/export";
import {
  ATTENTION_ITEM,
  BRIEFS_INSTRUMENT,
  BRIEFS_QUESTIONNAIRE,
  buildQuiz,
  quizScore,
} from "@/lib/study/instruments";
import {
  briefOrder,
  briefSteps,
  parseBriefStep,
  parseSettings,
  seededShuffle,
} from "@/lib/study/types";

describe("briefs session settings and steps", () => {
  it("defaults to a workshop and reads a briefs session", () => {
    expect(parseSettings({}).mode).toBe("workshop");
    const s = parseSettings({
      mode: "briefs",
      briefs: ["camp", 3, "foster"],
      taskSeconds: 600,
      conditions: ["full", "baseline", "nonsense"],
      contact: { email: "a@b.example" },
    });
    expect(s).toMatchObject({
      mode: "briefs",
      briefs: ["camp", "foster"],
      taskSeconds: 600,
      conditions: ["full", "baseline"],
      contact: { name: "", email: "a@b.example", institution: "" },
    });
    expect(parseSettings({ taskSeconds: 5 }).taskSeconds).toBe(720);
  });

  it("lists the steps like the database does", () => {
    expect(briefSteps(2)).toEqual([
      "consent",
      "intro",
      "brief:1",
      "task:1",
      "quiz:1",
      "brief:2",
      "task:2",
      "quiz:2",
      "questionnaire",
      "done",
    ]);
    expect(parseBriefStep("task:2")).toEqual({ kind: "task", position: 2 });
    expect(parseBriefStep("done")).toEqual({ kind: "done" });
    expect(parseBriefStep("task:x")).toBeNull();
  });

  it("rotates the briefs per order", () => {
    expect(briefOrder(["camp", "foster"], 0)).toEqual(["camp", "foster"]);
    expect(briefOrder(["camp", "foster"], 1)).toEqual(["foster", "camp"]);
  });
});

describe("briefs", () => {
  it("has a story and requirements for every brief a session can use", () => {
    // Wave 1 and the wave-2 variants
    const keys = [...BRIEF_KEYS, ...VARIANT_BRIEF_KEYS];
    expect(Object.keys(BRIEF_DEFINITIONS).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const brief = BRIEF_DEFINITIONS[key];
      expect(brief.story.length).toBeGreaterThan(0);
      expect(brief.requirements.length).toBeGreaterThanOrEqual(8);
      expect(new Set(brief.requirements.map((r) => r.id)).size).toBe(brief.requirements.length);
      expect(BRIEFS[key].foils.length).toBeGreaterThanOrEqual(4);
    }
  });

  // The story is shown as an image so it can't be pasted, and the
  // requirement list is the answer key: neither may be bundled for a browser.
  it("keeps stories and requirements out of client code", () => {
    const root = path.resolve(__dirname, "../../src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = fs.readFileSync(file, "utf-8");
          const imports = source.match(/^import (?!type )[^;]*briefs\.server";$/gm);
          if (imports && !file.includes(`${path.sep}app${path.sep}api${path.sep}`)) {
            offenders.push(path.relative(root, file));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

describe("quiz", () => {
  const fields = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, label: `Question ${i}` }));
  const foils = ["Shoe size", "Question 3", "School", "Occupation", "Favourite team"];

  it("mixes some own questions with foils that aren't in the form", () => {
    const quiz = buildQuiz(fields, foils, "p1:1", seededShuffle);
    expect(quiz.filter((q) => q.kind === "own")).toHaveLength(6);
    expect(quiz.filter((q) => q.kind === "foil")).toHaveLength(4);
    // "Question 3" is in the form, so it can't be a foil
    expect(quiz.filter((q) => q.kind === "foil").map((q) => q.label)).not.toContain("Question 3");
    expect(buildQuiz(fields, foils, "p1:1", seededShuffle)).toEqual(quiz);
  });

  it("scores yes for own questions and no for foils", () => {
    const quiz = buildQuiz(fields.slice(0, 2), foils.slice(0, 1), "s", seededShuffle);
    const perfect = Object.fromEntries(
      quiz.map((q) => [q.id, q.kind === "own" ? "yes" : "no"] as const),
    );
    expect(quizScore(quiz, perfect)).toBe(1);
    expect(quizScore(quiz, { ...perfect, [quiz[0].id]: "unsure" })).toBeCloseTo(2 / 3);
    expect(quizScore([], {})).toBeNull();
  });
});

describe("questionnaire", () => {
  it("has the SUS items, the attention check and unique names", () => {
    const names = BRIEFS_QUESTIONNAIRE.fields.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (let i = 1; i <= 10; i++) expect(names).toContain(`sus_${i}`);
    expect(names).toContain(ATTENTION_ITEM.name);
    const grouped = BRIEFS_QUESTIONNAIRE.groups.flatMap((g) => g.fieldIds);
    expect(grouped.sort()).toEqual(BRIEFS_QUESTIONNAIRE.fields.map((f) => f.id).sort());
  });
});

function exportFixture(): StudyExport {
  const schema = (labels: string[]) => ({
    fields: labels.map((label, i) => ({
      id: `f${i}`,
      label,
      required: i === 0,
      type: i === 1 ? { kind: "select", multiple: false, options: [{ label: "S" }, { label: "M" }] } : { kind: "text" },
    })),
  });
  const base = {
    exportedAt: "2026-11-10T12:00:00.000Z",
    session: {} as StudyExport["session"],
    responses: [],
    provenance: [],
  };
  return {
    ...base,
    participants: [
      { id: "p1", display_name: "Participant 1", joined_at: "2026-11-10T10:00:00Z" },
      { id: "p2", display_name: "Participant 2", joined_at: "2026-11-10T10:00:00Z" },
    ],
    assignments: [
      { participant_id: "p1", condition: "full", task_order: 0 },
      { participant_id: "p2", condition: "baseline", task_order: 1 },
    ],
    progress: [
      { participant_id: "p1", outcome: "completed", step: "done", completed_at: "2026-11-10T10:30:00Z" },
      { participant_id: "p2", outcome: null, step: "task:1", completed_at: null },
    ],
    tasks: [
      { id: "t1", participant_id: "p1", position: 1, brief: "camp", portfolio_id: "f1", started_at: "2026-11-10T10:02:00Z", finished_at: "2026-11-10T10:10:30Z", finished_by: "participant" },
      { id: "t2", participant_id: "p1", position: 2, brief: "foster", portfolio_id: "f2", started_at: "2026-11-10T10:12:00Z", finished_at: "2026-11-10T10:24:00Z", finished_by: "timeout" },
      { id: "t3", participant_id: "p2", position: 1, brief: "foster", portfolio_id: "f3", started_at: "2026-11-10T10:02:00Z", finished_at: null, finished_by: null },
    ],
    portfolios: [
      { id: "f1", schema: schema(["Changed after the task"]) },
      { id: "f2", schema: schema(["Name", "Other pets"]) },
    ],
    snapshots: [
      { participant_id: "p1", label: "task:1:camp", schema: schema(["Child's name", "T-shirt size, S | M"]) },
    ],
    events: [
      { type: "first_prompt", portfolio_id: "f1", payload: { text: "A sign-up form\nfor a football camp" } },
      { type: "chat_message", portfolio_id: "f1", payload: {} },
      { type: "brief_opened", portfolio_id: "f1", payload: {} },
    ],
    designProbes: [
      { portfolio_id: "f1", status: "resolved" },
      { portfolio_id: "f1", status: "open" },
    ],
    questionnaires: [
      {
        participant_id: "p1",
        instrument: BRIEFS_INSTRUMENT,
        answers: { ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`sus_${i + 1}`, 3])), [ATTENTION_ITEM.name]: 2 },
      },
      {
        participant_id: "p1",
        instrument: "quiz:1",
        answers: {
          items: [
            { id: "own:f0", label: "Child's name", kind: "own" },
            { id: "foil:0", label: "Shoe size", kind: "foil" },
          ],
          answers: { "own:f0": "yes", "foil:0": "yes" },
        },
      },
    ],
  } as unknown as StudyExport;
}

describe("coding export", () => {
  const data = exportFixture();

  it("codes only finished tasks of participants who completed, from the snapshot", () => {
    const forms = codedForms(data);
    expect(forms.map((f) => f.taskId).sort()).toEqual(["t1", "t2"]);
    const camp = forms.find((f) => f.taskId === "t1")!;
    expect(camp.fields.map((f) => f.label)).toEqual(["Child's name", "T-shirt size, S | M"]);
    expect(camp.fields[1].type).toBe("choose one: S | M");
    expect(camp.firstPrompt).toContain("football camp");
    // No snapshot: the stored form
    expect(forms.find((f) => f.taskId === "t2")!.fields).toHaveLength(2);
  });

  it("gives a form the same code in every export", () => {
    expect(formCode("t1")).toBe(formCode("t1"));
    expect(formCode("t1")).not.toBe(formCode("t2"));
    expect(formCode("t1")).toMatch(/^[0-9A-Z]{6}$/);
  });

  it("keeps participant and condition out of the raters' files", () => {
    const rater = [
      codingFormsMarkdown(data, BRIEF_DEFINITIONS),
      codingRequirementsCsv(data, BRIEF_DEFINITIONS),
      codingFieldsCsv(data),
    ].join("\n");
    expect(rater).not.toMatch(/Participant \d|baseline|\bfull\b|p1|p2/);
    expect(rater).toContain(formCode("t1"));

    const requirements = parseCsv(codingRequirementsCsv(data, BRIEF_DEFINITIONS));
    expect(requirements).toHaveLength(
      1 + BRIEF_DEFINITIONS.camp.requirements.length + BRIEF_DEFINITIONS.foster.requirements.length,
    );
    const fields = parseCsv(codingFieldsCsv(data));
    expect(fields).toHaveLength(1 + 4);
    // A label with a comma survives the round trip
    expect(fields.some((row) => row[3] === "T-shirt size, S | M")).toBe(true);
  });

  it("unblinds in the key, with what was logged about the task", () => {
    const [header, ...rows] = parseCsv(codingKeyCsv(data));
    const row = rows.find((r) => r[0] === formCode("t1"))!;
    const cell = (name: string) => row[header.indexOf(name)];
    expect(cell("participant")).toBe("Participant 1");
    expect(cell("condition")).toBe("full");
    expect(cell("task_seconds")).toBe("510");
    expect(cell("probes_answered")).toBe("1");
    expect(cell("chat_messages")).toBe("1");
    expect(cell("situation_reopened")).toBe("1");
    expect(cell("quiz_score")).toBe("0.5");
  });

  it("lists every participant with outcome, SUS and the attention check", () => {
    const [header, ...rows] = parseCsv(participantsCsv(data));
    const cell = (row: string[], name: string) => row[header.indexOf(name)];
    expect(cell(rows[0], "outcome")).toBe("completed");
    expect(cell(rows[0], "sus_score")).toBe("50");
    expect(cell(rows[0], "attention_passed")).toBe("1");
    expect(cell(rows[0], "total_seconds")).toBe("1800");
    expect(cell(rows[1], "outcome")).toBe("incomplete");
    expect(cell(rows[1], "condition")).toBe("baseline");
  });
});

describe("cohenKappa", () => {
  it("is 1 for identical codes and 0 for chance agreement", () => {
    expect(cohenKappa(["1", "0", "1", "0"], ["1", "0", "1", "0"])).toBe(1);
    expect(cohenKappa(["1", "1", "0", "0"], ["1", "0", "1", "0"])).toBe(0);
    expect(cohenKappa(["1", "1"], ["1", "1"])).toBe(1);
    expect(cohenKappa([], [])).toBeNull();
  });

  it("matches a worked example", () => {
    // 20 agree-yes, 15 agree-no, 5 + 10 disagree: po = 0.7, pe = 0.5
    const a = [...Array(25).fill("1"), ...Array(25).fill("0")];
    const b = [...Array(20).fill("1"), ...Array(5).fill("0"), ...Array(10).fill("1"), ...Array(15).fill("0")];
    expect(cohenKappa(a, b)).toBeCloseTo(0.4);
  });
});
