// @vitest-environment node
/**
 * What participants are told about their tool before using it is matched
 * across arms: the same sentence frames, the same "rough is fine", and only
 * the arm's own controls differ. Nothing tells them how to work.
 */
import { describe, expect, it } from "vitest";
import { armOf, FIRST_DESCRIPTION_HINT, HOW_IT_WORKS, type StudyArm } from "@/lib/study/arm-copy";

const ARMS: StudyArm[] = ["full", "no-probes", "baseline", "assistant"];

describe("arm copy", () => {
  it("maps capabilities to arms as the study context sets them", () => {
    expect(armOf({ assistantChat: false, chatEdits: false, designProbes: true })).toBe("full");
    expect(armOf({ assistantChat: false, chatEdits: false, designProbes: false })).toBe("no-probes");
    expect(armOf({ assistantChat: false, chatEdits: true, designProbes: false })).toBe("baseline");
    expect(armOf({ assistantChat: true, chatEdits: false, designProbes: false })).toBe("assistant");
  });

  it("says in every arm that a rough description is enough and a draft comes right away", () => {
    for (const arm of ARMS) {
      const [describe, draft, improve] = HOW_IT_WORKS[arm];
      expect(describe).toMatch(/in a few words what form is needed\. Rough is fine\.$/);
      expect(draft).toMatch(/right away/);
      expect(improve).toMatch(/^You improve the form: .+, or edit the fields directly\.$/);
      expect(FIRST_DESCRIPTION_HINT[arm]).toMatch(/^Rough is fine: .+right away.*, and you improve it afterwards\.$/);
    }
  });

  it("uses the same words where the tools are alike", () => {
    expect(HOW_IT_WORKS.full.slice(0, 2)).toEqual(HOW_IT_WORKS.baseline.slice(0, 2));
    expect(HOW_IT_WORKS["no-probes"].slice(0, 2)).toEqual(HOW_IT_WORKS.baseline.slice(0, 2));
    expect(FIRST_DESCRIPTION_HINT.full).toBe(FIRST_DESCRIPTION_HINT.baseline);
  });

  it("names each arm's own ways to improve the form", () => {
    expect(HOW_IT_WORKS.full[2]).toMatch(/questions/);
    expect(HOW_IT_WORKS.full[2]).toMatch(/description/);
    expect(HOW_IT_WORKS.baseline[2]).toMatch(/write what to change/);
    expect(HOW_IT_WORKS.assistant[2]).toMatch(/writing to the assistant/);
    for (const arm of ["no-probes", "baseline", "assistant"] as const) expect(HOW_IT_WORKS[arm][2]).not.toMatch(/questions/);
  });

  it("describes what is possible, not how to work", () => {
    const text = ARMS.flatMap((arm) => [...HOW_IT_WORKS[arm], FIRST_DESCRIPTION_HINT[arm]]).join(" ");
    expect(text).not.toMatch(/\b(should|must|best|start by|try to|make sure|probe)\b/i);
  });
});
