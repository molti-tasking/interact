/**
 * Study-log payloads for design probes: what the creator was shown and
 * what they picked, with enough context to tell "accepted the default"
 * apart from a deliberate choice.
 *
 * The pilot couldn't measure that: options have no visual default, and the
 * "no change" option is sometimes listed first, sometimes last — so the
 * option's position alone means nothing. These payloads record the display
 * order, which option (if any) keeps the form as it is, and whether the
 * previews were ready when the creator answered.
 */

import { applyProbeOption } from "interact/forms/guards";
import type { DesignProbe, PortfolioSchema } from "../types";

interface ShownOption {
  value: string;
  /** 0-based position in the list as displayed */
  position: number;
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
    noChange: option.preview
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
    noChangePosition: options.find((o) => o.noChange)?.position ?? null,
    previewsReady: options.filter((o) => o.noChange !== null).length,
  };
}

/** `probe_answered`: what was picked, where it was, and how. */
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
    position: picked?.position ?? null,
    optionCount: options.length,
    /** The answer keeps the form as it is (null: unknown, no preview yet) */
    noChange: picked ? picked.noChange : null,
    previewReady: picked ? picked.noChange !== null : false,
  };
}
