import { describe, expect, it } from "vitest";
import {
  pretestExplanation,
  pretestFindings,
  pretestIssues,
  pretestRows,
  sanitizeRespondents,
  type SimulatedRespondent,
} from "interact/forms/pretest";
import { applyProbeOption } from "interact/forms/guards";
import type { Field, PortfolioSchema, ProbeOptionPreview } from "@/lib/types";

function field(name: string, extra: Partial<Field> = {}): Field {
  return {
    id: `f-${name}`,
    name,
    label: name,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
    ...extra,
  };
}

const schema: PortfolioSchema = {
  fields: [
    field("name", { label: "Name", required: true }),
    field("memberNumber", { label: "Member number", required: true }),
    field("diet", {
      label: "Diet",
      type: {
        kind: "select",
        multiple: false,
        options: [
          { label: "Vegan", value: "vegan" },
          { label: "Omnivore", value: "omni" },
        ],
      },
    }),
    field("age", { label: "Age", type: { kind: "number", min: 0, max: 120 } }),
    field("income", { label: "Income", locked: true }),
    field("photo", { label: "Photo", type: { kind: "file", accept: [] } }),
  ],
  groups: [],
  version: 4,
};

function respondent(
  i: number,
  answers: Record<string, string | null>,
  troubles: SimulatedRespondent["troubles"] = [],
): SimulatedRespondent {
  return { persona: `Person ${i}`, answers, troubles };
}

describe("sanitizeRespondents", () => {
  it("keeps only answers and troubles about fields the form can ask", () => {
    const [clean, ...rest] = sanitizeRespondents(schema, [
      {
        persona: "  Retired teacher  ",
        answers: [
          { field: "name", value: " Ada " },
          { field: "name", value: "Again" },
          { field: "ghost", value: "x" },
          { field: "photo", value: "me.png" },
          { field: "age", value: "" },
        ],
        troubles: [
          { field: "memberNumber", kind: "cant-answer", note: "I'm new" },
          { field: "memberNumber", kind: "cant-answer", note: "twice" },
          { field: "diet", kind: "missing-option", note: "no fit", suggestion: " Vegetarian " },
          { field: "diet", kind: "made-up-kind", note: "x" },
          { field: "ghost", kind: "unclear", note: "x" },
          // A suggestion only belongs to a missing option
          { field: "name", kind: "unclear", note: "which name?", suggestion: "Nickname" },
        ],
      },
      { persona: "Empty", answers: [{ field: "ghost", value: "x" }], troubles: [] },
    ]);
    expect(rest).toEqual([]);
    expect(clean.persona).toBe("Retired teacher");
    expect(clean.answers).toEqual({ name: "Ada", age: null });
    expect(clean.troubles).toEqual([
      { field: "memberNumber", kind: "cant-answer", note: "I'm new" },
      { field: "diet", kind: "missing-option", note: "no fit", suggestion: "Vegetarian" },
      { field: "name", kind: "unclear", note: "which name?" },
    ]);
  });
});

