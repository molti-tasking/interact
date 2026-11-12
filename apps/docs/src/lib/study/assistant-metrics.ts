/**
 * What the `assistant` arm logs about each turn, computed the same way
 * every time so turns can be compared across participants and arms.
 *
 * Pure: no app imports, usable from the export and from scripts.
 */

import type { SchemaPatch } from "interact/forms/schema-patch";

/** Web addresses: a "?" inside one starts a query string, not a question. */
const WEB_ADDRESS = /\b(?:https?:\/\/|www\.)\S+/gi;

/** A run of text, then the run of sentence-ending marks that closes it. */
const SEGMENT = /([^.!?…？]*)([.!?…？]*)/g;

/**
 * How many sentences of `text` are questions.
 *
 * The text is split into sentences at line breaks and after every run of
 * sentence-ending marks (`.`, `!`, `?`, `…`, the full-width `？`). A sentence
 * counts when its closing run contains a question mark and the sentence has
 * at least one letter or digit before it. So:
 *
 * - "What size? Which days?" counts 2; "Really?!" counts 1; "??" alone 0.
 * - A question in a list item ("- Which age group?") counts.
 * - Closing quotes, brackets and Markdown marks after the "?" don't hide it:
 *   `(Is that right?)` and `**Which ground?**` count 1 each.
 * - A "?" inside a web address doesn't count.
 * - A question without a question mark doesn't count ("Let me know which
 *   days.").
 * - Quotes are not parsed: `You wrote "Is it free?" earlier.` counts 1.
 */
export function countQuestionSentences(text: string): number {
  if (!text) return 0;
  let count = 0;
  for (const line of text.replace(WEB_ADDRESS, "link").split(/\r?\n/)) {
    for (const [, words, marks] of line.matchAll(SEGMENT)) {
      if (!marks) continue;
      if (!/[?？]/.test(marks)) continue;
      if (!/[\p{L}\p{N}]/u.test(words)) continue;
      count++;
    }
  }
  return count;
}

/**
 * The size of a patch: fields added + fields updated + fields removed +
 * section placements. Null when there is no patch at all; 0 for a patch
 * that names nothing.
 */
export function patchOperationCount(patch: SchemaPatch | null | undefined): number | null {
  if (!patch) return null;
  return (
    (patch.addFields?.length ?? 0) +
    (patch.updateFields?.length ?? 0) +
    (patch.removeFieldKeys?.length ?? 0) +
    (patch.sections?.length ?? 0)
  );
}
