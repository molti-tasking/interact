import { describe, expect, it } from "vitest";
import {
  removeField,
  schemaToZod,
  validateDataAgainstSchema,
} from "@/lib/engine/schema-ops";
import type { StoredFile } from "@/lib/form-renderer/values";
import {
  emptyPortfolioSchema,
  type Field,
  type FieldType,
  type PortfolioSchema,
} from "@/lib/types";

function field(
  name: string,
  type: FieldType,
  required = false,
  extra: Partial<Field> = {},
): Field {
  return {
    id: `id-${name}`,
    name,
    label: name[0].toUpperCase() + name.slice(1),
    type,
    required,
    constraints: [],
    origin: "creator",
    tags: [],
    ...extra,
  };
}

function schemaOf(...fields: Field[]): PortfolioSchema {
  return { ...emptyPortfolioSchema(), fields };
}

function parse(schema: PortfolioSchema, data: Record<string, unknown>) {
  return schemaToZod(schema).safeParse(data);
}

function errorsOf(schema: PortfolioSchema, data: Record<string, unknown>) {
  return validateDataAgainstSchema(data, schema).errors;
}

describe("schemaToZod — text", () => {
  it("rejects blank required text with a 'required' message", () => {
    const s = schemaOf(field("name", { kind: "text" }, true));
    expect(errorsOf(s, { name: "" })).toEqual({ name: "Name is required" });
    expect(errorsOf(s, { name: "   " })).toEqual({ name: "Name is required" });
    expect(errorsOf(s, {})).toEqual({ name: "Name is required" });
  });

  it("trims and accepts filled text; optional text may be cleared", () => {
    const s = schemaOf(
      field("name", { kind: "text" }, true),
      field("note", { kind: "text" }),
    );
    const r = parse(s, { name: "  Ada ", note: "" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ name: "Ada", note: undefined });
  });

  it("applies maxLength and regex constraints, skipping invalid patterns", () => {
    const s = schemaOf(
      field("code", { kind: "text", maxLength: 4 }, false, {
        constraints: [
          { type: "regex", rule: "^[A-Z]+$", message: "Uppercase only" },
          { type: "regex", rule: "([unclosed", message: "never" },
        ],
      }),
    );
    expect(parse(s, { code: "ABC" }).success).toBe(true);
    expect(errorsOf(s, { code: "abc" })).toEqual({ code: "Uppercase only" });
    expect(errorsOf(s, { code: "ABCDE" }).code).toMatch(/at most 4/);
    // Optional + empty: regex doesn't apply
    expect(parse(s, { code: "" }).success).toBe(true);
  });
});

describe("schemaToZod — number & scale", () => {
  const s = schemaOf(
    field("age", { kind: "number", min: 0, max: 120 }),
    field("count", { kind: "number" }, true),
  );

  it("treats a cleared optional number as unanswered, not 0", () => {
    const r = parse(s, { age: "", count: "3" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ age: undefined, count: 3 });
  });

  it("coerces numeric strings and enforces min/max when present", () => {
    expect(parse(s, { age: "42", count: 1 }).data).toEqual({ age: 42, count: 1 });
    expect(errorsOf(s, { age: "-1", count: 1 }).age).toMatch(/at least 0/);
    expect(errorsOf(s, { age: "200", count: 1 }).age).toMatch(/at most 120/);
    expect(errorsOf(s, { age: "abc", count: 1 }).age).toMatch(/must be a number/);
  });

  it("requires required numbers", () => {
    expect(errorsOf(s, { count: "" })).toEqual({ count: "Count is required" });
    expect(errorsOf(s, { count: null })).toEqual({ count: "Count is required" });
  });

  it("validates scales and requires an answer when required", () => {
    const sc = schemaOf(field("rating", { kind: "scale", min: 1, max: 5 }, true));
    expect(parse(sc, { rating: "4" }).data).toEqual({ rating: 4 });
    expect(errorsOf(sc, {})).toEqual({ rating: "Rating is required" });
    expect(errorsOf(sc, { rating: 9 }).rating).toMatch(/at most 5/);
  });
});

describe("schemaToZod — date", () => {
  it("lets optional dates be cleared without a 'required' error", () => {
    const s = schemaOf(field("start", { kind: "date" }));
    expect(parse(s, { start: "" }).success).toBe(true);
    expect(parse(s, {}).success).toBe(true);
  });

  it("requires required dates and checks validity and range", () => {
    const s = schemaOf(
      field(
        "start",
        { kind: "date", range: { min: "2024-01-01", max: "2024-12-31" } },
        true,
      ),
    );
    expect(errorsOf(s, { start: "" })).toEqual({ start: "Start is required" });
    expect(parse(s, { start: "2024-05-01" }).success).toBe(true);
    expect(errorsOf(s, { start: "nope" }).start).toMatch(/valid date/);
    expect(errorsOf(s, { start: "2025-01-01" }).start).toMatch(/on or before/);
  });
});

describe("schemaToZod — boolean", () => {
  it("accepts an unticked required checkbox as 'no'", () => {
    const s = schemaOf(field("consent", { kind: "boolean" }, true));
    expect(parse(s, {}).data).toEqual({ consent: false });
    expect(parse(s, { consent: false }).data).toEqual({ consent: false });
    expect(parse(s, { consent: true }).data).toEqual({ consent: true });
  });

  it("leaves optional booleans unanswered", () => {
    const s = schemaOf(field("subscribe", { kind: "boolean" }));
    expect(parse(s, {}).success).toBe(true);
    expect(parse(s, { subscribe: "true" }).data).toEqual({ subscribe: true });
  });
});

