/**
 * Coach-mark tours for study participants (driver.js). Steps point at
 * stable `data-testid` / `data-tour` attributes; missing elements are
 * skipped, so a step can safely target something that isn't rendered yet.
 *
 * Workshop: "create", "review". Online study: one coach mark per arm on
 * the first form, once the form is there (the assistant's: from the
 * start). It points at the arm's own pane and says in one sentence, the
 * same ending in every arm, how the form can be improved. It says what is
 * possible, never how to go about it.
 */

import { armOf, IMPROVE_THE_FORM, type StudyArm } from "./arm-copy";

type TaskTourId = `task-${StudyArm}`;

export type TourId = "create" | "review" | TaskTourId;

interface TourStep {
  element: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
  /**
   * A one-step tour that ends with a click into the highlighted element
   * (no buttons, can't be closed otherwise): onboarding and a check that
   * the participant is there, timed in `tour_closed.ms`.
   */
  clickToContinue?: boolean;
}

/** The one coach mark of the online study: the arm's pane, one sentence */
const improveTheForm = (arm: StudyArm): TourStep[] => [
  {
    element: '[data-tour="workspace-controls"]',
    title: "Working on your form",
    description: `${IMPROVE_THE_FORM[arm]} Click the highlighted area to start.`,
    side: "right",
    clickToContinue: true,
  },
];

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
  // Online study, the first form
  "task-full": improveTheForm("full"),
  "task-no-probes": improveTheForm("no-probes"),
  "task-baseline": improveTheForm("baseline"),
  "task-assistant": improveTheForm("assistant"),
};

/** The coach mark for what the participant's arm offers. */
export function taskTourId(caps: Parameters<typeof armOf>[0]): TaskTourId {
  return `task-${armOf(caps)}`;
}
