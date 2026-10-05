import { describe, expect, it } from "vitest";
import {
  buildColumnPreview,
  buildRowWrite,
  chunk,
  mapWithConcurrency,
  parentFieldNameFor,
  projectParentData,
  type ResponseWithOrigin,
} from "@/lib/form-renderer/response-rows";
import type {
  DerivationSpec,
  Field,
  FieldType,
  FormResponse,
  Portfolio,
  PortfolioSchema,
} from "@/lib/types";

function field(id: string, name: string, type: FieldType = { kind: "text" }): Field {
  return {
    id,
    name,
    label: name,
    type,
    required: false,
    constraints: [],
    origin: "creator",
    tags: [],
  };
}

const parentFields = {
  name: field("f-name", "name"),
  email: field("f-email", "email"),
  notes: field("f-notes", "notes"),
};

// Derived: inherits name (same id), renames email → contact, adds score
const derivedSchema: PortfolioSchema = {
  fields: [
    parentFields.name,
    field("f-contact", "contact"),
    field("f-score", "score", { kind: "number" }),
  ],
  groups: [],
  version: 1,
};

const projection: DerivationSpec = {
  type: "mixed",
  scenarioIntent: "test",
  includedFieldIds: ["f-name", "f-email"],
  additionalFields: [],
  fieldMappings: { email: "contact" },
};

const derived = { base_id: "parent", projection } satisfies Pick<
  Portfolio,
  "base_id" | "projection"
>;
const base = { base_id: null, projection: null } satisfies Pick<
  Portfolio,
  "base_id" | "projection"
>;

function parentRow(id: string, raw: Record<string, unknown>): ResponseWithOrigin {
  return {
    id,
    portfolioId: "parent",
    submittedAt: "2024-01-01T00:00:00Z",
    data: projectParentData(raw, derivedSchema, projection),
    rawData: raw,
    sourcePortfolioId: "parent",
    origin: "parent",
  };
}

describe("projectParentData", () => {
  it("keeps shown fields, renames mapped ones, hides the rest", () => {
    expect(
      projectParentData(
        { name: "Ada", email: "a@x", notes: "secret" },
        derivedSchema,
        projection,
      ),
    ).toEqual({ name: "Ada", contact: "a@x" });
  });
});

describe("buildRowWrite", () => {
  it("writes parent rows under the parent's field name, keeping all other parent data", () => {
    const row = parentRow("r1", { name: "Ada", email: "a@x", notes: "keep me" });
    const write = buildRowWrite(row, derivedSchema.fields[1], "b@y", derived);
    expect(write).toEqual({
      id: "r1",
      portfolioId: "parent",
      data: { name: "Ada", email: "b@y", notes: "keep me" },
    });
  });

  it("skips parent rows for fields that only exist in the derived form", () => {
    const row = parentRow("r1", { name: "Ada" });
    expect(buildRowWrite(row, derivedSchema.fields[2], 5, derived)).toBeNull();
    expect(parentFieldNameFor(derived, derivedSchema.fields[2])).toBeNull();
  });

  it("writes own rows of derived portfolios to the derived portfolio", () => {
    const own: ResponseWithOrigin = {
      id: "r2",
      portfolioId: "child",
      submittedAt: "2024-01-01T00:00:00Z",
      data: { name: "Bo", score: 1 },
      rawData: { name: "Bo", score: 1 },
      sourcePortfolioId: "child",
      origin: "own",
    };
    expect(buildRowWrite(own, derivedSchema.fields[2], 7, derived)).toEqual({
      id: "r2",
      portfolioId: "child",
      data: { name: "Bo", score: 7 },
    });
  });

  it("removes the key when clearing a value on plain responses", () => {
    const row: FormResponse = {
      id: "r3",
      portfolioId: "p",
      submittedAt: "",
      data: { name: "Cy", other: 1 },
    };
    expect(buildRowWrite(row, parentFields.name, undefined, base)).toEqual({
      id: "r3",
      portfolioId: "p",
      data: { other: 1 },
    });
  });
});

describe("buildColumnPreview", () => {
  it("coerces, drops no-ops, reports invalid/missing/skipped rows", () => {
    const flag = field("f-flag", "flag", { kind: "boolean" });
    const rows: FormResponse[] = [
      { id: "a", portfolioId: "p", submittedAt: "", data: { flag: true } },
      { id: "b", portfolioId: "p", submittedAt: "", data: { flag: true } },
      { id: "c", portfolioId: "p", submittedAt: "", data: { flag: false } },
      { id: "d", portfolioId: "p", submittedAt: "", data: {} },
    ];
    const preview = buildColumnPreview({
      field: flag,
      portfolio: base,
      rows,
      results: { a: "false", b: "true", c: "perhaps" },
    });
    expect(preview.total).toBe(4);
    expect(preview.changes).toHaveLength(1);
    expect(preview.changes[0].newValue).toBe(false);
    expect(preview.changes[0].write.data).toEqual({ flag: false });
    expect(preview.changes[0].revert.data).toEqual({ flag: true });
    expect(preview.unchanged).toBe(1);
    expect(preview.invalid).toEqual([
      { position: 3, raw: "perhaps", reason: "not yes/no" },
    ]);
    expect(preview.missing).toBe(1);
  });

  it("counts parent rows it can't write", () => {
    const rows = [parentRow("p1", { name: "Ada" })];
    const preview = buildColumnPreview({
      field: derivedSchema.fields[2],
      portfolio: derived,
      rows,
      results: { p1: "3" },
    });
    expect(preview.skippedParent).toBe(1);
    expect(preview.changes).toHaveLength(0);
  });
});

describe("chunk / mapWithConcurrency", () => {
  it("splits and runs with bounded concurrency in order", async () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});
