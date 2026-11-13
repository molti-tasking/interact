/**
 * Coach-mark tours for study participants (driver.js). Steps point at
 * stable `data-testid` / `data-tour` attributes; missing elements are
 * skipped, so a step can safely target something that isn't rendered yet.
 *
 * Workshop: "create", "review". Online study: one tour per arm for the
 * first form ("task-…"), matched across arms — the same first and last
 * step, word for word, and in between each arm's own ways to change the
 * form. They say what is possible, never how to go about it.
 */

import { armOf } from "./arm-copy";

type TaskTourId = "task-full" | "task-no-probes" | "task-baseline" | "task-assistant";

export type TourId = "create" | "review" | TaskTourId;

interface TourStep {
  element: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
}

// Online study, the first form: shared steps
const TASK_BAR: TourStep = {
  element: '[data-testid="task-bar"]',
  title: "Your task",
  description:
    "Build the form the people in the situation need. “Show the situation” opens it again, and “My form is ready” finishes this form. The time left is at the top right.",
  side: "bottom",
};

const THE_FORM: TourStep = {
  element: '[data-testid="preview-pane"]',
  title: "Your form",
  description:
    "This is the form people will fill in. Click a field to change or remove it, drag a field by the handle on its left to move it, or add a field at the bottom. You can undo every change.",
  side: "left",
};

const DESCRIPTION: TourStep = {
  element: '[data-testid="reflective-conversation-pane"]',
  title: "Your description",
  description:
    "What you told the tool about the form. Change it whenever you like and press “Refine Form”: the form follows your description.",
  side: "right",
};

export const TOURS: Record<TourId, TourStep[]> = {
  create: [
    {
      element: '[data-tour="phase-bar"]',
      title: "Your task",
      description:
        "Create a form about your hobby — something you'd like to ask other people. The timer is a guide; the facilitator moves everyone on together.",
      side: "bottom",
    },
    {
      element: '[data-testid="reflective-conversation-pane"]',
      title: "Your intent",
      description:
        "Describe what the form is for and who fills it in. Edit it any time, then press Refine to update the form.",
      side: "right",
    },
    {
      element: '[data-testid="card-deck-section"]',
      title: "Elicitation questions",
      description:
        "The tool asks about decisions your form needs. Hover an answer to preview the change on the form, click to apply it — or skip what doesn't matter.",
      side: "right",
    },
    {
      element: '[data-testid="preview-pane"]',
      title: "Your form",
      description:
        "This is what others will fill in. Click a field to edit it, or add a field by describing it.",
      side: "left",
    },
  ],
  review: [
    {
      element: '[data-testid="answers-panel"]',
      title: "The answers to your form",
      description:
        "Everyone has answered your form. See all answers in the table, or switch to one person at a time.",
      side: "bottom",
    },
    {
      element: '[data-testid="preview-pane"]',
      title: "Answers on your form",
      description:
        "Each field shows how many answered it. Hover a field to see its answers, click it to change it.",
      side: "left",
    },
    {
      element: '[data-testid="card-deck-section"]',
      title: "Elicitation questions",
      description:
        "Some elicitation questions now come from the answers, like an option nobody picked. Answer or skip them, or ask for new ones.",
      side: "right",
    },
  ],
  // Online study, the first form: one tour per arm
  "task-full": [
  TASK_BAR,
  DESCRIPTION,
  {
    element: '[data-testid="card-deck-section"]',
    title: "Questions about your form",
    description:
      "The tool asks questions about your form. Hover over an answer to see what it would change on the form, and click it to apply it. You can skip any question.",
    side: "right",
  },
  THE_FORM,
],

  "task-no-probes": [TASK_BAR, DESCRIPTION, THE_FORM],

  "task-baseline": [
  TASK_BAR,
  {
    element: '[data-testid="chat-edit-pane"]',
    title: "Change requests",
    description: "Write what to change on the form, and the tool makes the change.",
    side: "right",
  },
  THE_FORM,
],

  "task-assistant": [
  TASK_BAR,
  {
    element: '[data-testid="assistant-pane"]',
    title: "The assistant",
    description:
      "Write to the assistant in your own words. It answers here and can change the form next to the chat.",
    side: "right",
  },
  THE_FORM,
],
};

/** The first form's tour for what the participant's arm offers. */
export function taskTourId(caps: Parameters<typeof armOf>[0]): TaskTourId {
  return `task-${armOf(caps)}`;
}
