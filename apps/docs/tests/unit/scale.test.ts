import {
  groupLikertRuns,
  likertPoints,
  scaleFromSpec,
  scalePointLabel,
  scaleValueForLabel,
} from "@/lib/engine/scale";
import { applySchemaPatch } from "@/lib/engine/schema-patch";
import { serializeSchemaForLLM } from "@/lib/engine/structured-intent";
import { coerceValueForField, formatValue } from "@/lib/form-renderer/values";
import type { Field, FieldType, PortfolioSchema } from "@/lib/types";
import { buildResponseEntry } from "@/lib/voice/data-entry";
import { describe, expect, it } from "vitest";

const AGREEMENT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

function field(name: string, type: FieldType, extra: Partial<Field> = {}): Field {
  return {
    id: `id-${name}`,
    name,
    label: name,
    type,
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...extra,
  };
}

const likert = (points = AGREEMENT): FieldType => scaleFromSpec({ points });

describe("scaleFromSpec", () => {
  it("derives the range from the point labels", () => {
    expect(scaleFromSpec({ points: AGREEMENT })).toEqual({
      kind: "scale",
      min: 1,
      max: 5,
      points: AGREEMENT,
    });
    expect(scaleFromSpec({ points: ["Low", "High"], min: 0 })).toMatchObject({ min: 0, max: 1 });
  });

  it("builds numeric scales, defaulting to 1–5 and repairing bad ranges", () => {
    expect(scaleFromSpec({ min: 0, max: 10, lowLabel: "Not at all", highLabel: "Extremely" })).toEqual({
      kind: "scale",
      min: 0,
      max: 10,
      labels: { low: "Not at all", high: "Extremely" },
    });
    expect(scaleFromSpec(undefined)).toEqual({ kind: "scale", min: 1, max: 5 });
    expect(scaleFromSpec({ min: 5, max: 1 })).toMatchObject({ min: 5, max: 9 });
    expect(scaleFromSpec({ points: ["Only one"] })).toEqual({ kind: "scale", min: 1, max: 5 });
  });
});

describe("Likert labels", () => {
  const type = likert();

  it("maps between numbers and point labels", () => {
    expect(scalePointLabel(type, 4)).toBe("Agree");
    expect(scaleValueForLabel(type, "strongly AGREE")).toBe(5);
    expect(scaleValueForLabel(type, "kind of")).toBeNull();
  });

  it("ignores labels that don't match the range", () => {
    expect(likertPoints({ kind: "scale", min: 1, max: 7, points: AGREEMENT })).toBeNull();
  });

  it("formats and coerces response values by label", () => {
    const f = field("ease", type);
    expect(formatValue(4, f)).toBe("Agree (4)");
    expect(coerceValueForField(f, "Neutral")).toEqual({ ok: true, value: 3 });
    expect(coerceValueForField(f, "2")).toEqual({ ok: true, value: 2 });
  });

  it("accepts spoken labels in voice data entry", () => {
    const schema: PortfolioSchema = { fields: [field("ease", type)], groups: [], version: 1 };
    expect(buildResponseEntry(schema, [{ field: "ease", value: "agree" }]).data).toEqual({ ease: 4 });
  });

  it("shows the labels to the LLM", () => {
    const schema: PortfolioSchema = { fields: [field("ease", type)], groups: [], version: 1 };
    expect(serializeSchemaForLLM(schema)).toContain(
      "scale 1-5: [Strongly disagree | Disagree | Neutral | Agree | Strongly agree]",
    );
  });
});

describe("groupLikertRuns", () => {
  it("groups consecutive items on the same Likert scale", () => {
    const fields = [
      field("name", { kind: "text" }),
      field("q1", likert()),
      field("q2", likert()),
      field("q3", likert()),
      field("freq", likert(["Never", "Sometimes", "Always"])),
      field("q4", likert()),
      field("nps", scaleFromSpec({ min: 0, max: 10 })),
    ];
    const blocks = groupLikertRuns(fields).map((b) =>
      Array.isArray(b) ? b.map((f) => f.name) : b.name,
    );
    expect(blocks).toEqual(["name", ["q1", "q2", "q3"], "freq", "q4", "nps"]);
  });

  it("leaves scales too wide for a grid alone", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => String(i));
    const fields = [field("a", likert(eleven)), field("b", likert(eleven))];
    expect(groupLikertRuns(fields)).toEqual(fields);
  });
});

describe("schema patches with scales", () => {
  const schema: PortfolioSchema = {
    fields: [
      field("ease", likert()),
      field("hours", { kind: "number", unit: "h" }),
    ],
    groups: [],
    version: 1,
  };

  it("adds a Likert item from the patch's scale", () => {
    const { schema: next } = applySchemaPatch(schema, {
      addFields: [
        {
          key: "confidence",
          label: "I felt confident",
          type: "scale",
          required: true,
          scale: { points: AGREEMENT },
        },
      ],
    });
    expect(next.fields[2].type).toEqual(likert());
  });

  it("changes a scale only when the patch spells it out", () => {
    const seven = ["1", "2", "3", "4", "5", "6", "7"];
    const relabel = applySchemaPatch(schema, {
      updateFields: [{ key: "ease", label: "Easy to use", type: "scale", required: false }],
    }).schema;
    expect(relabel.fields[0].type).toEqual(likert());

    const legacy = applySchemaPatch(schema, {
      updateFields: [{ key: "ease", label: "Easy", type: "number", required: false }],
    }).schema;
    expect(legacy.fields[0].type).toEqual(likert());

    const widened = applySchemaPatch(schema, {
      updateFields: [{ key: "ease", label: "Easy", type: "scale", required: false, scale: { points: seven } }],
    }).schema;
    expect(widened.fields[0].type).toMatchObject({ min: 1, max: 7, points: seven });

    const converted = applySchemaPatch(schema, {
      updateFields: [{ key: "hours", label: "Hours", type: "scale", required: false, scale: { min: 0, max: 10 } }],
    }).schema;
    expect(converted.fields[1].type).toEqual({ kind: "scale", min: 0, max: 10 });
  });
});
