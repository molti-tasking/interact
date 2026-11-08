import { describe, expect, it } from "vitest";
import {
  applyConflictFix,
  applyProbeOption,
  describeFieldChange,
  describeSchemaChange,
  patchScope,
  protectLockedFields,
  scopePatch,
} from "@/lib/engine/guards";
import { applySchemaPatch } from "@/lib/engine/schema-patch";
import type { Field, PortfolioSchema } from "@/lib/types";

function field(partial: Partial<Field> & Pick<Field, "id" | "name">): Field {
  return {
    label: partial.name,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...partial,
  };
}

const base: PortfolioSchema = {
  fields: [
    field({ id: "f-name", name: "name", label: "Name", locked: true }),
    field({ id: "f-age", name: "age", label: "Age", type: { kind: "number" } }),
    field({ id: "f-notes", name: "notes", label: "Notes" }),
  ],
  groups: [{ id: "g-you", label: "About you", fieldIds: ["f-name", "f-age"] }],
  version: 1,
};

describe("locked fields", () => {
  it("applySchemaPatch skips updates, removals and section moves of locked fields", () => {
    const { schema, applied, skipped } = applySchemaPatch(base, {
      updateFields: [{ key: "name", label: "Full name", type: "string", required: true }],
      removeFieldKeys: ["name", "notes"],
      addFields: [{ key: "name", label: "Your name", type: "string", required: false }],
      sections: [{ title: "Other", fieldKeys: ["name"] }],
    });
    expect(schema.fields.find((f) => f.id === "f-name")).toEqual(base.fields[0]);
    expect(applied.removed).toEqual(["notes"]);
    expect(applied.updated).toEqual([]);
    expect(skipped.locked).toEqual(["name"]);
    expect(schema.groups[0].fieldIds).toContain("f-name");
  });

  it("protectLockedFields restores changed and removed locked fields in place", () => {
    const after: PortfolioSchema = {
      ...base,
      fields: [
        field({ id: "f-age", name: "age", label: "Age (years)", type: { kind: "number" } }),
        field({ id: "f-notes", name: "notes", label: "Notes" }),
      ],
      groups: [{ id: "g-you", label: "About you", fieldIds: ["f-age"] }],
      version: 2,
    };
    const { schema, restored } = protectLockedFields(base, after);
    // Loose fields first, then each section (the sections invariant)
    expect(schema.fields.map((f) => f.id)).toEqual(["f-notes", "f-name", "f-age"]);
    expect(schema.fields[1]).toEqual(base.fields[0]);
    expect(schema.fields[2].label).toBe("Age (years)"); // unlocked change kept
    expect([...schema.groups[0].fieldIds].sort()).toEqual(["f-age", "f-name"]);
    expect(restored).toEqual(["Name"]);
  });

  it("drops a new field that reuses a locked key", () => {
    const after: PortfolioSchema = {
      ...base,
      fields: [...base.fields.slice(1), field({ id: "f-new", name: "name", label: "Name 2" })],
    };
    const { schema } = protectLockedFields(base, after);
    expect(schema.fields.filter((f) => f.name === "name").map((f) => f.id)).toEqual(["f-name"]);
  });

  it("renames an existing field back instead of dropping it when it takes a locked key", () => {
    const before: PortfolioSchema = {
      fields: [
        field({ id: "f-age", name: "age", label: "Age", locked: true }),
        field({ id: "f-email", name: "email", label: "Email" }),
      ],
      groups: [],
      version: 1,
    };
    const after: PortfolioSchema = {
      ...before,
      fields: [
        { ...before.fields[0], name: "ageOld" },
        { ...before.fields[1], name: "age", label: "Age 2" },
      ],
    };
    const { schema } = protectLockedFields(before, after);
    expect(schema.fields.map((f) => [f.id, f.name])).toEqual([
      ["f-age", "age"],
      ["f-email", "email"],
    ]);
  });

  it("re-creates a removed section for a locked field and undoes reorders", () => {
    const before: PortfolioSchema = {
      fields: [
        field({ id: "a", name: "a" }),
        field({ id: "b", name: "b", locked: true }),
        field({ id: "c", name: "c" }),
      ],
      groups: [{ id: "s", label: "Mine", fieldIds: ["b"] }],
      version: 1,
    };
    const after: PortfolioSchema = {
      ...before,
      fields: [before.fields[2], before.fields[1], before.fields[0]],
      groups: [],
    };
    const { schema, restored } = protectLockedFields(before, after);
    expect(schema.groups).toEqual([{ id: "s", label: "Mine", fieldIds: ["b"] }]);
    expect(schema.fields.map((f) => f.id)).toEqual(["c", "a", "b"]);
    expect(restored).toEqual(["b"]);
  });

  it("is a no-op without locked fields", () => {
    const unlocked = { ...base, fields: base.fields.map((f) => ({ ...f, locked: false })) };
    const after = { ...unlocked, fields: unlocked.fields.slice(1) };
    expect(protectLockedFields(unlocked, after)).toEqual({ schema: after, restored: [] });
  });
});

