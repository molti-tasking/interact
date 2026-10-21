/**
 * The workshop's final questionnaire, as a form the existing FormRenderer
 * shows (Likert `scale` fields, long-text answers, sections as pages).
 * Edit the wording here; answers are stored under the field names in
 * `study_questionnaire_responses.answers`.
 *
 * Sections:
 *   1. SUS — System Usability Scale (Brooke 1996), standard 10 items
 *   2. Cognitive Dimensions of Notation (Green & Petre 1996), one item per
 *      dimension relevant to form design; (R) = reverse-scored
 *   3. Responses & refinement — the study's research question
 *   4. About you
 */

import type { Field, FieldGroup, PortfolioSchema } from "@/lib/types";

export const FINAL_INSTRUMENT = "final";

const AGREEMENT = [
  "Strongly disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly agree",
];

function likert(name: string, label: string): Field {
  return {
    id: name,
    name,
    label,
    type: { kind: "scale", min: 1, max: 5, points: AGREEMENT },
    required: true,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

function longText(name: string, label: string, required = false): Field {
  return {
    id: name,
    name,
    label,
    type: { kind: "text", maxLength: 2000 },
    required,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

function select(
  name: string,
  label: string,
  options: string[],
  multiple = false,
): Field {
  return {
    id: name,
    name,
    label,
    type: {
      kind: "select",
      multiple,
      options: options.map((o) => ({ label: o, value: o })),
    },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

const SUS_ITEMS = [
  "I think that I would like to use this system frequently.",
  "I found the system unnecessarily complex.",
  "I thought the system was easy to use.",
  "I think that I would need the support of a technical person to be able to use this system.",
  "I found the various functions in this system were well integrated.",
  "I thought there was too much inconsistency in this system.",
  "I would imagine that most people would learn to use this system very quickly.",
  "I found the system very cumbersome to use.",
  "I felt very confident using the system.",
  "I needed to learn a lot of things before I could get going with this system.",
];

/** Cognitive dimension → item; `reverse` items are agreement = worse. */
const CDN_ITEMS: { name: string; dimension: string; label: string; reverse?: boolean }[] = [
  {
    name: "cdn_closeness",
    dimension: "Closeness of mapping",
    label: "The questions the tool asked matched how I think about my hobby.",
  },
  {
    name: "cdn_progressive_evaluation",
    dimension: "Progressive evaluation",
    label: "I could check how my form was turning out at any point while working on it.",
  },
  {
    name: "cdn_premature_commitment",
    dimension: "Premature commitment",
    label: "I had to decide things about my form before I knew enough to decide them.",
    reverse: true,
  },
  {
    name: "cdn_viscosity",
    dimension: "Viscosity",
    label: "Changing my form after it was first created was easy.",
  },
  {
    name: "cdn_hidden_dependencies",
    dimension: "Hidden dependencies",
    label: "When I changed one thing, it was clear what else in the form changed with it.",
  },
  {
    name: "cdn_role_expressiveness",
    dimension: "Role-expressiveness",
    label: "I understood why the tool asked each of its design questions.",
  },
  {
    name: "cdn_error_proneness",
    dimension: "Error-proneness",
    label: "The tool made changes to my form that I did not want.",
    reverse: true,
  },
  {
    name: "cdn_visibility",
    dimension: "Visibility",
    label: "I could easily see all parts of my form and the decisions behind them.",
  },
];

const susFields = SUS_ITEMS.map((label, i) => likert(`sus_${i + 1}`, label));
const cdnFields = CDN_ITEMS.map((item) => likert(item.name, item.label));
const responseFields = [
  likert(
    "responses_useful_structure",
    "The answers I received were structured in a way that was useful to me.",
  ),
  likert(
    "responses_revealed_problems",
    "The answers showed me problems with my form that I had not anticipated.",
  ),
  likert(
    "refine_easy",
    "Refining my form after seeing the answers was easy.",
  ),
  longText(
    "responses_revealed",
    "What did the answers to your form reveal about it?",
    true,
  ),
  longText(
    "refine_changes",
    "What did you change after seeing the answers — and why?",
    true,
  ),
  longText(
    "refine_missing",
    "Was there anything you wanted to change but couldn't? What got in the way?",
  ),
];
const aboutFields = [
  select("forms_experience", "How often do you create forms or questionnaires?", [
    "Never before",
    "A few times",
    "Regularly",
    "It's part of my job",
  ]),
  select(
    "forms_tools",
    "Which tools have you used to create forms?",
    [
      "Google Forms",
      "Microsoft Forms",
      "Typeform",
      "SurveyMonkey",
      "LimeSurvey / Qualtrics",
      "Airtable / Notion",
      "Paper",
      "None",
    ],
    true,
  ),
  longText("comments", "Anything else you'd like to tell us?"),
];

function section(id: string, label: string, description: string, fields: Field[]): FieldGroup {
  return { id, label, description, fieldIds: fields.map((f) => f.id) };
}

export const FINAL_QUESTIONNAIRE: PortfolioSchema = {
  version: 1,
  layout: "paged",
  fields: [...susFields, ...cdnFields, ...responseFields, ...aboutFields],
  groups: [
    section(
      "sus",
      "Using the tool",
      "How much do you agree with each statement about the form tool you used today?",
      susFields,
    ),
    section(
      "cdn",
      "Working on your form",
      "Think about creating and refining your hobby form.",
      cdnFields,
    ),
    section(
      "responses",
      "The answers you received",
      "Think about the review phase: the answers to your form and how you refined it.",
      responseFields,
    ),
    section("about", "About you", "Optional.", aboutFields),
  ],
};

/** SUS score (0–100) from answers 1–5, or null if any item is missing. */
export function susScore(answers: Record<string, unknown>): number | null {
  let sum = 0;
  for (let i = 1; i <= 10; i++) {
    const value = Number(answers[`sus_${i}`]);
    if (!Number.isFinite(value) || value < 1 || value > 5) return null;
    // Odd items are positive, even items negative
    sum += i % 2 === 1 ? value - 1 : 5 - value;
  }
  return sum * 2.5;
}

/** CDN items with their dimension, for analysis/export. */
export const CDN_DIMENSIONS = CDN_ITEMS.map(({ name, dimension, reverse }) => ({
  name,
  dimension,
  reverse: !!reverse,
}));
