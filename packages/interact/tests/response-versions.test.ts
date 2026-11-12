import { describe, expect, it } from "vitest";
import {
  affectedResponses,
  destructiveChanges,
  fieldChangesAfterResponses,
  type VersionedChange,
  type VersionedResponse,
} from "../src/forms/response-versions";
import type { Field } from "../src/forms/types";
import { field, schema } from "./helpers";

const response = (version: number | null, data: Record<string, unknown>, at?: string): VersionedResponse => ({
  schemaVersion: version,
  submittedAt: at ?? null,
  data,
});

const change = (
  revision: number | null,
  createdAt: string,
  fieldId: string,
  before: Partial<Field>,
  after: Partial<Field>,
): VersionedChange => ({
  revision,
  createdAt,
  diff: { added: [], removed: [], modified: [{ fieldId, before, after }] },
});

const select = (...labels: string[]): Field["type"] => ({
  kind: "select",
  multiple: false,
  options: labels.map((label) => ({ label, value: label.toLowerCase() })),
});

describe("fields that changed after answers were collected", () => {
  const form = schema("name", "level");

  it("reports a wording change with the answers given to the earlier wording", () => {
    const notices = fieldChangesAfterResponses(
      form,
      [change(5, "2026-01-02", "f-level", { label: "Level" }, { label: "Years of experience" })],
      [
        response(3, { name: "A", level: "high" }),
        response(4, { name: "B", level: "low" }),
        response(5, { name: "C", level: "2" }),
        response(4, { name: "D" }), // didn't answer this field
      ],
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ fieldName: "level", answersBefore: 2, answers: 3 });
    expect(notices[0].changes).toEqual([
      { kind: "wording", before: "Level", after: "Years of experience", at: "2026-01-02", answersBefore: 2 },
    ]);
  });

  it("reports a type change and a change of options", () => {
    const notices = fieldChangesAfterResponses(
      form,
      [
        change(3, "2026-01-02", "f-level", { type: { kind: "text" } }, { type: select("Low", "High") }),
        change(6, "2026-01-03", "f-level", { type: select("Low", "High") }, { type: select("Low", "Medium", "High") }),
      ],
      [response(2, { level: "quite high" }), response(4, { level: "high" }), response(7, { level: "medium" })],
    );
    expect(notices[0].changes.map((c) => [c.kind, c.before, c.after, c.answersBefore])).toEqual([
      ["type", "text", "choose one", 1],
      ["options", "Low | High", "Low | Medium | High", 2],
    ]);
    expect(notices[0].answersBefore).toBe(2);
  });

  it("says nothing about changes made before the first answer", () => {
    expect(
      fieldChangesAfterResponses(
        form,
        [change(2, "2026-01-01", "f-level", { label: "Lvl" }, { label: "Level" })],
        [response(2, { level: "high" }), response(9, { level: "low" })],
      ),
    ).toEqual([]);
  });

  it("says nothing about changes that don't alter how the field asks", () => {
    expect(
      fieldChangesAfterResponses(
        form,
        [
          change(5, "2026-01-02", "f-level", { required: false }, { required: true }),
          change(6, "2026-01-03", "f-level", { label: "Level" }, { label: "Level " }),
          change(7, "2026-01-04", "f-name", { label: "Name" }, { label: "Full name" }),
        ],
        [response(1, { level: "high" })],
      ),
    ).toEqual([]);
  });

  it("falls back to time where a version is unknown", () => {
    const notices = fieldChangesAfterResponses(
      form,
      [change(null, "2026-01-02T12:00:00Z", "f-level", { label: "Level" }, { label: "Experience" })],
      [
        response(null, { level: "a" }, "2026-01-01T09:00:00Z"),
        response(null, { level: "b" }, "2026-01-03T09:00:00Z"),
        response(null, { level: "c" }), // no time either: not counted as before
      ],
    );
    expect(notices[0]).toMatchObject({ answersBefore: 1, answers: 3 });
  });

  it("ignores fields that are no longer in the form", () => {
    expect(
      fieldChangesAfterResponses(
        { ...form, fields: [field("name")] },
        [change(5, "2026-01-02", "f-level", { label: "Level" }, { label: "Experience" })],
        [response(1, { level: "high" })],
      ),
    ).toEqual([]);
  });
});

describe("collected answers a change affects (I6)", () => {
  const before = schema("name", "age", "notes");
  const answers = [
    { data: { name: "A", age: 9, notes: "" } },
    { data: { name: "B", age: null, notes: "late" } },
    { data: { name: "  ", notes: [] } },
  ];

  it("counts answers to a removed field, and responses with any affected answer", () => {
    const after = { ...before, fields: before.fields.filter((f) => f.name !== "age") };
    const impact = affectedResponses(before, after, answers);
    expect(impact.fields).toEqual([
      { fieldId: "f-age", fieldName: "age", label: "Age", kinds: ["removed"], answers: 1 },
    ]);
    expect(impact.responses).toBe(1);
  });

  it("treats a new type, wording or key as affecting the stored answers", () => {
    const after = {
      ...before,
      fields: before.fields.map((f) =>
        f.name === "name"
          ? { ...f, label: "Full name" }
          : f.name === "age"
            ? { ...f, type: { kind: "number" as const } }
            : f.name === "notes"
              ? { ...f, name: "comments" }
              : f,
      ),
    };
    const impact = affectedResponses(before, after, answers);
    expect(impact.fields.map((f) => [f.fieldName, f.kinds, f.answers])).toEqual([
      ["name", ["label"], 2],
      ["age", ["type"], 1],
      ["notes", ["key"], 1],
    ]);
    // Responses 1 and 2 have an affected answer; response 3 has only empty ones
    expect(impact.responses).toBe(2);
  });

  it("treats one choice ↔ several choices as a new type", () => {
    const one = schema("size");
    one.fields[0].type = { kind: "select", multiple: false, options: [{ label: "S", value: "s" }] };
    const several = {
      ...one,
      fields: [{ ...one.fields[0], type: { kind: "select" as const, multiple: true, options: [{ label: "S", value: "s" }] } }],
    };
    expect(destructiveChanges(one, several)[0].kinds).toEqual(["type"]);
  });

  it("is empty for additions, requiredness and help text", () => {
    const after = {
      ...before,
      fields: [
        ...before.fields.map((f) => ({ ...f, required: true, description: "help" })),
        field("phone"),
      ],
    };
    expect(destructiveChanges(before, after)).toEqual([]);
    expect(affectedResponses(before, after, answers)).toEqual({ fields: [], responses: 0 });
  });
});
