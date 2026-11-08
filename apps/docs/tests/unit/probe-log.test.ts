import { describe, expect, it } from "vitest";
import { probeAnsweredPayload, probeShownPayload } from "@/lib/study/probe-log";
import type { DesignProbe, PortfolioSchema } from "@/lib/types";

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
      { value: "yes", position: 0, noChange: false },
      { value: "no", position: 1, noChange: true },
      { value: "later", position: 2, noChange: null },
    ]);
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
      position: null,
      previewReady: false,
    });
  });
});
