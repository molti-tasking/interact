import { scaleFromSpec } from "@/lib/engine/scale";
import {
  buildFieldStats,
  categoryStats,
  crosstabStats,
  kpiStats,
  likertStats,
  numericStats,
  timelineStats,
  type StatsRow,
} from "@/lib/engine/response-stats";
import type { Field, FieldType, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

function field(name: string, type: FieldType, extra: Partial<Field> = {}): Field {
  return {
    id: `id-${name}`,
    name,
    label: name,
    type,
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...extra,
  };
}

let seq = 0;
function row(data: Record<string, unknown>, submittedAt = "2026-10-01T10:00:00Z"): StatsRow {
  return { id: `r${++seq}`, data, submittedAt };
}

const role = field("role", {
  kind: "select",
  multiple: false,
  options: [
    { label: "Student", value: "student" },
    { label: "Staff", value: "staff" },
    { label: "Visitor", value: "visitor" },
  ],
});

describe("categoryStats", () => {
  it("lists the form's options in order with zero counts, then unknown values", () => {
    const rows = [
      row({ role: "staff" }),
      row({ role: "staff" }),
      row({ role: "student" }),
      row({ role: "teacher" }),
      row({}),
    ];
    const stats = categoryStats(role, rows);
    expect(stats.buckets.map((b) => [b.key, b.count, b.known])).toEqual([
      ["student", 1, true],
      ["staff", 2, true],
      ["visitor", 0, true],
      ["teacher", 1, false],
    ]);
    expect(stats).toMatchObject({ total: 5, answered: 4, empty: 1 });
  });

  it("counts each pick of a multi-select once per response", () => {
    const tags = field("tags", {
      kind: "select",
      multiple: true,
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    });
    const stats = categoryStats(tags, [row({ tags: ["a", "b", "a"] }), row({ tags: ["a"] }), row({ tags: [] })]);
    expect(stats.buckets.map((b) => b.count)).toEqual([2, 1]);
    expect(stats).toMatchObject({ answered: 2, empty: 1, multiple: true });
  });

  it("counts booleans and scale points, numbers stored as text included", () => {
    const yes = categoryStats(field("ok", { kind: "boolean" }), [row({ ok: true }), row({ ok: false }), row({ ok: true })]);
    expect(yes.buckets.map((b) => [b.label, b.count])).toEqual([["Yes", 2], ["No", 1]]);

    const rating = field("rating", scaleFromSpec({ min: 1, max: 3 }));
    const stats = categoryStats(rating, [row({ rating: 3 }), row({ rating: "3" }), row({ rating: 9 })]);
    expect(stats.buckets.map((b) => [b.key, b.count, b.known])).toEqual([
      ["1", 0, true],
      ["2", 0, true],
      ["3", 2, true],
      ["9", 1, false],
    ]);
  });
});

describe("likertStats", () => {
  it("counts each statement per point, with means and stray answers", () => {
    const type = scaleFromSpec({ points: ["Disagree", "Neutral", "Agree"] });
    const a = field("a", type);
    const b = field("b", type);
    const stats = likertStats([a, b], [row({ a: 3, b: 1 }), row({ a: 3, b: 7 }), row({ a: 2 })])!;
    expect(stats.choices.map((c) => c.label)).toEqual(["Disagree", "Neutral", "Agree"]);
    expect(stats.items[0]).toMatchObject({ counts: [0, 1, 2], answered: 3, unknown: 0 });
    expect(stats.items[0].mean).toBeCloseTo(8 / 3);
    expect(stats.items[1]).toMatchObject({ counts: [1, 0, 0], answered: 1, unknown: 1 });
  });
});

describe("numericStats", () => {
  const age = field("age", { kind: "number", min: 0, max: 120 });

  it("summarizes, bins whole numbers per value, and flags what's worth a look", () => {
    const values = [20, 21, 22, 22, 23, 24, 25, 26, 150];
    const stats = numericStats(age, [...values.map((v) => row({ age: v })), row({ age: "n/a" }), row({})]);
    expect(stats).toMatchObject({ count: 9, answered: 10, empty: 1, min: 20, max: 150, median: 23, invalidCount: 1 });
    expect(stats.outliers).toEqual([expect.objectContaining({ value: 150, reason: "out-of-range" })]);
    expect(stats.outOfRange).toBe(1);
    // 20..150 isn't a short whole-number range → 5-12 equal bins
    expect(stats.bins.length).toBeGreaterThanOrEqual(5);
    expect(stats.bins.reduce((a, b) => a + b.count, 0)).toBe(9);
  });

  it("calls far-out values extreme even inside the field's range", () => {
    const stats = numericStats(age, [10, 11, 12, 12, 13, 13, 14, 15, 110].map((v) => row({ age: v })));
    expect(stats.outliers).toEqual([expect.objectContaining({ value: 110, reason: "extreme" })]);
  });

  it("uses one bin per value on short whole-number ranges", () => {
    const stats = numericStats(field("n", { kind: "number" }), [1, 2, 2, 4].map((v) => row({ n: v })));
    expect(stats.bins.map((b) => [b.from, b.count])).toEqual([[1, 1], [2, 2], [3, 0], [4, 1]]);
  });
});

describe("timelineStats", () => {
  it("counts per day with gaps filled", () => {
    const stats = timelineStats([
      row({}, "2026-10-01T09:00:00Z"),
      row({}, "2026-10-01T18:00:00Z"),
      row({}, "2026-10-03T12:00:00Z"),
    ]);
    expect(stats.bucket).toBe("day");
    expect(stats.points).toEqual([
      { start: "2026-10-01", count: 2 },
      { start: "2026-10-02", count: 0 },
      { start: "2026-10-03", count: 1 },
    ]);
  });

  it("switches to weeks over long spans, and can count a date field", () => {
    const visit = field("visit", { kind: "date" });
    const stats = timelineStats(
      [row({ visit: "2026-01-05" }), row({ visit: "2026-06-01" }), row({})],
      visit,
    );
    expect(stats.bucket).toBe("week");
    expect(stats.total).toBe(2);
    expect(stats.points[0].start).toBe("2026-01-05"); // a Monday
  });
});

describe("crosstabStats", () => {
  it("counts responses per pair of categories", () => {
    const ok = field("ok", { kind: "boolean" });
    const stats = crosstabStats(role, ok, [
      row({ role: "staff", ok: true }),
      row({ role: "staff", ok: false }),
      row({ role: "student", ok: true }),
      row({ role: "student" }),
    ]);
    expect(stats.rows.map((r) => r.key)).toEqual(["student", "staff", "visitor"]);
    expect(stats.cells).toEqual([
      [1, 0],
      [1, 1],
      [0, 0],
    ]);
    expect(stats).toMatchObject({ total: 3, max: 1 });
  });
});

describe("kpiStats and buildFieldStats", () => {
  const schema: PortfolioSchema = {
    fields: [{ ...role, required: true }, field("note", { kind: "text" })],
    groups: [],
    version: 1,
  };

  it("counts complete responses and recent ones", () => {
    const now = Date.parse("2026-10-10T00:00:00Z");
    const stats = kpiStats(
      schema,
      [row({ role: "staff" }, "2026-10-09T00:00:00Z"), row({}, "2026-09-01T00:00:00Z")],
      now,
    );
    expect(stats).toEqual({
      responses: 2,
      complete: 1,
      lastSubmittedAt: "2026-10-09T00:00:00Z",
      lastWeek: 1,
    });
  });

  it("aggregates every chartable field by id", () => {
    const stats = buildFieldStats(schema, [row({ role: "staff", note: "hi" })]);
    expect(stats.get("id-role")?.kind).toBe("category");
    expect(stats.get("id-note")?.kind).toBe("text");
  });
});
