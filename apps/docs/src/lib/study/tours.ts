/**
 * Coach-mark tours for workshop participants (driver.js). Steps point at
 * stable `data-testid` / `data-tour` attributes; missing elements are
 * skipped, so a step can safely target something that isn't rendered yet.
 */

export type TourId = "create" | "review";

interface TourStep {
  element: string;
  title: string;
  description: string;
  side?: "top" | "right" | "bottom" | "left";
}

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
      title: "Design questions",
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
        "Each question shows how many answered it. Hover a question to see its answers, click it to change it.",
      side: "left",
    },
    {
      element: '[data-testid="card-deck-section"]',
      title: "Design questions",
      description:
        "Some design questions now come from the answers, like an option nobody picked. Answer or skip them, or ask for new ones.",
      side: "right",
    },
  ],
};
