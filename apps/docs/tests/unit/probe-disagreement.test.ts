import { describe, expect, it } from "vitest";
import {
  composeProbes,
  fieldTokens,
  findDisagreements,
  opsPatch,
  voteEntropy,
  type CandidateDesign,
} from "interact/forms/probe-disagreement";
import { applySchemaPatch, type PatchField } from "interact/forms/schema-patch";
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

function draft(key: string, label: string, extra: Partial<PatchField> = {}): PatchField {
  return { key, label, type: "string", required: false, ...extra };
}

const diet = (labels: string[]) =>
  draft("diet", "Diet", {
    type: "select",
    validation: { options: labels.map((label) => ({ label, value: label })) },
  });

const schema: PortfolioSchema = {
  fields: [
    field("name", { label: "Name", required: true }),
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
    field("notes", { label: "Notes", locked: true }),
  ],
  groups: [],
  version: 1,
};

const name = draft("name", "Name", { required: true });
const now = diet(["Vegan", "Omnivore"]);
const notes = draft("notes", "Notes");

describe("voteEntropy", () => {
  it("is highest for an even split and zero when unanimous", () => {
    expect(voteEntropy(2, 4)).toBe(1);
    expect(voteEntropy(1, 4)).toBeCloseTo(0.811, 3);
    expect(voteEntropy(3, 4)).toBeCloseTo(0.811, 3);
    expect(voteEntropy(4, 4)).toBe(0);
    expect(voteEntropy(0, 4)).toBe(0);
  });
});

describe("fieldTokens", () => {
  it("splits camelCase, drops filler words and plural endings", () => {
    expect([...fieldTokens("dietaryRestrictions")]).toEqual(["dietary", "restriction"]);
    expect([...fieldTokens("What are your allergies?")]).toEqual(["allergy"]);
  });
});

describe("findDisagreements", () => {
  it("finds nothing when every draft keeps the form as it is", () => {
    const same: CandidateDesign = { fields: [name, now, notes] };
    expect(findDisagreements(schema, [same, same, same])).toEqual([]);
  });

  it("counts drafts that add the same field under different names", () => {
    const candidates: CandidateDesign[] = [
      { fields: [name, now, notes, draft("allergies", "Allergies")] },
      { fields: [name, now, notes, draft("foodAllergies", "Any allergies?")] },
      { fields: [name, now, notes] },
      { fields: [name, now, notes, draft("arrivalTime", "Arrival time")] },
    ];
    const ops = findDisagreements(schema, candidates);
    expect(ops.map((o) => [o.kind, o.key, o.votes, o.voters])).toEqual([
      ["add", "allergies", 2, 4],
      ["add", "arrivalTime", 1, 4],
    ]);
    expect(ops[0].entropy).toBe(1);
    expect(ops[0].patch.addFields![0].label).toBe("Allergies");
  });

  it("ranks the contested change above the unanimous one", () => {
    const sleep = draft("sleep", "Hours of sleep", { type: "number" });
    const ops = findDisagreements(schema, [
      { fields: [name, now, notes, sleep, draft("goal", "Goal")] },
      { fields: [name, now, notes, sleep] },
    ]);
    expect(ops.map((o) => o.key)).toEqual(["goal", "sleep"]);
  });

  it("reports removals, required flips and new option lists of existing fields", () => {
    const wider = diet(["Vegan", "Vegetarian", "Omnivore"]);
    const ops = findDisagreements(schema, [
      { fields: [name, wider, notes] },
      { fields: [name, { ...wider, required: true }, notes] },
      { fields: [{ ...name, required: false }, now, notes] },
      { fields: [name, notes] },
    ]);
    const byRef = Object.fromEntries(ops.map((o) => [o.ref, o]));
    expect(byRef.r1).toMatchObject({ kind: "remove", key: "diet", votes: 1, voters: 4 });
    // Only the three drafts that kept the field vote on its details
    expect(byRef.o1).toMatchObject({ kind: "options", key: "diet", votes: 2, voters: 3 });
    expect(byRef.o1.summary).toBe(
      'change the options of "Diet" to: Vegan, Vegetarian, Omnivore',
    );
    expect(ops.filter((o) => o.kind === "required").map((o) => [o.key, o.votes, o.voters])).toEqual(
      expect.arrayContaining([
        ["name", 1, 4],
        ["diet", 1, 3],
      ]),
    );
  });

  it("never proposes a change to a locked field", () => {
    const ops = findDisagreements(schema, [
      { fields: [name, now] },
      { fields: [name, now, { ...notes, required: true }] },
    ]);
    expect(ops.filter((o) => o.key === "notes")).toEqual([]);
  });
});

describe("opsPatch / composeProbes", () => {
  const wider = diet(["Vegan", "Vegetarian", "Omnivore"]);
  const ops = findDisagreements(schema, [
    { fields: [name, { ...wider, required: true }, notes, draft("allergies", "Allergies")] },
    { fields: [name, { ...wider, required: true }, notes] },
    { fields: [name, now, notes, draft("allergies", "Allergies")] },
    { fields: [name, now, notes] },
  ]);
  const ref = (kind: string) => ops.find((o) => o.kind === kind)!.ref;

  it("merges two changes to one field into a single update that keeps the rest", () => {
    const patch = opsPatch(ops.filter((o) => o.key === "diet"));
    expect(patch.updateFields).toHaveLength(1);
    const { schema: after } = applySchemaPatch(schema, patch);
    const updated = after.fields.find((f) => f.name === "diet")!;
    expect(updated.required).toBe(true);
    expect(updated.label).toBe("Diet");
    expect(updated.type).toMatchObject({
      kind: "select",
      // Stored values survive for labels that stayed
      options: [
        { label: "Vegan", value: "vegan" },
        { label: "Vegetarian", value: "Vegetarian" },
        { label: "Omnivore", value: "omni" },
      ],
    });
  });

  it("builds previews from the ops and validates what the wording model returned", () => {
    const probes = composeProbes(
      schema,
      ops,
      [
        {
          text: "Ask about allergies?",
          options: [
            { value: "yes", label: "Yes", ops: [ref("add")] },
            { value: "yes", label: "Yes again", ops: [ref("add")] },
            { value: "no", label: "No", ops: [] },
          ],
        },
        // Reuses an op another probe already decides → dropped entirely
        { text: "Allergies, again?", options: [{ value: "y", label: "Yes", ops: [ref("add")] }] },
        // Decides nothing
        { text: "Anything else?", options: [{ value: "a", label: "A", ops: [] }] },
        {
          text: "Offer vegetarian?",
          options: [{ value: "yes", label: "Add it", ops: [ref("options"), "zz9"] }, { value: "both", label: "Add, and require", ops: [ref("options"), ref("required")] }],
        },
      ],
      5,
    );

    expect(probes.map((p) => p.text)).toEqual(["Ask about allergies?", "Offer vegetarian?"]);
    const [allergies, vegetarian] = probes;
    expect(allergies.options.map((o) => o.value)).toEqual(["yes", "no"]);
    expect(allergies.options[0].preview.scope).toEqual({
      added: ["allergies"],
      updated: [],
      removed: [],
    });
    expect(allergies.priority).toBe(1);

    // The option naming an unknown op is gone; keep-as-is was added
    expect(vegetarian.options.map((o) => o.value)).toEqual(["both", "keepAsIs"]);
    expect(vegetarian.options[0].preview.scope!.updated).toEqual(["diet"]);
    expect(vegetarian.priority).toBe(3);
  });
});
