/**
 * Bounded edits to the purpose text.
 *
 * When a design decision or a field edit should show in the form's purpose,
 * the model doesn't rewrite the paragraph — it returns one edit (append a
 * sentence, or replace one existing sentence), which is applied here. Every
 * sentence the edit doesn't name stays exactly as the creator wrote it, so
 * the purpose can't drift a little with each answer.
 */

import { z } from "zod";

export const purposeEditSchema = z.object({
  op: z
    .enum(["none", "append", "replace"])
    .describe(
      '"none": the purpose already covers it; "append": add one sentence; "replace": swap one existing sentence the change made outdated',
    ),
  target: z
    .string()
    .describe(
      'For "replace": the ONE sentence to replace, copied exactly from the current purpose. Empty otherwise.',
    ),
  text: z
    .string()
    .describe(
      "The new sentence (one sentence, plain prose, no list). Empty for \"none\".",
    ),
});

export type PurposeEdit = z.infer<typeof purposeEditSchema>;

/** Prompt rules for returning a `purposeEdit`. */
export const PURPOSE_EDIT_RULES = `- "purposeEdit" changes the Purpose text by ONE small edit; the rest stays exactly as written:
  - op "append": add one sentence saying what the form now collects and why;
  - op "replace": when one existing sentence is now wrong or outdated, give it in "target" (copied exactly) and its replacement in "text";
  - op "none": when the purpose already covers it, or the change is too small to mention.
- Write the sentence in the same voice as the purpose. Never restate the whole purpose, and never list decisions.`;

/** Longest sentence an edit may add — more than that is a rewrite. */
const MAX_EDIT_CHARS = 400;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

function endSentence(text: string): string {
  return /[.!?…]["')\]]?$/.test(text) ? text : `${text}.`;
}

export interface PurposeEditResult {
  purpose: string;
  /** What was actually done — a replace whose target isn't there appends */
  applied: "none" | "append" | "replace";
}

/**
 * Apply one edit to the purpose. Deterministic:
 * - a sentence the purpose already contains is not added again;
 * - "replace" swaps the first exact occurrence of `target`; if the target
 *   isn't in the text (the model paraphrased it), the new sentence is
 *   appended instead and nothing is removed;
 * - the new text is cut to one short passage (`MAX_EDIT_CHARS`).
 */
export function applyPurposeEdit(
  purpose: string,
  edit: PurposeEdit | null | undefined,
): PurposeEditResult {
  const current = purpose.trim();
  const text = squash(edit?.text ?? "").slice(0, MAX_EDIT_CHARS).trim();
  if (!edit || edit.op === "none" || !text) {
    return { purpose: current, applied: "none" };
  }
  if (squash(current).toLowerCase().includes(text.toLowerCase().replace(/[.!?…]$/, ""))) {
    return { purpose: current, applied: "none" };
  }

  if (edit.op === "replace") {
    const target = edit.target.trim();
    const at = target ? current.indexOf(target) : -1;
    if (at >= 0) {
      // Keep the target's own end punctuation rules: the replacement stands
      // where the sentence stood
      const replacement = /[.!?…]["')\]]?$/.test(target) ? endSentence(text) : text;
      return {
        purpose: current.slice(0, at) + replacement + current.slice(at + target.length),
        applied: "replace",
      };
    }
  }

  const sentence = endSentence(text);
  return {
    purpose: current ? `${endSentence(current)} ${sentence}` : sentence,
    applied: "append",
  };
}
