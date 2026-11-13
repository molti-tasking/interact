// @vitest-environment node
/**
 * The first form's tours are matched across arms: the same first and last
 * step, word for word, and in between only the arm's own ways to change
 * the form. None tells participants how to work.
 */
import { describe, expect, it } from "vitest";
import { TOURS, taskTourId } from "@/lib/study/tours";

const ARMS = {
  full: { assistantChat: false, chatEdits: false, designProbes: true },
  "no-probes": { assistantChat: false, chatEdits: false, designProbes: false },
  baseline: { assistantChat: false, chatEdits: true, designProbes: false },
  assistant: { assistantChat: true, chatEdits: false, designProbes: false },
};

describe("first-form tours", () => {
  it("gives each arm its own tour", () => {
    expect(Object.fromEntries(Object.entries(ARMS).map(([arm, caps]) => [arm, taskTourId(caps)]))).toEqual({
      full: "task-full",
      "no-probes": "task-no-probes",
      baseline: "task-baseline",
      assistant: "task-assistant",
    });
  });

  it("starts and ends the same in every arm", () => {
    const tours = Object.values(ARMS).map((caps) => TOURS[taskTourId(caps)]);
    for (const tour of tours) {
      expect(tour[0]).toEqual(tours[0][0]);
      expect(tour[tour.length - 1]).toEqual(tours[0][tours[0].length - 1]);
    }
    expect(tours[0][0].element).toBe('[data-testid="task-bar"]');
    expect(tours[0][tours[0].length - 1].element).toBe('[data-testid="preview-pane"]');
  });

  it("shows the full tool's three ways to change the form, and the others' two", () => {
    expect(TOURS["task-full"].map((s) => s.title)).toEqual([
      "Your task",
      "Your description",
      "Questions about your form",
      "Your form",
    ]);
    expect(TOURS["task-assistant"].map((s) => s.title)).toEqual(["Your task", "The assistant", "Your form"]);
    expect(TOURS["task-baseline"].map((s) => s.title)).toEqual(["Your task", "Change requests", "Your form"]);
    expect(TOURS["task-no-probes"].map((s) => s.title)).toEqual(["Your task", "Your description", "Your form"]);
  });

  it("describes what is possible, not how to work", () => {
    const text = Object.values(ARMS)
      .flatMap((caps) => TOURS[taskTourId(caps)])
      .map((s) => s.description)
      .join(" ");
    expect(text).not.toMatch(/\b(should|must|best|first answer|start by|try to|make sure)\b/i);
  });
});
