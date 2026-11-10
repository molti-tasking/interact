/**
 * Study-log payloads for elicitation questions: what the creator was shown
 * and what they picked, with enough context to tell "took what was offered
 * first" apart from a deliberate choice.
 *
 * The answers are shown in a random order drawn once per question
 * (`probe-options.ts`); nothing is pre-selected or highlighted. These
 * payloads record that displayed order, where the model had each answer,
 * which answer keeps the form as it is, and whether the previews were ready.
 *
 * Event names and their fields are read by the analysis scripts: add fields,
 * don't rename them.
 */

import { applyProbeOption } from "interact/forms/guards";
import type { DesignProbe, PortfolioSchema } from "../types";

interface ShownOption {
  value: string;
  /** 0-based position in the list as displayed (the randomised order) */
  position: number;
  /** Where the model had it; null: added here, or stored before the order was randomised */
  modelPosition: number | null;
  /** null while its preview isn't computed yet */
  noChange: boolean | null;
}

/** The options in display order (the deck shows `probe.options` as is). */
function shownOptions(
  probe: Pick<DesignProbe, "options">,
  schema: PortfolioSchema,
  validTargetIds: readonly string[] = [],
): ShownOption[] {
  return probe.options.map((option, position) => ({
    value: option.value,
    position,
    modelPosition: option.modelPosition ?? null,
    noChange: option.unchanged
      ? true
      : option.preview
        ? !applyProbeOption(schema, option.preview, { validTargetIds }).changed
        : null,
  }));
}

/** `probe_shown`: logged once when a probe's options are first displayed. */
export function probeShownPayload(
  probe: Pick<DesignProbe, "id" | "text" | "source" | "priority" | "options">,
  schema: PortfolioSchema,
  validTargetIds: readonly string[] = [],
) {
  const options = shownOptions(probe, schema, validTargetIds);
  return {
    id: probe.id,
    text: probe.text,
    source: probe.source,
    priority: probe.priority,
    options,
    /** Nothing is pre-selected or highlighted in the deck */
    highlighted: null,
    /** The order on screen was drawn at random when the question was stored */
    orderRandomized: probe.options.some((o) => o.modelPosition !== undefined),
    noChangePosition: options.find((o) => o.noChange)?.position ?? null,
    previewsReady: options.filter((o) => o.noChange !== null).length,
  };
}

/**
 * `probe_answered`: what was applied, where it was, and how. Logged when an
 * answer is committed — never for a click that only brought up its preview.
 * A typed answer is the last entry of `probe.options` here.
 */
export function probeAnsweredPayload(
  probe: Pick<DesignProbe, "id" | "text" | "source" | "options">,
  value: string,
  schema: PortfolioSchema,
  validTargetIds: readonly string[] = [],
) {
  const custom = value.startsWith("custom:");
  const options = shownOptions(probe, schema, validTargetIds);
  const picked = options.find((o) => o.value === value);
  return {
    id: probe.id,
    text: probe.text,
    source: probe.source,
    option: value,
    /** "custom" = the creator typed their own answer */
    answerSource: custom ? ("custom" as const) : ("option" as const),
    typed: custom,
    position: picked?.position ?? null,
    modelPosition: picked?.modelPosition ?? null,
    /** Suggested answers on the card (the typed one not counted) */
    optionCount: custom ? options.length - (picked ? 1 : 0) : options.length,
    /** The answer keeps the form as it is (null: unknown, no preview yet) */
    noChange: picked ? picked.noChange : null,
    /** It is the question's marked unchanged answer */
    unchangedAnswer: probe.options.find((o) => o.value === value)?.unchanged === true,
    previewReady: picked ? picked.noChange !== null : false,
  };
}
