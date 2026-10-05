import {
  applySchemaPatch,
  mergeRegeneratedSchema,
  type PatchField,
} from "@/lib/engine/schema-patch";
import type { Field, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

function field(id: string, name: string, extra: Partial<Field> = {}): Field {
  return {
    id,
    name,
    label: name,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...extra,
  };
}

function patchField(key: string, extra: Partial<PatchField> = {}): PatchField {
  return { key, label: key, type: "string", required: false, ...extra };
}

const schema: PortfolioSchema = {
  fields: [
    field("1", "weight", {
      type: { kind: "number", min: 0, max: 300, unit: "kg" },
      description: "Body weight",
    }),
    field("2", "sizes", {
      type: {
        kind: "select",
        multiple: true,
        options: [
          { label: "Small", value: "s" },
          { label: "Large", value: "l" },
        ],
      },
    }),
    field("3", "satisfaction", { type: { kind: "scale", min: 1, max: 5, labels: { low: "Low", high: "High" } } }),
  ],
  groups: [{ id: "g", label: "G", fieldIds: ["1", "3"] }],
  version: 4,
};

describe("applySchemaPatch", () => {
  it("preserves type details when the coarse kind is unchanged", () => {
    const { schema: next } = applySchemaPatch(schema, {
      updateFields: [
        patchField("weight", { type: "number", label: "Weight" }),
        patchField("satisfaction", { type: "number", label: "Satisfaction" }),
      ],
    });
    expect(next.fields[0].type).toEqual({ kind: "number", min: 0, max: 300, unit: "kg" });
    expect(next.fields[0].label).toBe("Weight");
    expect(next.fields[2].type.kind).toBe("scale");
  });

  it("keeps descriptions the model omitted", () => {
    const { schema: next } = applySchemaPatch(schema, {
      updateFields: [patchField("weight", { type: "number" })],
    });
    expect(next.fields[0].description).toBe("Body weight");
  });

  it("keeps `multiple` and stored option values for surviving labels", () => {
    const { schema: next } = applySchemaPatch(schema, {
      updateFields: [
        patchField("sizes", {
          type: "select",
          validation: {
            options: [
              { label: "Small", value: "small" },
              { label: "Medium", value: "medium" },
            ],
          },
        }),
      ],
    });
    expect(next.fields[1].type).toEqual({
      kind: "select",
      multiple: true,
      options: [
        { label: "Small", value: "s" },
        { label: "Medium", value: "medium" },
      ],
    });
  });

  it("treats an add with an existing key as an update (no duplicate names)", () => {
    const { schema: next, applied } = applySchemaPatch(schema, {
      addFields: [patchField("weight", { type: "number", label: "Weight (kg)" })],
    });
    expect(next.fields.filter((f) => f.name === "weight")).toHaveLength(1);
    expect(applied.updated).toEqual(["weight"]);
    expect(applied.added).toEqual([]);
  });

  it("reports unknown keys as skipped and doesn't bump the version for no-ops", () => {
    const result = applySchemaPatch(schema, {
      updateFields: [patchField("ghost")],
      removeFieldKeys: ["phantom"],
    });
    expect(result.skipped).toEqual({ updated: ["ghost"], removed: ["phantom"] });
    expect(result.schema.version).toBe(4);
  });

  it("prunes removed fields from groups", () => {
    const { schema: next } = applySchemaPatch(schema, { removeFieldKeys: ["weight"] });
    expect(next.groups[0].fieldIds).toEqual(["3"]);
    expect(next.version).toBe(5);
  });
});

describe("mergeRegeneratedSchema", () => {
  const current: PortfolioSchema = {
    fields: [
      field("1", "weight", { type: { kind: "number", unit: "kg" } }),
      field("9", "coachNotes", { origin: "creator" }),
      field("8", "legacy"),
    ],
    groups: [],
    version: 7,
    acceptedStandards: [{ standardId: "fhir", standardName: "FHIR", domain: "health" }],
    columnActions: [],
  };
  const generated: PortfolioSchema = {
    fields: [field("new-1", "weight", { type: { kind: "number" }, label: "Weight" }), field("new-2", "goal")],
    groups: [],
    version: 1,
  };

  it("keeps ids, type details, creator fields and metadata", () => {
    const merged = mergeRegeneratedSchema(current, generated);
    const weight = merged.fields.find((f) => f.name === "weight")!;
    expect(weight.id).toBe("1");
    expect(weight.type).toEqual({ kind: "number", unit: "kg" });
    expect(weight.label).toBe("Weight");
    expect(merged.fields.map((f) => f.name)).toEqual(["weight", "goal", "coachNotes"]);
    expect(merged.acceptedStandards).toEqual(current.acceptedStandards);
    expect(merged.version).toBe(8);
  });
});
