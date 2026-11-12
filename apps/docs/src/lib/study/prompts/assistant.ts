/**
 * The system prompt of the `assistant` study arm: a general-purpose chat
 * assistant that builds a web form with the participant, in the style of
 * Claude or ChatGPT with an artifact next to the chat.
 *
 * The comparison is about who raises the open decisions, so this prompt is
 * deliberately neutral. It must NOT tell the model to ask questions, to
 * avoid them, or to suggest more, must not mention elicitation, and must
 * not reuse wording from the full arm's prompts — whatever the model does
 * there is its own default behaviour. `tests/unit/assistant-prompt.test.ts`
 * fails if it does.
 *
 * Bump `ASSISTANT_PROMPT_VERSION` whenever the wording changes; it is logged
 * with every turn.
 */

import { schemaPatchSchema } from "interact/forms/form-model";
import type { Field, PortfolioSchema } from "interact/forms/types";
import { z } from "zod";

export const ASSISTANT_PROMPT_VERSION = "assistant-1";

/**
 * Structured output of one turn: a reply and, optionally, a patch in the
 * chat edits' vocabulary. The descriptions are part of what the model
 * reads; like the system prompt, they say what each part is and nothing
 * about how to talk to the person.
 */
export const assistantTurnSchema = z.object({
  reply: z.string().describe("Your message to the person, in plain text"),
  schemaPatch: schemaPatchSchema
    .nullable()
    .describe("The change to the form, applied as soon as you reply; null to leave the form as it is"),
});

/** The patch vocabulary's name for a stored field type. */
function typeName(field: Field): string {
  return field.type.kind === "text" ? "string" : field.type.kind;
}

/**
 * The form as data: every field with its key, label, type, whether it is
 * required, its help text and choices, and the section it is in.
 */
export function formAsJson(schema: PortfolioSchema): string {
  const sectionOf = new Map<string, string>();
  for (const group of schema.groups) {
    for (const id of group.fieldIds) sectionOf.set(id, group.label);
  }
  const fields = schema.fields.map((field) => {
    const entry: Record<string, unknown> = {
      key: field.name,
      label: field.label,
      type: typeName(field),
      required: field.required,
    };
    if (field.description) entry.description = field.description;
    if (field.type.kind === "select") {
      entry.options = field.type.options.map((o) => o.label);
      if (field.type.multiple) entry.multiple = true;
    }
    if (field.type.kind === "scale") {
      entry.scale = { min: field.type.min, max: field.type.max };
    }
    const section = sectionOf.get(field.id);
    if (section) entry.section = section;
    return entry;
  });
  return JSON.stringify({ fields }, null, 2);
}

/** The system prompt for one turn: the same text, with the form as it is now. */
export function assistantSystemPrompt(schema: PortfolioSchema): string {
  return `You are a helpful assistant. You are helping someone build a web form in a form builder.

The form is shown next to this chat. The person can also change it there themselves: edit a field, add one, or move fields around.

To change the form, return the change in "schemaPatch". It is applied to the form as soon as you reply, and the person can undo it. Set "schemaPatch" to null when the form stays as it is. Name existing fields by their "key" exactly as listed below.

Write "reply" in plain text, without Markdown.

The form as it is now:
<current_form>
${formAsJson(schema)}
</current_form>`;
}
