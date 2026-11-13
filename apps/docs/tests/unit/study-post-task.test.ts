// @vitest-environment node
/**
 * The measures after each task (2026-11-13): the steps, the self-ratings,
 * free recall, and which fields the "why" items ask about.
 */
import { describe, expect, it } from "vitest";
import { RATING_ITEMS, recallLines } from "@/lib/study/instruments";
import {
  briefSteps,
  DEFAULT_STUDY_SETTINGS,
  parseBriefStep,
  parseSettings,
  seededShuffle,
  studyMinutes,
} from "@/lib/study/types";
import { chooseWhyFields, type WhyItem } from "@/lib/study/why-fields";

describe("steps with post-task measures", () => {
  it("adds ratings, recall and why between each task and its quiz (as study_steps() in 017)", () => {
    expect(briefSteps(2, true)).toEqual([
      "consent", "intro",
      "brief:1", "task:1", "ratings:1", "recall:1", "why:1", "quiz:1",
      "brief:2", "task:2", "ratings:2", "recall:2", "why:2", "quiz:2",
      "questionnaire", "done",
    ]);
  });

  it("keeps the old steps for sessions created before", () => {
    expect(briefSteps(2)).toEqual(briefSteps(2, false));
    expect(briefSteps(2)).toEqual([
      "consent", "intro", "brief:1", "task:1", "quiz:1", "brief:2", "task:2", "quiz:2",
      "questionnaire", "done",
    ]);
  });

  it("parses the new steps", () => {
    expect(parseBriefStep("ratings:1")).toEqual({ kind: "ratings", position: 1 });
    expect(parseBriefStep("recall:2")).toEqual({ kind: "recall", position: 2 });
    expect(parseBriefStep("why:2")).toEqual({ kind: "why", position: 2 });
    expect(parseBriefStep("why:")).toBeNull();
  });

  it("the consent page's estimate grows by the measures, and stays for old sessions", () => {
    expect(studyMinutes({ taskSeconds: 720, postTaskMeasures: false }, 2)).toBe(35);
    expect(studyMinutes({ taskSeconds: 720, postTaskMeasures: true }, 2)).toBe(46);
  });

  it("is a setting that old sessions don't have", () => {
    expect(DEFAULT_STUDY_SETTINGS.postTaskMeasures).toBe(false);
    expect(parseSettings({ mode: "briefs" }).postTaskMeasures).toBe(false);
    expect(parseSettings({ mode: "briefs", postTaskMeasures: true }).postTaskMeasures).toBe(true);
    expect(parseSettings({ mode: "briefs", postTaskMeasures: "yes" }).postTaskMeasures).toBe(false);
  });

  it("keeps the assistant condition and drops unknown ones", () => {
    expect(parseSettings({ conditions: ["full", "assistant", "baseline", "chatgpt"] }).conditions).toEqual([
      "full",
      "assistant",
      "baseline",
    ]);
  });
});

describe("self-ratings and recall", () => {
  it("asks the two ratings in this wording", () => {
    expect(RATING_ITEMS.map((item) => item.label)).toEqual([
      "How well do you know what your form asks?",
      "How confident are you that your form collects everything this situation needs?",
    ]);
  });

  it("counts non-empty lines only", () => {
    expect(recallLines("Child's name\n\n  age \r\nallergies\n   ")).toEqual(["Child's name", "age", "allergies"]);
    expect(recallLines("   \n")).toEqual([]);
  });
});

const field = (id: string, origin: "system" | "creator", label = `Label ${id}`) => ({ id, label, origin });
const choose = (fields: ReturnType<typeof field>[], seed = "p1:1", inherited?: string[]) =>
  chooseWhyFields(fields, { seed, shuffle: seededShuffle, inherited });
const origins = (items: WhyItem[]) => items.map((i) => i.origin).sort();

describe("chooseWhyFields", () => {
  const form = [
    field("s1", "system"),
    field("s2", "system"),
    field("s3", "system"),
    field("s4", "system"),
    field("c1", "creator"),
    field("c2", "creator"),
  ];

  it("wave 1: two system fields and one of the participant's", () => {
    const items = choose(form);
    expect(items).toHaveLength(3);
    expect(origins(items)).toEqual(["participant", "system", "system"]);
  });

  it("is the same for the same participant and task, and differs between them", () => {
    expect(choose(form, "p1:1")).toEqual(choose(form, "p1:1"));
    const seeds = ["p1:1", "p1:2", "p2:1", "p3:1", "p4:2"];
    const picks = new Set(seeds.map((seed) => choose(form, seed).map((i) => i.fieldId).sort().join()));
    expect(picks.size).toBeGreaterThan(1);
  });

  it("fills from the other kind when one runs short", () => {
    expect(origins(choose([field("s1", "system"), field("c1", "creator"), field("c2", "creator")]))).toEqual([
      "participant",
      "participant",
      "system",
    ]);
    expect(origins(choose([field("s1", "system"), field("s2", "system"), field("s3", "system")]))).toEqual([
      "system",
      "system",
      "system",
    ]);
    expect(origins(choose([field("c1", "creator"), field("c2", "creator"), field("c3", "creator")]))).toEqual([
      "participant",
      "participant",
      "participant",
    ]);
  });

  it("asks about as many as there are when the form is small, none when empty", () => {
    expect(choose([field("s1", "system"), field("c1", "creator")])).toHaveLength(2);
    expect(choose([])).toEqual([]);
  });

  it("skips fields without a label", () => {
    const items = choose([field("s1", "system", "  "), field("s2", "system"), field("c1", "creator")]);
    expect(items.map((i) => i.fieldId).sort()).toEqual(["c1", "s2"]);
  });

  it("wave 2: inherited fields first, marked as such", () => {
    const items = choose(form, "p1:1", ["s1", "s2", "c1"]);
    expect(origins(items)).toEqual(["inherited", "inherited", "inherited"]);
    const two = choose(form, "p1:1", ["s1", "c2"]);
    expect(origins(two)).toEqual(["inherited", "inherited", "system"]);
  });

  it("carries the label and the field id, not the field's other properties", () => {
    const [item] = choose([field("s1", "system", "  Child's name ")]);
    expect(item).toEqual({ fieldId: "s1", label: "Child's name", origin: "system" });
  });
});
