import {
  defaultDashboard,
  describeDashboardChanges,
  kindsForField,
  mergeDashboard,
  resolveWidget,
  widgetData,
  widgetFits,
  widgetsFromProposals,
} from "@/lib/engine/dashboard";
import { scaleFromSpec } from "@/lib/engine/scale";
import type { DashboardSpec, DashboardWidget, Field, FieldType, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

function field(name: string, type: FieldType, label = name): Field {
  return {
    id: `id-${name}`,
    name,
    label,
    type,
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
  };
}

const AGREE = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
const role = field("role", {
  kind: "select",
  multiple: false,
  options: [
    { label: "Student", value: "student" },
    { label: "Staff", value: "staff" },
  ],
}, "Role");
const sus1 = field("sus1", scaleFromSpec({ points: AGREE }), "Easy to use");
const sus2 = field("sus2", scaleFromSpec({ points: AGREE }), "Well integrated");
const age = field("age", { kind: "number" }, "Age");
const email = field("email", { kind: "text" }, "Email");
const schema: PortfolioSchema = { fields: [email, role, sus1, sus2, age], groups: [], version: 1 };

const widget = (id: string, extra: Partial<DashboardWidget> = {}): DashboardWidget => ({
  id,
  kind: "distribution",
  title: id,
  fieldIds: ["id-role"],
  ...extra,
});

describe("which widget fits which fields", () => {
  it("checks kinds against field types", () => {
    expect(widgetFits("kpi", [])).toBe(true);
    expect(widgetFits("distribution", [role])).toBe(true);
    expect(widgetFits("distribution", [age])).toBe(false);
    expect(widgetFits("likert", [sus1, sus2])).toBe(true);
    expect(widgetFits("likert", [sus1, field("x", scaleFromSpec({ points: ["No", "Yes"] }))])).toBe(false);
    expect(widgetFits("crosstab", [role, sus1])).toBe(true);
    expect(widgetFits("crosstab", [role, role])).toBe(false);
    expect(kindsForField(sus1)).toEqual(["likert", "distribution", "numeric"]);
    expect(kindsForField(field("f", { kind: "file", accept: [] }))).toEqual([]);
  });
});

describe("defaultDashboard", () => {
  it("leads with an overview and merges a Likert battery into one widget", () => {
    const spec = defaultDashboard(schema);
    expect(spec.widgets.map((w) => [w.kind, w.fieldIds])).toEqual([
      ["kpi", []],
      ["timeline", []],
      ["text", ["id-email"]],
      ["distribution", ["id-role"]],
      ["likert", ["id-sus1", "id-sus2"]],
      ["numeric", ["id-age"]],
    ]);
  });
});

describe("widgetsFromProposals", () => {
  it("maps keys (or labels) to ids, repairs misfits, drops duplicates and dead ends", () => {
    const widgets = widgetsFromProposals(
      [
        { kind: "likert", fieldKeys: ["sus1", "Well integrated"], title: "Usability", rationale: "How usable?", size: "full" },
        { kind: "numeric", fieldKeys: ["role"], title: "Roles", rationale: "", size: "half" },
        { kind: "distribution", fieldKeys: ["role"], title: "Roles again", rationale: "", size: "half" },
        { kind: "distribution", fieldKeys: ["nope"], title: "Ghost", rationale: "", size: "half" },
      ],
      schema,
    );
    expect(widgets.map((w) => [w.kind, w.fieldIds, w.title])).toEqual([
      ["likert", ["id-sus1", "id-sus2"], "Usability"],
      ["distribution", ["id-role"], "Roles"],
    ]);
    expect(widgets[0].rationale).toBe("How usable?");
    expect(widgets[1].rationale).toBeUndefined();
  });

  it("keeps the id of a revised widget and records the request", () => {
    const [revised] = widgetsFromProposals(
      [{ kind: "crosstab", fieldKeys: ["role", "sus1"], title: "Ease by role", rationale: "", size: "full" }],
      schema,
      { keepId: "w1", prompt: "split by role" },
    );
    expect(revised).toMatchObject({ id: "w1", kind: "crosstab", prompt: "split by role" });
  });
});

describe("resolveWidget / widgetData", () => {
  it("reports removed fields and charts nothing when the rest doesn't fit", () => {
    const resolved = resolveWidget(widget("w", { fieldIds: ["id-gone"] }), schema);
    expect(resolved).toMatchObject({ missing: 1, fits: false });
    expect(widgetData(resolved, schema, [])).toBeNull();
    const partly = resolveWidget(widget("l", { kind: "likert", fieldIds: ["id-sus1", "id-gone"] }), schema);
    expect(partly).toMatchObject({ missing: 1, fits: true });
  });
});

describe("mergeDashboard", () => {
  const base: DashboardSpec = { widgets: [widget("a"), widget("b"), widget("c")] };

  it("keeps their changes to widgets we didn't touch and their new widgets", () => {
    const ours: DashboardSpec = { widgets: [widget("a", { title: "A (ours)" }), widget("b")] };
    const theirs: DashboardSpec = {
      widgets: [widget("a"), widget("b", { title: "B (theirs)" }), widget("c"), widget("d")],
    };
    const merged = mergeDashboard(base, ours, theirs);
    expect(merged.widgets.map((w) => w.title)).toEqual(["A (ours)", "B (theirs)", "d"]);
  });

  it("doesn't resurrect a widget they removed unless we changed it", () => {
    const theirs: DashboardSpec = { widgets: [widget("c")] };
    const ours: DashboardSpec = { widgets: [widget("a"), widget("b", { title: "B!" }), widget("c")] };
    expect(mergeDashboard(base, ours, theirs).widgets.map((w) => w.id)).toEqual(["b", "c"]);
  });
});

describe("describeDashboardChanges", () => {
  it("names what changed", () => {
    const before: DashboardSpec = { widgets: [widget("a"), widget("b")] };
    const after: DashboardSpec = { widgets: [widget("b", { title: "Roles" }), widget("n")] };
    expect(describeDashboardChanges(before, after)).toBe(
      'Dashboard: Added "n"; removed "a"; changed "Roles"',
    );
    expect(describeDashboardChanges(before, { widgets: [widget("b"), widget("a")] })).toBe(
      "Dashboard: Reordered widgets",
    );
  });
});
