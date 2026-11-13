// @vitest-environment node
/**
 * The online study's onboarding is one coach mark per arm, matched: it
 * points at the arm's own pane, says in one sentence how the form can be
 * improved, and ends with a click into that pane (a check that the
 * participant is there).
 */
import { describe, expect, it } from "vitest";
import { IMPROVE_THE_FORM } from "@/lib/study/arm-copy";
import { TOURS, taskTourId } from "@/lib/study/tours";

const ARMS = {
  full: { assistantChat: false, chatEdits: false, designProbes: true },
  "no-probes": { assistantChat: false, chatEdits: false, designProbes: false },
  baseline: { assistantChat: false, chatEdits: true, designProbes: false },
  assistant: { assistantChat: true, chatEdits: false, designProbes: false },
} as const;

describe("first-form coach mark", () => {
  it("gives each arm its own", () => {
    for (const [arm, caps] of Object.entries(ARMS)) expect(taskTourId(caps)).toBe(`task-${arm}`);
  });

  it("is one step on the arm's pane, the same in every arm but the sentence", () => {
    for (const [arm, caps] of Object.entries(ARMS)) {
      const steps = TOURS[taskTourId(caps)];
      expect(steps).toHaveLength(1);
      expect(steps[0]).toEqual({
        element: '[data-tour="workspace-controls"]',
        title: "Working on your form",
        description: `${IMPROVE_THE_FORM[arm as keyof typeof ARMS]} Click the highlighted area to start.`,
        side: "right",
        clickToContinue: true,
      });
    }
  });

  it("leaves the workshop's tours as they were", () => {
    expect(TOURS.create.map((s) => s.title)).toEqual(["Your task", "Your intent", "Elicitation questions", "Your form"]);
    expect(TOURS.create.some((s) => s.clickToContinue)).toBe(false);
  });
});
