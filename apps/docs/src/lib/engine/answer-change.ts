import { applyProbeOption } from "interact/forms/guards";
import type { DesignProbe, DesignProbeOption, ProbeOptionPreview } from "../types";
import type { ChangeFn } from "./commit";

/**
 * The commit of a pre-computed answer: its patch replayed on the latest
 * state within the preview's scope, never on locked fields, with no model
 * call — the change the creator was shown is the change that lands. The
 * question and the chosen answer are the rationale. Returns null (nothing
 * is written) when the answer changes nothing on the latest state.
 *
 * Used by the deck (`useApplyProbePreview`) and by the evaluation harness,
 * so both run the same code.
 */
export function answerChange(
  probe: Pick<DesignProbe, "text">,
  option: Pick<DesignProbeOption, "label"> & { preview: ProbeOptionPreview },
  resolvedBy: string,
  validTargetIds: readonly string[] = [],
): ChangeFn {
  return (current) => {
    const { schema, changed } = applyProbeOption(current.schema, option.preview, {
      validTargetIds,
    });
    if (!changed) return null;
    return {
      trigger: "answer",
      schema,
      automated: true,
      provenance: {
        layer: "dimensions",
        action: "design_probe_resolved",
        actor: resolvedBy,
        rationale: `"${probe.text}" → "${option.label}"`,
      },
    };
  };
}