describe("schemaToZod — select", () => {
  const options = [
    { label: "Red", value: "red" },
    { label: "Blue", value: "blue" },
  ];

  it("requires a choice for required single selects", () => {
    const s = schemaOf(field("color", { kind: "select", options, multiple: false }, true));
    expect(errorsOf(s, { color: "" })).toEqual({ color: "Color is required" });
    expect(parse(s, { color: "red" }).success).toBe(true);
    expect(errorsOf(s, { color: "green" }).color).toMatch(/Choose one/);
  });

  it("requires at least one option for required multi-selects", () => {
    const s = schemaOf(field("colors", { kind: "select", options, multiple: true }, true));
    expect(errorsOf(s, { colors: [] }).colors).toMatch(/at least one/);
    expect(errorsOf(s, {}).colors).toMatch(/at least one/);
    expect(parse(s, { colors: ["red", "blue"] }).success).toBe(true);
  });

  it("allows an empty optional multi-select", () => {
    const s = schemaOf(field("colors", { kind: "select", options, multiple: true }));
    expect(parse(s, { colors: [] }).success).toBe(true);
    expect(parse(s, {}).success).toBe(true);
  });
});

describe("schemaToZod — file", () => {
  const stored: StoredFile = {
    path: "p/1-cv.pdf",
    name: "cv.pdf",
    size: 2048,
    type: "application/pdf",
    url: "https://example.test/cv.pdf",
  };

  it("enforces required files and accepts File or stored references", () => {
    const s = schemaOf(field("cv", { kind: "file", accept: [".pdf"] }, true));
    expect(errorsOf(s, {})).toEqual({ cv: "Cv is required" });
    expect(errorsOf(s, { cv: null })).toEqual({ cv: "Cv is required" });
    expect(parse(s, { cv: stored }).success).toBe(true);
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    expect(parse(s, { cv: file }).success).toBe(true);
  });

  it("enforces accept and maxSize", () => {
    const s = schemaOf(
      field("photo", { kind: "file", accept: ["image/*"], maxSize: 1 }),
    );
    const txt = new File(["hi"], "notes.txt", { type: "text/plain" });
    expect(errorsOf(s, { photo: txt }).photo).toMatch(/must be one of/);
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "big.png", {
      type: "image/png",
    });
    expect(errorsOf(s, { photo: big }).photo).toMatch(/at most 1\.0 MB/);
    const ok = new File(["x"], "ok.png", { type: "image/png" });
    expect(parse(s, { photo: ok }).success).toBe(true);
    expect(errorsOf(s, { photo: { foo: 1 } }).photo).toMatch(/must be a file/);
  });
});

describe("schemaToZod — group", () => {
  const group = field(
    "address",
    {
      kind: "group",
      fields: [
        field("street", { kind: "text" }, true),
        field("zip", { kind: "number" }),
      ],
    },
    true,
  );

  it("keeps nested values (no stripping) and coerces them", () => {
    const r = parse(schemaOf(group), {
      address: { street: "Main St", zip: "8000" },
    });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ address: { street: "Main St", zip: 8000 } });
  });

  it("reports required nested fields at their own path", () => {
    expect(errorsOf(schemaOf(group), {})).toEqual({
      "address.street": "Street is required",
    });
  });

  it("skips an untouched optional group", () => {
    const optional = { ...group, required: false };
    expect(parse(schemaOf(optional), {}).success).toBe(true);
    expect(parse(schemaOf(optional), { address: { street: "" } }).success).toBe(
      true,
    );
    expect(
      errorsOf(schemaOf(optional), { address: { zip: "1" } })["address.street"],
    ).toBe("Street is required");
  });
});

describe("schemaToZod — reference", () => {
  it("accepts a link or a plain label and requires one when required", () => {
    const s = schemaOf(
      field("team", { kind: "reference", targetPortfolioId: "t" }, true),
    );
    expect(parse(s, { team: { responseId: "r1", label: "A" } }).success).toBe(
      true,
    );
    expect(parse(s, { team: "Tigers" }).success).toBe(true);
    expect(errorsOf(s, { team: "" })).toEqual({ team: "Team is required" });
  });
});

describe("removeField", () => {
  const nested = field("street", { kind: "text" });
  const schema: PortfolioSchema = {
    fields: [
      field("toggle", { kind: "boolean" }),
      field("address", { kind: "group", fields: [nested, field("zip", { kind: "text" })] }),
    ],
    groups: [
      { id: "g1", label: "Only toggle", fieldIds: ["id-toggle"] },
      {
        id: "g2",
        label: "Conditional",
        fieldIds: ["id-address"],
        conditional: { fieldId: "id-toggle", value: true },
      },
      { id: "g3", label: "Already empty", fieldIds: [] },
    ],
    version: 3,
  };

  it("removes nested group fields", () => {
    const next = removeField(schema, "id-street");
    const address = next.fields.find((f) => f.name === "address")!;
    expect(address.type.kind === "group" && address.type.fields.map((f) => f.name)).toEqual(["zip"]);
    expect(next.version).toBe(4);
  });

  it("clears conditionals and drops groups emptied by the removal", () => {
    const next = removeField(schema, "id-toggle");
    expect(next.fields.map((f) => f.name)).toEqual(["address"]);
    expect(next.groups.map((g) => g.id)).toEqual(["g2", "g3"]);
    expect(next.groups[0].conditional).toBeUndefined();
  });
});
