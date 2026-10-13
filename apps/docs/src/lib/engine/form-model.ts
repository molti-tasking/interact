/**
 * Shared prompt building blocks for every LLM call that designs or changes
 * form fields or asks design questions about them.
 *
 * `FORM_MODEL_RULES` states what a form in this system can be, so the model
 * doesn't propose fields or features the form can't support — e.g. a
 * required "Session number" the researcher would fill in after the
 * participant, who then can't submit the form at all.
 */

import { z } from "zod";

export const FORM_MODEL_RULES = `HOW FORMS WORK HERE — design only what fits this model:
- One person fills in the form in a single sitting and submits it. Work out who that is from the description (the Audience section, if any). Every field is shown to that person and answered by them at that moment.
- There are no hidden or staff-only fields, no roles, no review or approval steps, and no fields that someone else fills in later. The submission time is recorded automatically.
- So never add a field the person filling in the form can't answer right then: values someone else assigns or records (e.g. participant, session or case numbers set by a researcher; grades; scores; status; staff notes), values computed from other answers, or timestamps. If data has to come from someone else, it belongs in a separate form for that person, not in this one.
- Only make a field required if everyone filling in the form can answer it.
- Fields can be free text, number, yes/no, date, email, a choice from a list, or a rating scale such as a Likert item (plus links to other tables, where offered). The form has no conditional logic, calculations, payments, signatures, scheduling, reminders, notifications or multi-step workflows — never propose them.`;

/**
 * How the model describes a rating scale (see `scaleFromSpec`). Shared by
 * every structured output that can create or change fields.
 *
 * Everything inside is required (empty = not used): the provider rejects
 * schemas with more than 24 optional parameters, and field schemas appear
 * twice in a patch (add + update).
 */
export const scaleSpecSchema = z
  .object({
    points: z
      .array(z.string())
      .describe(
        'Likert scale: a short label for EVERY point, lowest first, e.g. ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"]. Empty for a plain numeric scale.',
      ),
    min: z.number().describe("Lowest value — 1 for a Likert scale"),
    max: z
      .number()
      .describe("Highest value — the number of points for a Likert scale"),
    lowLabel: z
      .string()
      .describe("Numeric scale: what the lowest value means; empty otherwise"),
    highLabel: z
      .string()
      .describe("Numeric scale: what the highest value means; empty otherwise"),
  })
  .describe('REQUIRED for type "scale"; omit for other types');

/** Rules for fields of type "scale", shared by every prompt that writes fields. */
export const SCALE_FIELD_RULES = `- Use type "scale" for ratings and Likert items (agreement, frequency, satisfaction, likelihood) — not "select" or "number" — and ALWAYS include its "scale". For a Likert item set scale.points to a label for every point, lowest first (usually 5 or 7 points; standardized instruments use their published anchors). For a plain numeric rating (e.g. 0–10) leave points empty and set min/max and lowLabel/highLabel. Every scale must say what its numbers mean: point labels, or both end labels (e.g. the SUS: 1 = Strongly disagree … 5 = Strongly agree).
- A questionnaire of statements rated on the same scale (e.g. a standardized instrument): one scale field per statement, the statement as its label, identical scale.points, placed next to each other — they are shown as one grid.`;

// ---------------------------------------------------------------------------
// Schema patch — the structured output for "change these fields"
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string().describe("2-5 words max"),
  value: z.string(),
});

const schemaPatchFieldSchema = z.object({
  key: z.string().describe("camelCase field key"),
  label: z.string(),
  description: z
    .string()
    .optional()
    .describe("Brief help text — omit if the label is self-explanatory"),
  tooltip: z
    .string()
    .optional()
    .describe("Extra hover guidance — omit if not needed"),
  type: z.enum([
    "string",
    "number",
    "boolean",
    "date",
    "email",
    "select",
    "scale",
    "reference",
  ]),
  // Right after `type`: further away, the model tends to skip it
  scale: scaleSpecSchema.optional(),
  required: z.boolean(),
  validation: z
    .object({ options: z.array(optionSchema).optional() })
    .optional(),
  referenceTarget: z
    .string()
    .optional()
    .describe(
      "For type 'reference' only: the id of the space table this field links to — must be one of the listed table ids",
    ),
});

export const schemaPatchSchema = z
  .object({
    addFields: z
      .array(schemaPatchFieldSchema)
      .optional()
      .describe("New fields to add to the schema"),
    removeFieldKeys: z
      .array(z.string())
      .optional()
      .describe("camelCase keys of fields to remove"),
    updateFields: z
      .array(schemaPatchFieldSchema)
      .optional()
      .describe(
        "Fields to update — include the full field definition with the same key",
      ),
  })
  .describe(
    "Only the changes to apply to the current schema. Omit sections with no changes.",
  );

/** Rules for "schemaPatch" output, shared by every prompt that returns one. */
export function schemaPatchRules(hasSpaceTables: boolean): string {
  return `- Use valid field types: "string", "number", "boolean", "date", "email", "select", "scale"${hasSpaceTables ? `, "reference"
- Use type "reference" when a field should link each entry to an item in one of the OTHER TABLES IN THIS SPACE (e.g. inventory entries referencing a product template). Set "referenceTarget" to that table's id EXACTLY as listed — never invent table ids.` : ""}
- For select fields, ALWAYS include options in validation.options as [{label, value}] objects
- CRITICAL: When updating a select field (even if only changing its label), you MUST re-include the full validation.options array. Omitting options will erase them. Likewise re-include the full "scale" when updating a scale field.
${SCALE_FIELD_RULES}
- Field keys MUST be camelCase and descriptive
- "description" should be SHORT (a few words) — omit entirely if the label already makes the field obvious
- "tooltip" is for extra guidance that helps the user fill in the field correctly — omit if not needed
- IMPORTANT: Only include fields that CHANGE in schemaPatch. Leave unchanged fields alone.`;
}
