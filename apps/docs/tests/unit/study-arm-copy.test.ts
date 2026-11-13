// @vitest-environment node
/**
 * What participants are told about their tool is minimal and matched across
 * arms: one line at the first description, one sentence when the form is
 * there — the same frames, only the arm's own controls differ, nothing
 * about how to work.
 */
import { describe, expect, it } from "vitest";
import { armOf, FIRST_DESCRIPTION_HINT, IMPROVE_THE_FORM, type StudyArm } from "@/lib/study/arm-copy";

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
      expect(FIRST_DESCRIPTION_HINT[arm]).toMatch(/^Rough is fine: .+right away.*, and you improve it afterwards\.$/);
    }
    expect(FIRST_DESCRIPTION_HINT.full).toBe(FIRST_DESCRIPTION_HINT.baseline);
  });

  it("names each arm's own ways to improve the form, in one sentence with the same ending", () => {
    for (const arm of ARMS) expect(IMPROVE_THE_FORM[arm]).toMatch(/^[^.]+, or edit the form directly\.$/);
    expect(IMPROVE_THE_FORM.full).toMatch(/questions.*description/);
    for (const arm of ["no-probes", "baseline", "assistant"] as const) {
      expect(IMPROVE_THE_FORM[arm]).not.toMatch(/questions/);
    }
  });

  it("describes what is possible, not how to work", () => {
    const text = ARMS.flatMap((arm) => [IMPROVE_THE_FORM[arm], FIRST_DESCRIPTION_HINT[arm]]).join(" ");
    expect(text).not.toMatch(/\b(should|must|best|start by|try to|make sure|probe)\b/i);
  });
});
