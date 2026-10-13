import { planRecode, planRecodeUndo } from "@/lib/engine/recode";
import type { ResponseWithOrigin } from "@/lib/form-renderer/response-rows";
import type { Field, FormResponse, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

const level: Field = {
  id: "f-level",
  name: "level",
  label: "Level",
  type: {
    kind: "select",
    multiple: false,
    options: [
      { label: "Beginner", value: "beginner" },
      { label: "Novice", value: "novice" },
      { label: "Expert", value: "expert" },
    ],
  },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
};
const tags: Field = {
  ...level,
  id: "f-tags",
  name: "tags",
  label: "Tags",
  type: { ...(level.type as Extract<Field["type"], { kind: "select" }>), multiple: true },
};
const age: Field = { ...level, id: "f-age", name: "age", label: "Age", type: { kind: "number", min: 0, max: 120 } };
const schema: PortfolioSchema = { fields: [level, tags, age], groups: [], version: 3 };
const portfolio = { base_id: null, projection: null };

const own = (id: string, data: Record<string, unknown>): FormResponse => ({
  id,
  portfolioId: "p1",
  data,
  submittedAt: "2026-10-01T00:00:00Z",
});

const rows = [
  own("r1", { level: "novice", tags: ["novice", "beginner"], age: 30 }),
  own("r2", { level: "beginner", age: 250 }),
  own("r3", { level: "expert", age: 41, other: "kept" }),
];

describe("planRecode", () => {
  it("merges options in answers (multi-selects deduplicated) and drops them from the form", () => {
    const plan = planRecode(
      { kind: "mergeOptions", fieldId: "f-level", from: ["novice"], into: "beginner" },
      { schema, portfolio, rows },
    )!;
    expect(plan.changes.map((c) => [c.row.id, c.newValue])).toEqual([["r1", "beginner"]]);
    expect(plan.order).toBe("rows-first");

    const tagsPlan = planRecode(
      { kind: "mergeOptions", fieldId: "f-tags", from: ["novice"], into: "beginner" },
      { schema, portfolio, rows },
    )!;
    expect(tagsPlan.changes[0].newValue).toEqual(["beginner"]);

    // Replayed on a form that gained an option meanwhile: that option stays
    const later = {
      ...schema,
      fields: schema.fields.map((f) =>
        f.id === "f-level" && f.type.kind === "select"
          ? { ...f, type: { ...f.type, options: [...f.type.options, { label: "Pro", value: "pro" }] } }
          : f,
      ),
    };
    const merged = plan.schemaChange!(later);
    const options = (merged.fields[0].type as { options: { value: string }[] }).options;
    expect(options.map((o) => o.value)).toEqual(["beginner", "expert", "pro"]);
    expect(merged.version).toBe(4);
    // ...and the inverse puts "novice" back where it was
    const restored = plan.inverseSchemaChange!(merged);
    expect((restored.fields[0].type as { options: { value: string }[] }).options.map((o) => o.value)).toEqual([
      "beginner",
      "novice",
      "expert",
      "pro",
    ]);
  });

  it("renames an option label without touching answers", () => {
    const plan = planRecode(
      { kind: "renameOption", fieldId: "f-level", value: "novice", label: "Newcomer" },
      { schema, portfolio, rows },
    )!;
    expect(plan.changes).toEqual([]);
    const renamed = plan.schemaChange!(schema).fields[0].type as { options: { label: string; value: string }[] };
    expect(renamed.options[1]).toEqual({ label: "Newcomer", value: "novice" });
  });

  it("maps or clears values the form doesn't offer, and adds them as options", () => {
    const stray = [own("s1", { level: "pro" }), own("s2", { level: "PRO" })];
    const mapped = planRecode(
      { kind: "mapValues", fieldId: "f-level", map: { pro: "expert", PRO: null } },
      { schema, portfolio, rows: stray },
    )!;
    expect(mapped.changes.map((c) => c.newValue)).toEqual(["expert", undefined]);
    expect(mapped.changes[1].write.data).toEqual({});
    expect(mapped.schemaChange).toBeNull();

    const added = planRecode(
      { kind: "addAsOptions", fieldId: "f-level", values: ["pro", "beginner"] },
      { schema, portfolio, rows: stray },
    )!;
    expect(added.order).toBe("schema-first");
    const options = (added.schemaChange!(schema).fields[0].type as { options: { value: string }[] }).options;
    expect(options.map((o) => o.value)).toEqual(["beginner", "novice", "expert", "pro"]);
  });

  it("fixes numbers and sets a range, clearing answers outside it", () => {
    const fixed = planRecode(
      { kind: "setValues", fieldId: "f-age", values: { r2: 25 } },
      { schema, portfolio, rows },
    )!;
    expect(fixed.changes.map((c) => [c.row.id, c.oldValue, c.newValue])).toEqual([["r2", 250, 25]]);
    expect(fixed.summary).toBe('In "Age": corrected 1 answer');

    const ranged = planRecode(
      { kind: "setRange", fieldId: "f-age", min: 18, max: 99, clearOutside: true },
      { schema, portfolio, rows },
    )!;
    expect(ranged.changes.map((c) => c.row.id)).toEqual(["r2"]);
    expect(ranged.schemaChange!(schema).fields[2].type).toEqual({ kind: "number", min: 18, max: 99 });
    expect(ranged.inverseSchemaChange!(ranged.schemaChange!(schema)).fields[2].type).toEqual({
      kind: "number",
      min: 0,
      max: 120,
    });
  });

  it("leaves parent rows of a derived form alone", () => {
    const parentRow: ResponseWithOrigin = {
      ...own("p1", { level: "novice" }),
      origin: "parent",
      rawData: { level: "novice" },
      sourcePortfolioId: "base",
    };
    const plan = planRecode(
      { kind: "mergeOptions", fieldId: "f-level", from: ["novice"], into: "beginner" },
      { schema, portfolio: { base_id: "base", projection: null }, rows: [parentRow] },
    )!;
    expect(plan.changes).toEqual([]);
    expect(plan.skippedParent).toBe(1);
  });

  it("returns null for ops that don't apply", () => {
    expect(planRecode({ kind: "renameOption", fieldId: "f-level", value: "gone", label: "X" }, { schema, portfolio, rows })).toBeNull();
    expect(planRecode({ kind: "setRange", fieldId: "f-level", min: 1, clearOutside: false }, { schema, portfolio, rows })).toBeNull();
    expect(planRecode({ kind: "mergeOptions", fieldId: "nope", from: ["a"], into: "b" }, { schema, portfolio, rows })).toBeNull();
  });
});

describe("planRecodeUndo", () => {
  it("restores only answers that still hold what the recode wrote", () => {
    const plan = planRecode(
      { kind: "setValues", fieldId: "f-age", values: { r1: 31, r2: 25 } },
      { schema, portfolio, rows },
    )!;
    const now = [own("r1", { level: "novice", age: 31 }), own("r2", { level: "beginner", age: 26 })];
    const writes = planRecodeUndo(plan, now, portfolio);
    expect(writes).toEqual([{ id: "r1", portfolioId: "p1", data: { level: "novice", age: 30 } }]);
  });
});
