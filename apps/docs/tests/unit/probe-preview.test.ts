import { describe, expect, it } from "vitest";
import {
  buildPreviewSchema,
  patchSize,
  previewSchemaChange,
  rankProbes,
  summarizePatch,
} from "@/lib/engine/probe-preview";
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

const schema: PortfolioSchema = {
  fields: [
    field({ id: "f-name", name: "name", label: "Name" }),
    field({ id: "f-notes", name: "notes", label: "Notes" }),
    field({ id: "f-age", name: "age", label: "Age", type: { kind: "number" } }),
  ],
  groups: [],
  version: 1,
};

describe("buildPreviewSchema", () => {
  it("annotates added, changed and removed fields, keeping removed ones in place", () => {
    const { schema: preview, annotations } = buildPreviewSchema(schema, {
      addFields: [{ key: "goal", label: "Goal", type: "string", required: true }],
      updateFields: [{ key: "age", label: "Age (years)", type: "number", required: true }],
      removeFieldKeys: ["notes"],
    });

    expect(preview.fields.map((f) => f.name)).toEqual([
      "name",
      "notes",
      "age",
      "goal",
    ]);
    const goal = preview.fields.find((f) => f.name === "goal")!;
    expect(annotations).toEqual({
      "f-notes": "removed",
      "f-age": "updated",
      [goal.id]: "added",
    });
  });

  it("ignores no-op updates and ops on unknown fields", () => {
    const { schema: preview, annotations } = buildPreviewSchema(schema, {
      updateFields: [{ key: "name", label: "Name", type: "string", required: false }],
      removeFieldKeys: ["missing"],
    });
    expect(annotations).toEqual({});
    expect(preview.fields).toEqual(schema.fields);
  });

  it("shows a key removed and re-added in one patch as a single change", () => {
    const { schema: preview, annotations } = buildPreviewSchema(schema, {
      removeFieldKeys: ["notes"],
      addFields: [{ key: "notes", label: "Coach notes", type: "string", required: false }],
    });
    const notes = preview.fields.filter((f) => f.name === "notes");
    expect(notes).toHaveLength(1);
    expect(annotations).toEqual({ [notes[0].id]: "updated" });
  });
});

describe("previewSchemaChange", () => {
  it("tells fields with the same name apart (duplicate conflicts)", () => {
    const withDuplicate: PortfolioSchema = {
      ...schema,
      fields: [
        ...schema.fields,
        field({ id: "f-notes-2", name: "notes", label: "More notes" }),
      ],
    };
    const merged: PortfolioSchema = {
      ...withDuplicate,
      fields: withDuplicate.fields
        .filter((f) => f.id !== "f-notes-2")
        .map((f) => (f.id === "f-notes" ? { ...f, label: "All notes" } : f)),
    };

    const { schema: preview, annotations } = previewSchemaChange(
      withDuplicate,
      merged,
    );
    expect(preview.fields.map((f) => f.id)).toEqual([
      "f-name",
      "f-notes",
      "f-age",
      "f-notes-2",
    ]);
    expect(annotations).toEqual({ "f-notes": "updated", "f-notes-2": "removed" });
  });
});

describe("summarizePatch", () => {
  it("lists labels per kind of change", () => {
    const summary = summarizePatch(schema, {
      addFields: [{ key: "goal", label: "Goal", type: "string", required: true }],
      removeFieldKeys: ["notes"],
    });
    expect(summary).toEqual({ added: ["Goal"], updated: [], removed: ["Notes"] });
    expect(patchSize(summary)).toBe(2);
  });

  it("is empty for a patch that changes nothing", () => {
    expect(patchSize(summarizePatch(schema, {}))).toBe(0);
  });
});

describe("rankProbes", () => {
  it("orders by priority, newest first within a priority", () => {
    const ranked = rankProbes([
      { id: "low", priority: 3, createdAt: "2026-01-03T00:00:00Z" },
      { id: "mid-old", priority: 2, createdAt: "2026-01-01T00:00:00Z" },
      { id: "high", priority: 1, createdAt: "2026-01-01T00:00:00Z" },
      { id: "mid-new", priority: 2, createdAt: "2026-01-02T00:00:00Z" },
    ] as const);
    expect(ranked.map((p) => p.id)).toEqual(["high", "mid-new", "mid-old", "low"]);
  });
});
