import {
  detectFindings,
  findingApplies,
  findingOptionPreview,
  findingProbe,
  parseFindingKey,
} from "@/lib/engine/findings";
import { buildFieldStats, type StatsRow } from "@/lib/engine/response-stats";
import { applySchemaPatch } from "@/lib/engine/schema-patch";
import type { Field, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

const role: Field = {
  id: "f-role",
  name: "role",
  label: "Role",
  type: {
    kind: "select",
    multiple: false,
    options: [
      { label: "Student", value: "student" },
      { label: "Staff", value: "staff" },
      { label: "Visitor", value: "visitor" },
    ],
  },
  required: true,
  constraints: [],
  origin: "system",
  tags: [],
};
const note: Field = { ...role, id: "f-note", name: "note", label: "Note", required: false, type: { kind: "text" } };
const age: Field = { ...role, id: "f-age", name: "age", label: "Age", required: false, type: { kind: "number", min: 0, max: 120 } };
const schema: PortfolioSchema = { fields: [role, note, age], groups: [], version: 1 };

const rows = (n: number, data: (i: number) => Record<string, unknown>): StatsRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, data: data(i), submittedAt: "2026-10-01T00:00:00Z" }));

const findingsFor = (r: StatsRow[]) => detectFindings(schema, buildFieldStats(schema, r));

describe("detectFindings", () => {
  it("says nothing below the minimum number of responses", () => {
    expect(findingsFor(rows(19, () => ({ role: "staff" })))).toEqual([]);
  });

  it("finds unused options, a dominant answer and a mostly skipped question", () => {
    const found = findingsFor(rows(20, (i) => ({ role: i === 0 ? "student" : "staff", age: 30 })));
    expect(found.map((f) => f.key)).toEqual([
      "data:unused-option:f-role:visitor",
      "data:dominant-answer:f-role:staff",
      "data:mostly-skipped:f-note",
    ]);
    expect(found[1].evidence).toBe("19 of 20 answers (95%)");
  });

  it("stays quiet just under the thresholds", () => {
    // 18/20 = 90% staff; note skipped by 13/20 = 65%
    const found = findingsFor(
      rows(20, (i) => ({
        role: i < 18 ? "staff" : i === 18 ? "student" : "visitor",
        note: i < 7 ? "x" : undefined,
        age: 30,
      })),
    );
    expect(found.map((f) => f.kind)).toEqual([]);
  });

  it("finds recurring values the form doesn't offer and numbers out of range", () => {
    const found = findingsFor(
      rows(20, (i) => ({
        role: i < 3 ? "teacher" : i === 3 ? "visitor" : i % 2 ? "staff" : "student",
        age: i < 3 ? 300 : 30,
        note: "x",
      })),
    );
    expect(found.map((f) => f.key)).toEqual([
      'data:unknown-values:f-role:["teacher"]',
      "data:out-of-range:f-age",
    ]);
  });
});

describe("findings as probes", () => {
  it("parses keys, including details with colons", () => {
    expect(parseFindingKey('data:unknown-values:f-role:["a:b"]')).toEqual({
      kind: "unknown-values",
      fieldId: "f-role",
      detail: '["a:b"]',
    });
    expect(parseFindingKey("design:x")).toBeNull();
  });

  it("builds answers that apply to the form as it is *now*", () => {
    const [unused] = findingsFor(rows(20, (i) => ({ role: i % 2 ? "staff" : "student", note: "x" })));
    const probe = findingProbe(unused, schema)!;
    expect(probe.options.map((o) => o.value)).toEqual(["removeOption", "keep"]);

    // Meanwhile an option was added and the field made optional
    const later: PortfolioSchema = {
      ...schema,
      fields: schema.fields.map((f) =>
        f.id === "f-role" && f.type.kind === "select"
          ? { ...f, required: false, type: { ...f.type, options: [...f.type.options, { label: "Alumni", value: "alumni" }] } }
          : f,
      ),
    };
    const preview = findingOptionPreview(unused.key, "removeOption", later)!;
    const result = applySchemaPatch(later, preview.schemaPatch).schema.fields[0];
    expect(result.type.kind === "select" && result.type.options.map((o) => o.value)).toEqual([
      "student",
      "staff",
      "alumni",
    ]);
    expect(result.required).toBe(false);
    expect(findingOptionPreview(unused.key, "keep", later)?.schemaPatch).toEqual({});
  });

  it("goes stale once the option or field is gone", () => {
    const key = "data:unused-option:f-role:visitor";
    expect(findingApplies(key, schema)).toBe(true);
    const removed: PortfolioSchema = {
      ...schema,
      fields: schema.fields.map((f) =>
        f.id === "f-role" && f.type.kind === "select"
          ? { ...f, type: { ...f.type, options: f.type.options.filter((o) => o.value !== "visitor") } }
          : f,
      ),
    };
    expect(findingApplies(key, removed)).toBe(false);
    expect(findingApplies("data:mostly-skipped:f-note", { ...schema, fields: [role] })).toBe(false);
  });

  it("offers to make a required question optional when one answer dominates", () => {
    const probe = findingProbe(
      { key: "data:dominant-answer:f-role:staff", kind: "dominant-answer", fieldId: "f-role", text: "", evidence: "19 of 20" },
      schema,
    )!;
    expect(probe.options.map((o) => o.value)).toEqual(["removeField", "makeOptional", "keep"]);
    expect(probe.explanation).toBe("From the responses: 19 of 20.");
  });
});
