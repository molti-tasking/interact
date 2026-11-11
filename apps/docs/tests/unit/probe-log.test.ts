import { describe, expect, it } from "vitest";
import { probeAnsweredPayload, probeShownPayload } from "@/lib/study/probe-log";
import type { DesignProbe, PortfolioSchema } from "@/lib/types";
import { prepareProbeOptions, seededRandom } from "interact/forms/probe-options";

const schema: PortfolioSchema = {
  fields: [
    {
      id: "f-name",
      name: "name",
      label: "Name",
      type: { kind: "text" },
      required: true,
      constraints: [],
      origin: "system",
      tags: [],
    },
  ],
  groups: [],
  version: 1,
};

const probe: Pick<DesignProbe, "id" | "text" | "source" | "priority" | "options"> = {
  id: "p1",
  text: "Ask for a phone number?",
  source: "llm",
  priority: 1,
  options: [
    {
      value: "yes",
      label: "Yes",
      preview: {
        summary: "Adds phone",
        schemaPatch: {
          addFields: [{ key: "phone", label: "Phone", type: "string", required: false }],
        },
        scope: { added: ["phone"], updated: [], removed: [] },
      },
    },
    {
      value: "no",
      label: "No, keep it short",
      preview: { summary: "No form change", schemaPatch: {}, scope: { added: [], updated: [], removed: [] } },
    },
    { value: "later", label: "Decide later" },
  ],
};

describe("probe study log", () => {
  it("records display order, the no-change position and preview readiness", () => {
    const shown = probeShownPayload(probe, schema);
    expect(shown.options).toEqual([
      { value: "yes", position: 0, modelPosition: null, noChange: false },
      { value: "no", position: 1, modelPosition: null, noChange: true },
      { value: "later", position: 2, modelPosition: null, noChange: null },
    ]);
    // Stored before the order was randomised
    expect(shown.orderRandomized).toBe(false);
    expect(shown.noChangePosition).toBe(1);
    expect(shown.previewsReady).toBe(2);
  });

  it("classifies answers as option or custom, with their position", () => {
    expect(probeAnsweredPayload(probe, "no", schema)).toMatchObject({
      answerSource: "option",
      position: 1,
      noChange: true,
      previewReady: true,
    });
    expect(probeAnsweredPayload(probe, "custom:only an email", schema)).toMatchObject({
      answerSource: "custom",
      typed: true,
      position: null,
      previewReady: false,
    });
  });

  it("logs the randomised order as displayed, next to the model's order", () => {
    const stored = prepareProbeOptions(probe.options.slice(0, 2), {
      schema,
      random: seededRandom("log"),
    });
    const shown = probeShownPayload({ ...probe, options: stored }, schema);
    expect(shown.orderRandomized).toBe(true);
    // `position` is the place on screen: the stored (shuffled) order
    expect(shown.options.map((o) => o.value)).toEqual(stored.map((o) => o.value));
    expect(shown.options.map((o) => o.position)).toEqual(stored.map((_, i) => i));
    for (const option of shown.options) {
      const original = probe.options.findIndex((o) => o.value === option.value);
      expect(option.modelPosition).toBe(original);
    }
    expect(shown.noChangePosition).toBe(stored.findIndex((o) => o.unchanged));

    const keep = stored.find((o) => o.unchanged)!;
    expect(probeAnsweredPayload({ ...probe, options: stored }, keep.value, schema)).toMatchObject({
      position: stored.indexOf(keep),
      modelPosition: 1,
      noChange: true,
      unchangedAnswer: true,
      typed: false,
    });
  });

  it("logs an applied typed answer as the last one, after the suggested answers", () => {
    const typed = {
      value: "custom:Only a mobile number",
      label: "Only a mobile number",
      preview: probe.options[0].preview,
    };
    const payload = probeAnsweredPayload(
      { ...probe, options: [...probe.options, typed] },
      typed.value,
      schema,
    );
    expect(payload).toMatchObject({
      answerSource: "custom",
      typed: true,
      position: 3,
      optionCount: 3,
      modelPosition: null,
      noChange: false,
      unchangedAnswer: false,
      previewReady: true,
    });
  });
});
