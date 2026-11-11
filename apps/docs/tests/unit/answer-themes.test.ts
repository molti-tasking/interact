import { describe, expect, it } from "vitest";
import {
  countThemes,
  findingApplies,
  findingOptionPreview,
  findingProbe,
  themeCandidates,
  themeFinding,
  identifiesRespondent,
} from "interact/forms/findings";
import { buildFieldStats } from "interact/forms/response-stats";
import { applySchemaPatch } from "interact/forms/schema-patch";
import type { Field, PortfolioSchema } from "@/lib/types";

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

const why = field("why", { label: "Why did you join?" });
const transport = field("transport", {
  label: "Transport",
  type: {
    kind: "select",
    multiple: false,
    options: [
      { label: "Car", value: "car" },
      { label: "Bus", value: "bus" },
    ],
  },
});
const schema: PortfolioSchema = {
  fields: [why, transport, field("secret", { label: "Secret", locked: true }), field("short")],
  groups: [],
  version: 1,
};

const rows = Array.from({ length: 10 }, (_, i) => ({
  id: `r${i}`,
  submittedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
  data: {
    why: i === 9 ? "   " : `reason ${i} ${"x".repeat(400)}`,
    secret: `s${i}`,
    short: i < 3 ? "a" : "",
    // 3 distinct unlisted values; "bike" twice
    transport: ["bike", "bike", "tram", "on foot", "car"][i % 5],
  } as Record<string, unknown>,
}));

describe("themeCandidates", () => {
  const candidates = themeCandidates(schema, buildFieldStats(schema, rows), rows);

  it("picks text questions with enough answers and choices with several unlisted answers", () => {
    expect(candidates.map((c) => c.field.name)).toEqual(["why", "transport"]);
  });

  it("sends the newest text answers, trimmed, and never a locked field's", () => {
    const [text] = candidates;
    expect(text.answers).toHaveLength(9);
    expect(text.answers[0].startsWith("reason 8")).toBe(true);
    expect(text.answers.every((a) => a.length <= 300)).toBe(true);
    expect(text.weights).toEqual(Array(9).fill(1));
  });

  it("sends each unlisted choice once, weighted by how often it was given", () => {
    const [, select] = candidates;
    expect(Object.fromEntries(select.answers.map((a, i) => [a, select.weights[i]]))).toEqual({
      bike: 4,
      tram: 2,
      "on foot": 2,
    });
  });
});

describe("countThemes", () => {
  it("counts from the assignment: an index once, in range, weighted", () => {
    const themes = countThemes(
      [
        { label: " Friends ", indices: [0, 1, 1, 2] },
        { label: "Fitness", indices: [2, 3, 4, 99, -1, 1.5] },
        { label: "friends", indices: [5] },
        { label: "Lonely", indices: [6] },
        { label: "", indices: [7] },
      ],
      [1, 1, 1, 1, 1, 1, 1, 1],
    );
    // 2 was claimed by Friends first; "friends" merges; one answer isn't a theme
    expect(themes).toEqual([
      { label: "Friends", count: 4 },
      { label: "Fitness", count: 2 },
    ]);
    expect(countThemes([{ label: "Cycling", indices: [0] }], [4])).toEqual([
      { label: "Cycling", count: 4 },
    ]);
  });
});

describe("themeFinding", () => {
  const themes = [
    { label: "Friends", count: 5 },
    { label: "Fitness", count: 3 },
  ];

  it("turns a text question's themes into a choice the creator can accept", () => {
    const finding = themeFinding({ field: why, answered: 9 }, themes)!;
    expect(finding).toMatchObject({
      kind: "text-themes",
      fieldId: "f-why",
      evidence: "Grouped by AI, 8 of 9 answers: Friends (5), Fitness (3)",
    });
    expect(findingApplies(finding.key, schema)).toBe(true);

    const probe = findingProbe(finding, schema)!;
    expect(probe.text).toBe('Turn "Why did you join?" into a choice?');
    expect(probe.options.map((o) => o.value)).toEqual(["makeChoice", "keep"]);

    const preview = findingOptionPreview(finding.key, "makeChoice", schema)!;
    const { schema: after } = applySchemaPatch(schema, preview.schemaPatch);
    expect(after.fields.find((f) => f.name === "why")!.type).toEqual({
      kind: "select",
      multiple: false,
      options: [
        { label: "Friends", value: "Friends" },
        { label: "Fitness", value: "Fitness" },
        { label: "Other", value: "Other" },
      ],
    });
    // Once it is a choice, the finding no longer applies
    expect(findingApplies(finding.key, after)).toBe(false);
  });

  it("needs at least two themes for a text question", () => {
    expect(themeFinding({ field: why, answered: 9 }, themes.slice(0, 1))).toBeNull();
  });

  it("offers a choice question's themes as new options, skipping ones it has", () => {
    const finding = themeFinding({ field: transport, answered: 10 }, [
      { label: "Cycling", count: 4 },
      { label: "bus", count: 2 },
    ])!;
    expect(finding.kind).toBe("unknown-values");
    expect(finding.evidence).toBe("Grouped by AI: Cycling (4)");
    const probe = findingProbe(finding, schema)!;
    expect(probe.text).toBe('Add "Cycling" as options of "Transport"?');
    expect(themeFinding({ field: transport, answered: 10 }, [{ label: "Car", count: 3 }])).toBeNull();
  });
});

describe("identifiesRespondent", () => {
  const text = (name: string, label: string): Field => ({
    id: `f-${name}`,
    name,
    label,
    type: { kind: "text" },
    required: false,
    constraints: [],
    origin: "system",
    tags: [],
  });

  it("recognises names and contact details by key or label", () => {
    expect(identifiesRespondent(text("fullName", "Full name"), ["Mia Hansen"])).toBe(true);
    expect(identifiesRespondent(text("reachYou", "Email address"), ["a@b.org"])).toBe(true);
    expect(identifiesRespondent(text("phoneNumber", "How can we call you?"), ["x"])).toBe(true);
  });

  it("recognises contact details by the answers themselves", () => {
    expect(
      identifiesRespondent(text("reach", "How do we reach you?"), [
        "mia@example.org",
        "+45 12 34 56 78",
        "ask my neighbour",
      ]),
    ).toBe(true);
  });

  it("leaves ordinary questions alone", () => {
    expect(
      identifiesRespondent(text("favouriteGames", "Which games do you like?"), [
        "Catan",
        "Codenames, mostly",
      ]),
    ).toBe(false);
    // "name" inside another word is not a name question
    expect(identifiesRespondent(text("tournament", "Tournament wishes"), ["none"])).toBe(false);
  });
});
