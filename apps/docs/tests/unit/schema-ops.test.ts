import { describe, it, expect } from "vitest";
import {
  addField,
  removeField,
  updateField,
  reorderFields,
  diffSchemas,
  isDiffEmpty,
  mergeSchemas,
  applyDiff,
  schemaToZod,
  validateDataAgainstSchema,
  toSlug,
  findField,
  getAllFieldIds,
} from "@/lib/engine/schema-ops";
import type { Field, PortfolioSchema } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<Field> & { id: string }): Field {
  return {
    name: overrides.id,
    label: overrides.id,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "creator",
    tags: [],
    ...overrides,
  };
}

function makeSchema(
  fields: Field[],
  version = 1,
): PortfolioSchema {
  return { fields, groups: [], version };
}

const fieldA = makeField({ id: "a", label: "Field A" });
const fieldB = makeField({ id: "b", label: "Field B" });
const fieldC = makeField({ id: "c", label: "Field C" });

// ---------------------------------------------------------------------------
// addField
// ---------------------------------------------------------------------------

describe("addField", () => {
  it("appends a field to the end by default", () => {
    const schema = makeSchema([fieldA]);
    const result = addField(schema, fieldB);
    expect(result.fields).toHaveLength(2);
    expect(result.fields[1].id).toBe("b");
    expect(result.version).toBe(2);
  });

  it("inserts a field at a specific index", () => {
    const schema = makeSchema([fieldA, fieldC]);
    const result = addField(schema, fieldB, 1);
    expect(result.fields.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the original schema", () => {
    const schema = makeSchema([fieldA]);
    addField(schema, fieldB);
    expect(schema.fields).toHaveLength(1);
    expect(schema.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// removeField
// ---------------------------------------------------------------------------

describe("removeField", () => {
  it("removes a field by ID", () => {
    const schema = makeSchema([fieldA, fieldB]);
    const result = removeField(schema, "a");
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].id).toBe("b");
    expect(result.version).toBe(2);
  });

  it("also removes the field from groups", () => {
    const schema: PortfolioSchema = {
      fields: [fieldA, fieldB],
      groups: [{ id: "g1", label: "Group 1", fieldIds: ["a", "b"] }],
      version: 1,
    };
    const result = removeField(schema, "a");
    expect(result.groups[0].fieldIds).toEqual(["b"]);
  });

  it("returns unchanged schema if field ID not found", () => {
    const schema = makeSchema([fieldA]);
    const result = removeField(schema, "nonexistent");
    expect(result.fields).toHaveLength(1);
    expect(result.version).toBe(2); // version still increments
  });
});

// ---------------------------------------------------------------------------
// updateField
// ---------------------------------------------------------------------------

describe("updateField", () => {
  it("updates a field with a partial patch", () => {
    const schema = makeSchema([fieldA, fieldB]);
    const result = updateField(schema, "a", { label: "Updated A", required: true });
    expect(result.fields[0].label).toBe("Updated A");
    expect(result.fields[0].required).toBe(true);
    expect(result.fields[1].label).toBe("Field B"); // unchanged
  });

  it("increments version", () => {
    const schema = makeSchema([fieldA]);
    const result = updateField(schema, "a", { label: "X" });
    expect(result.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// reorderFields
// ---------------------------------------------------------------------------

describe("reorderFields", () => {
  it("reorders fields according to the given ID list", () => {
    const schema = makeSchema([fieldA, fieldB, fieldC]);
    const result = reorderFields(schema, ["c", "a", "b"]);
    expect(result.fields.map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("appends fields not in the ordered list", () => {
    const schema = makeSchema([fieldA, fieldB, fieldC]);
    const result = reorderFields(schema, ["b"]);
    expect(result.fields.map((f) => f.id)).toEqual(["b", "a", "c"]);
  });
});

// ---------------------------------------------------------------------------
// diffSchemas
// ---------------------------------------------------------------------------

describe("diffSchemas", () => {
  it("detects added fields", () => {
    const old = makeSchema([fieldA]);
    const newS = makeSchema([fieldA, fieldB]);
    const diff = diffSchemas(old, newS);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe("b");
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it("detects removed fields", () => {
    const old = makeSchema([fieldA, fieldB]);
    const newS = makeSchema([fieldA]);
    const diff = diffSchemas(old, newS);
    expect(diff.removed).toEqual(["b"]);
    expect(diff.added).toHaveLength(0);
  });

  it("detects modified fields", () => {
    const old = makeSchema([fieldA]);
    const modified = makeField({ id: "a", label: "Changed A" });
    const newS = makeSchema([modified]);
    const diff = diffSchemas(old, newS);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0].fieldId).toBe("a");
    expect(diff.modified[0].after.label).toBe("Changed A");
  });

  it("returns empty diff for identical schemas", () => {
    const schema = makeSchema([fieldA]);
    const diff = diffSchemas(schema, schema);
    expect(isDiffEmpty(diff)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDiffEmpty
// ---------------------------------------------------------------------------

describe("isDiffEmpty", () => {
  it("returns true for empty diff", () => {
    expect(isDiffEmpty({ added: [], removed: [], modified: [] })).toBe(true);
  });

  it("returns false when there are additions", () => {
    expect(isDiffEmpty({ added: [fieldA], removed: [], modified: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeSchemas
// ---------------------------------------------------------------------------

describe("mergeSchemas", () => {
  it("merges source fields into target, overwriting by ID", () => {
    const target = makeSchema([fieldA, fieldB]);
    const updatedA = makeField({ id: "a", label: "Source A" });
    const source = makeSchema([updatedA, fieldC]);
    const result = mergeSchemas(target, source);
    expect(result.fields.find((f) => f.id === "a")?.label).toBe("Source A");
    expect(result.fields.find((f) => f.id === "c")).toBeDefined();
  });

  it("version is max + 1", () => {
    const target = makeSchema([fieldA], 3);
    const source = makeSchema([fieldB], 5);
    const result = mergeSchemas(target, source);
    expect(result.version).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// applyDiff
// ---------------------------------------------------------------------------

describe("applyDiff", () => {
  it("applies additions, removals, and modifications", () => {
    const schema = makeSchema([fieldA, fieldB]);
    const diff = {
      added: [fieldC],
      removed: ["b"],
      modified: [{ fieldId: "a", before: fieldA, after: { ...fieldA, label: "Mod A" } }],
    };
    const result = applyDiff(schema, diff);
    expect(result.fields.map((f) => f.id)).toEqual(["a", "c"]);
    expect(result.fields[0].label).toBe("Mod A");
  });
});

// ---------------------------------------------------------------------------
// schemaToZod / validateDataAgainstSchema
// ---------------------------------------------------------------------------

describe("validateDataAgainstSchema", () => {
  it("validates valid data", () => {
    const schema = makeSchema([
      makeField({ id: "name", name: "name", required: true }),
    ]);
    const result = validateDataAgainstSchema({ name: "Alice" }, schema);
    expect(result.valid).toBe(true);
  });

  it("reports errors for invalid number fields", () => {
    const schema = makeSchema([
      makeField({
        id: "age",
        name: "age",
        label: "Age",
        type: { kind: "number", min: 0, max: 150 },
        required: true,
      }),
    ]);
    const result = validateDataAgainstSchema({ age: -5 }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.age).toBeDefined();
  });

  it("allows optional fields to be missing", () => {
    const schema = makeSchema([
      makeField({ id: "notes", name: "notes", required: false }),
    ]);
    const result = validateDataAgainstSchema({}, schema);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toSlug
// ---------------------------------------------------------------------------

describe("toSlug", () => {
  it("converts text to URL-safe slug", () => {
    expect(toSlug("Hello World")).toBe("hello-world");
    expect(toSlug("  Multiple   Spaces  ")).toBe("multiple-spaces");
    expect(toSlug("Special!@#Characters")).toBe("specialcharacters");
  });
});

// ---------------------------------------------------------------------------
// findField
// ---------------------------------------------------------------------------

describe("findField", () => {
  it("finds a top-level field", () => {
    const schema = makeSchema([fieldA, fieldB]);
    expect(findField(schema, "a")?.label).toBe("Field A");
  });

  it("finds a nested group field", () => {
    const groupField = makeField({
      id: "group1",
      type: { kind: "group", fields: [fieldA] },
    });
    const schema = makeSchema([groupField]);
    expect(findField(schema, "a")?.label).toBe("Field A");
  });

  it("returns undefined for nonexistent field", () => {
    const schema = makeSchema([fieldA]);
    expect(findField(schema, "nonexistent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAllFieldIds
// ---------------------------------------------------------------------------

describe("getAllFieldIds", () => {
  it("returns flat and nested IDs", () => {
    const groupField = makeField({
      id: "group1",
      type: { kind: "group", fields: [fieldB] },
    });
    const schema = makeSchema([fieldA, groupField]);
    expect(getAllFieldIds(schema)).toEqual(["a", "group1", "b"]);
  });
});
