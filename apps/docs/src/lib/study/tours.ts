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
      element: '[data-tour="review-tabs"]',
      title: "Answers, then refine",
      description:
        "Everyone has answered your form. Look at the answers first, then switch to Refine to improve the form.",
      side: "bottom",
    },
    {
      element: '[data-testid="responses-dashboard"]',
      title: "The answers at a glance",
      description:
        "Charts summarise the answers. Ask yourself: is this the information you wanted? Is it structured the way you need it?",
      side: "top",
    },
    {
      element: '[data-testid="findings-panel"]',
      title: "What the answers suggest",
      description:
        "Patterns the tool noticed, like options nobody picks. “Ask in Design” turns one into a design question in the Refine tab.",
      side: "bottom",
    },
  ],
};