describe("patch scoping", () => {
  const unlocked: PortfolioSchema = {
    ...base,
    fields: base.fields.map((f) => ({ ...f, locked: undefined })),
  };

  it("records the keys a patch touches", () => {
    expect(
      patchScope(unlocked, {
        addFields: [{ key: "goal", label: "Goal", type: "string", required: false }],
        updateFields: [{ key: "age", label: "Age (years)", type: "number", required: true }],
        removeFieldKeys: ["notes"],
      }),
    ).toEqual({ added: ["goal"], updated: ["age"], removed: ["notes"] });
  });

  it("an add that would now overwrite a field created meanwhile is dropped", () => {
    const preview = {
      schemaPatch: {
        addFields: [{ key: "email", label: "Email", type: "string" as const, required: true }],
      },
      scope: { added: ["email"], updated: [], removed: [] },
    };
    // The creator added their own "email" field after the preview was computed
    const later: PortfolioSchema = {
      ...unlocked,
      fields: [
        ...unlocked.fields,
        field({ id: "f-mine", name: "email", label: "Work email", origin: "creator" }),
      ],
    };
    const result = applyProbeOption(later, preview);
    expect(result.changed).toBe(false);
    expect(result.dropped).toEqual(["email"]);
    expect(result.schema.fields.find((f) => f.id === "f-mine")!.label).toBe("Work email");
  });

  it("a change to a field deleted meanwhile does not bring it back", () => {
    const preview = {
      schemaPatch: {
        addFields: [{ key: "notes", label: "Notes", type: "string" as const, required: true }],
      },
      scope: patchScope(unlocked, {
        addFields: [{ key: "notes", label: "Notes", type: "string", required: true }],
      }),
    };
    expect(preview.scope.updated).toEqual(["notes"]);
    const later = { ...unlocked, fields: unlocked.fields.filter((f) => f.name !== "notes") };
    const result = applyProbeOption(later, preview);
    expect(result.changed).toBe(false);
    expect(result.schema.fields.some((f) => f.name === "notes")).toBe(false);
  });

  it("keeps everything inside the scope", () => {
    const patch = {
      addFields: [{ key: "goal", label: "Goal", type: "string" as const, required: false }],
      updateFields: [{ key: "age", label: "Age (years)", type: "number" as const, required: true }],
      removeFieldKeys: ["notes"],
      sections: [{ title: "About you", fieldKeys: ["goal", "notes"] }],
    };
    const scope = patchScope(unlocked, patch);
    const { patch: scoped, dropped } = scopePatch(unlocked, patch, scope);
    expect(dropped).toEqual([]);
    expect(scoped.addFields).toHaveLength(1);
    expect(scoped.updateFields).toHaveLength(1);
    expect(scoped.removeFieldKeys).toEqual(["notes"]);
  });

  it("a placement for an added key doesn't move a field of that key created meanwhile", () => {
    const preview = {
      schemaPatch: {
        addFields: [{ key: "email", label: "Email", type: "string" as const, required: false }],
        sections: [{ title: "About you", fieldKeys: ["email"] }],
      },
      scope: { added: ["email"], updated: [], removed: [] },
    };
    const later: PortfolioSchema = {
      ...unlocked,
      fields: [field({ id: "f-mine", name: "email", label: "Work email" }), ...unlocked.fields],
    };
    const result = applyProbeOption(later, preview);
    expect(result.changed).toBe(false);
    expect(result.schema.groups[0].fieldIds).not.toContain("f-mine");
  });

  it("previews without a scope apply as before", () => {
    const result = applyProbeOption(unlocked, {
      schemaPatch: { removeFieldKeys: ["notes"] },
    });
    expect(result.changed).toBe(true);
    expect(result.dropped).toEqual([]);
  });

  it("never touches locked fields, even in scope", () => {
    const result = applyProbeOption(base, {
      schemaPatch: { removeFieldKeys: ["name"] },
      scope: { added: [], updated: [], removed: ["name"] },
    });
    expect(result.changed).toBe(false);
    expect(result.locked).toEqual(["name"]);
  });
});

describe("applyConflictFix", () => {
  it("doesn't remove a section holding fields outside the conflict", () => {
    const result = applyConflictFix(base, { removeGroupIds: ["g-you"] }, ["f-age"]);
    expect(result.changed).toBe(false);
    expect(result.schema.groups).toHaveLength(1);
  });

  it("only changes the conflict's own unlocked fields", () => {
    const result = applyConflictFix(
      base,
      {
        updateFields: [
          { id: "f-age", required: true },
          { id: "f-notes", label: "Comments" },
          { id: "f-name", label: "Full name" },
        ],
      },
      ["f-age", "f-name"],
    );
    expect(result.changed).toBe(true);
    const byId = new Map(result.schema.fields.map((f) => [f.id, f]));
    expect(byId.get("f-age")!.required).toBe(true);
    expect(byId.get("f-notes")!.label).toBe("Notes");
    expect(byId.get("f-name")!.label).toBe("Name");
    expect(result.dropped).toEqual(["notes"]);
    expect(result.locked).toEqual(["name"]);
  });
});

describe("describeFieldChange", () => {
  it("names type, option, requiredness and label changes", () => {
    const before = field({
      id: "a",
      name: "level",
      label: "Level",
      type: {
        kind: "select",
        multiple: false,
        options: [
          { label: "Low", value: "low" },
          { label: "High", value: "high" },
        ],
      },
    });
    expect(
      describeFieldChange(before, {
        ...before,
        label: "Skill level",
        required: true,
        type: {
          kind: "select",
          multiple: false,
          options: [
            { label: "Low", value: "low" },
            { label: "Mid", value: "mid" },
            { label: "Top", value: "top" },
          ],
        },
      }),
    ).toEqual(["+2 options", "−1 option", "now required", "renamed to “Skill level”"]);
    expect(describeFieldChange(before, { ...before, type: { kind: "text" } })).toEqual([
      "type choice → text",
    ]);
  });

  it("reports section moves per field", () => {
    const after: PortfolioSchema = {
      ...base,
      groups: [{ id: "g-you", label: "About you", fieldIds: ["f-name"] }],
    };
    expect(describeSchemaChange(base, after)).toEqual({
      "f-age": ["moved out of its section"],
    });
  });
});
