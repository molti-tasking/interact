import { applySchemaPatch } from "@/lib/engine/schema-patch";
import {
  assignSection,
  moveSection,
  normalizeSections,
  removeSection,
  sectionBlocks,
  sectionsFromTitles,
  updateSection,
} from "@/lib/engine/sections";
import { serializeSchemaForLLM } from "@/lib/engine/structured-intent";
import type { Field, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

const field = (name: string): Field => ({
  id: `id-${name}`,
  name,
  label: name,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});

const base: PortfolioSchema = {
  fields: ["name", "email", "q1", "q2", "notes"].map(field),
  groups: [],
  version: 1,
};
const names = (s: PortfolioSchema) => s.fields.map((f) => f.name);
const sections = (s: PortfolioSchema) => {
  const nameOf = new Map(s.fields.map((f) => [f.id, f.name]));
  return s.groups.map((g) => [g.label, g.fieldIds.map((id) => nameOf.get(id))]);
};

describe("sections", () => {
  const withSections = sectionsFromTitles(
    base,
    (f) => ({ name: "About you", email: "About you", q1: "Ratings", q2: "Ratings" })[f.name],
    [{ title: "ratings", description: "Rate each statement." }],
  );

  it("builds sections from titles, in order of their first field, with intros", () => {
    expect(sections(withSections)).toEqual([
      ["About you", ["name", "email"]],
      ["Ratings", ["q1", "q2"]],
    ]);
    expect(withSections.groups[1].description).toBe("Rate each statement.");
    // Fields outside any section come first
    expect(names(withSections)).toEqual(["notes", "name", "email", "q1", "q2"]);
    expect(sectionBlocks(withSections).map((b) => b.section?.label ?? null)).toEqual([
      null,
      "About you",
      "Ratings",
    ]);
  });

  it("moves a field between sections, creating and dropping sections as needed", () => {
    let s = assignSection(withSections, "id-notes", "ratings");
    expect(sections(s)).toEqual([
      ["About you", ["name", "email"]],
      ["Ratings", ["q1", "q2", "notes"]],
    ]);
    s = assignSection(s, "id-name", "Contact");
    s = assignSection(s, "id-email", "Contact");
    expect(sections(s).map(([label]) => label)).toEqual(["Ratings", "Contact"]);
    s = assignSection(s, "id-q1", null);
    expect(names(s)[0]).toBe("q1");
  });

  it("reorders, renames and dissolves sections", () => {
    const moved = moveSection(withSections, withSections.groups[1].id, -1);
    expect(names(moved)).toEqual(["notes", "q1", "q2", "name", "email"]);
    const renamed = updateSection(withSections, withSections.groups[0].id, {
      label: "You",
      description: "  ",
    });
    expect(renamed.groups[0]).toMatchObject({ label: "You", description: undefined });
    const removed = removeSection(withSections, withSections.groups[0].id);
    expect(removed.groups).toHaveLength(1);
    expect(names(removed)).toEqual(["notes", "name", "email", "q1", "q2"]);
  });

  it("repairs fields in two sections, dangling ids and empty sections", () => {
    const messy: PortfolioSchema = {
      ...base,
      groups: [
        { id: "a", label: "A", fieldIds: ["id-q1", "id-gone"] },
        { id: "b", label: "B", fieldIds: ["id-q1", "id-q2"] },
        { id: "c", label: "C", fieldIds: [] },
      ],
    };
    expect(sections(normalizeSections(messy))).toEqual([
      ["A", ["q1"]],
      ["B", ["q2"]],
    ]);
  });

  it("lets schema patches put fields into sections", () => {
    const { schema } = applySchemaPatch(withSections, {
      addFields: [{ key: "age", label: "Age", type: "number", required: false }],
      sections: [
        { title: "About you", fieldKeys: ["age"] },
        { title: "", fieldKeys: ["q2"] },
      ],
    });
    expect(sections(schema)).toEqual([
      ["About you", ["name", "email", "age"]],
      ["Ratings", ["q1"]],
    ]);
  });

  it("counts a section move as a change (probe answers apply it)", () => {
    const { applied, schema } = applySchemaPatch(withSections, {
      sections: [{ title: "Demographics", fieldKeys: ["email"] }],
    });
    expect(applied.updated).toEqual(["email"]);
    expect(schema.version).toBe(withSections.version + 1);
    const same = applySchemaPatch(withSections, {
      sections: [{ title: "about you", fieldKeys: ["email"] }],
    });
    expect(same.applied.updated).toEqual([]);
  });

  it("shows sections to the LLM as headings", () => {
    expect(serializeSchemaForLLM(withSections)).toBe(
      [
        '- notes: "notes" (string)',
        'Section "About you":',
        '- name: "name" (string)',
        '- email: "email" (string)',
        'Section "Ratings":',
        '- q1: "q1" (string)',
        '- q2: "q2" (string)',
      ].join("\n"),
    );
  });
});
