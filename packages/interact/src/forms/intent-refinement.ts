/**
 * An intent edit's consequences for the form, as a question.
 *
 * Editing the purpose or audience of a form that already has fields asks a
 * model which fields the edit changes (`refineSchemaFromIntentAction`). That
 * patch used to be applied at once, with an Undo. Now it is offered as an
 * elicitation question with two answers — apply the changes, or keep the
 * form as it is — so the change is previewed, scoped to what the preview
 * showed, and decided like any other answer (I5, G3, G4).
 *
 * The question is built here; the deck stores and applies it like any
 * other. Where there is no deck (the `no-probes` study condition), the
 * refinement is still applied directly.
 */

import { patchScope } from "./guards";
import type { SchemaPatch } from "./schema-patch";
import type { DesignProbeOption, PortfolioSchema, ProbeOptionPreview } from "./types";

/** `design_probes.source` of these questions (curation never retires them) */
export const INTENT_EDIT_SOURCE = "intent-edit";

export const INTENT_EDIT_QUESTION = "Apply these changes from your edit?";

export interface IntentEditQuestion {
  text: string;
  /** What the model says the edit changes */
  explanation?: string;
  options: (DesignProbeOption & { preview: ProbeOptionPreview })[];
}

/**
 * The question for a refinement `patch` computed from `base`, or null when
 * the patch changes nothing there. The "apply" answer's preview carries the
 * patch with its scope on `base`: applied later, on a newer form, it may
 * only touch what it touched here.
 */
export function intentEditQuestion(
  base: PortfolioSchema,
  patch: SchemaPatch,
  summary: string,
  opts: { validTargetIds?: Iterable<string> } = {},
): IntentEditQuestion | null {
  const scope = patchScope(base, patch, opts);
  if (scope.added.length + scope.updated.length + scope.removed.length === 0) {
    return null;
  }
  const text = summary.trim();
  return {
    text: INTENT_EDIT_QUESTION,
    explanation: text || undefined,
    options: [
      {
        value: "applyEdit",
        label: "Apply the changes",
        preview: { summary: text || "Changes from your edit", schemaPatch: patch, scope },
      },
      {
        value: "keepForm",
        label: "Keep the form as it is",
        unchanged: true,
        preview: { summary: "Keeps the form as it is", schemaPatch: {} },
      },
    ],
  };
}