describe("pretestRows", () => {
  it("types answers like stored responses and keeps unlisted choices as written", () => {
    const rows = pretestRows(schema, [
      respondent(1, { name: "Ada", diet: "Vegan", age: "34" }),
      respondent(2, { name: "Bo", diet: "Pescatarian", age: "old", memberNumber: null }),
    ]);
    expect(rows[0].data).toEqual({ name: "Ada", diet: "vegan", age: 34 });
    // "old" isn't a number → left empty; the unlisted diet stays visible
    expect(rows[1].data).toEqual({ name: "Bo", diet: "Pescatarian" });
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});

describe("pretestFindings", () => {
  it("runs the simulated answers through the same detection as real responses", () => {
    const respondents = Array.from({ length: 8 }, (_, i) =>
      respondent(i, {
        name: `P${i}`,
        diet: i < 3 ? "Pescatarian" : "Vegan",
        age: "30",
      }),
    );
    const findings = pretestFindings(schema, respondents);
    expect(findings.map((f) => f.kind)).toContain("unknown-values");
    // An option nobody picked among 8 made-up people is noise, not a finding
    expect(findings.map((f) => f.kind)).not.toContain("unused-option");
  });

  it("finds nothing in too few respondents", () => {
    expect(pretestFindings(schema, [respondent(1, { diet: "Pescatarian" })])).toEqual([]);
  });
});

describe("pretestIssues", () => {
  const respondents = [
    respondent(1, { name: "A" }, [
      { field: "memberNumber", kind: "cant-answer", note: "I'm not a member yet" },
      { field: "diet", kind: "missing-option", note: "I eat fish", suggestion: "Pescatarian" },
    ]),
    respondent(2, { name: "B" }, [
      { field: "memberNumber", kind: "cant-answer", note: "Don't know it by heart" },
      { field: "diet", kind: "missing-option", note: "no meat", suggestion: "Vegetarian" },
      { field: "income", kind: "too-personal", note: "Why do you need this?" },
    ]),
    respondent(3, { name: "C" }, [
      { field: "memberNumber", kind: "cant-answer", note: "Lost my card" },
      { field: "diet", kind: "missing-option", note: "veggie", suggestion: "vegetarian" },
      { field: "name", kind: "unclear", note: "Full name or nickname?" },
      { field: "diet", kind: "missing-option", note: "has it", suggestion: "Vegan" },
    ]),
    respondent(4, { name: "D" }),
  ];
  const issues = pretestIssues(schema, respondents);
  const byKind = (kind: string) => issues.find((i) => i.kind === kind)!;

  it("counts respondents per field and kind and ranks the most common first", () => {
    expect(issues.map((i) => [i.kind, i.fieldLabel, i.count, i.total])).toEqual([
      ["cant-answer", "Member number", 3, 4],
      ["missing-option", "Diet", 3, 4],
      ["unclear", "Name", 1, 4],
    ]);
    expect(byKind("cant-answer").text).toBe(`3 of 4 couldn't answer "Member number"`);
    expect(byKind("cant-answer").examples).toEqual([
      { persona: "Person 1", note: "I'm not a member yet" },
      { persona: "Person 2", note: "Don't know it by heart" },
      { persona: "Person 3", note: "Lost my card" },
    ]);
  });

  it("offers nothing for a locked field", () => {
    expect(issues.some((i) => i.fieldLabel === "Income")).toBe(false);
  });

  it("builds ready answers for a required question some can't answer", () => {
    const { probe } = byKind("cant-answer");
    expect(probe.ready).toBe(true);
    expect(probe.options.map((o) => o.value)).toEqual(["makeOptional", "removeField", "keep"]);
    const optional = probe.options[0].preview as ProbeOptionPreview;
    expect(optional.scope).toEqual({ added: [], updated: ["memberNumber"], removed: [] });
    const { schema: after, changed } = applyProbeOption(schema, optional);
    expect(changed).toBe(true);
    expect(after.fields.find((f) => f.name === "memberNumber")).toMatchObject({
      required: false,
      label: "Member number",
    });
    expect(probe.options[2].preview!.scope).toEqual({ added: [], updated: [], removed: [] });
  });

  it("adds the options respondents asked for, most wanted first, without repeats", () => {
    const { probe } = byKind("missing-option");
    // "Vegan" is already offered; "Vegetarian"/"vegetarian" is one suggestion
    expect(probe.text).toBe('Add "Vegetarian", "Pescatarian" to "Diet"?');
    const { schema: after } = applyProbeOption(schema, probe.options[0].preview!);
    const diet = after.fields.find((f) => f.name === "diet")!;
    expect(diet.type).toMatchObject({
      kind: "select",
      options: [
        { label: "Vegan", value: "vegan" },
        { label: "Omnivore", value: "omni" },
        { label: "Vegetarian", value: "Vegetarian" },
        { label: "Pescatarian", value: "Pescatarian" },
      ],
    });
  });

  it("leaves rewording to the background preview", () => {
    const { probe } = byKind("unclear");
    expect(probe.ready).toBe(false);
    expect(probe.options.every((o) => o.preview === undefined)).toBe(true);
  });

  it("says where the question comes from", () => {
    expect(pretestExplanation(byKind("cant-answer"))).toBe(
      "From a pretest with 4 simulated respondents: 3 of 4 — e.g. “I'm not a member yet”.",
    );
  });

  it("lists what the answers show once, not also as a missing option", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      respondent(i, { name: `P${i}`, diet: i < 3 ? "Pescatarian" : "Vegan", age: "30" }),
    );
    const fromAnswers = pretestIssues(schema, many);
    expect(fromAnswers.map((i) => i.kind)).toEqual(["answers"]);
    expect(fromAnswers[0].probe.ready).toBe(true);
    expect(fromAnswers[0].probe.options[0].preview!.scope).toEqual({
      added: [],
      updated: ["diet"],
      removed: [],
    });

    many[0].troubles.push({
      field: "diet",
      kind: "missing-option",
      note: "fish",
      suggestion: "Pescatarian",
    });
    expect(pretestIssues(schema, many).map((i) => i.kind)).toEqual(["missing-option"]);
  });

  it("is empty without respondents", () => {
    expect(pretestIssues(schema, [])).toEqual([]);
  });
});
