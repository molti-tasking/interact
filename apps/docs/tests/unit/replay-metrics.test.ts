import { describe, expect, it } from "vitest";
import {
  committeeStats,
  fieldsBeyondSummary,
  patchOpStats,
  percentile,
  purposePreservation,
  readyPreviewShare,
  replaySpill,
  schemaChange,
  sentences,
  unmentionedChanges,
  unwantedChanges,
} from "interact/forms/replay-metrics";
import { applySchemaPatch, type SchemaPatch } from "interact/forms/schema-patch";
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

const schema: PortfolioSchema = {
  fields: [
    field("name", { label: "Full name", required: true }),
    field("age", { label: "Age", type: { kind: "number", min: 0, max: 120 } }),
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
  groups: [{ id: "g1", label: "About you", fieldIds: ["f-name", "f-age"] }],
  version: 1,
};

const apply = (patch: SchemaPatch, on = schema) => applySchemaPatch(on, patch).schema;

describe("schemaChange", () => {
  it("names added and removed fields and the properties that changed", () => {
    const after = apply({
      addFields: [{ key: "goal", label: "Goal", type: "string", required: false }],
      removeFieldKeys: ["age"],
      updateFields: [
        { key: "name", label: "Your name", required: false },
        { key: "diet", validation: { options: [{ label: "Vegan", value: "vegan" }, { label: "Other", value: "other" }] } },
      ],
    });
    expect(schemaChange(schema, after)).toEqual({
      added: ["goal"],
      removed: ["age"],
      updated: { name: ["label", "required"], diet: ["options"] },
    });
  });

  it("sees a move between sections", () => {
    const after = apply({ sections: [{ title: "Food", fieldKeys: ["diet"] }] });
    expect(schemaChange(schema, after).updated).toEqual({ diet: ["section"] });
  });
});

describe("patchOpStats", () => {
  it("counts ops the form refused: unknown keys and locked fields", () => {
    const stats = patchOpStats(schema, {
      addFields: [{ key: "goal", label: "Goal", type: "string", required: false }],
      updateFields: [{ key: "ghost", label: "Ghost" }, { key: "notes", required: true }],
      removeFieldKeys: ["phone", "age"],
    });
    expect(stats).toEqual({ ops: 5, applied: 2, skippedUnknown: 2, skippedLocked: 1 });
  });
});

describe("unmentionedChanges", () => {
  it("is empty for a partial update that changes only what it names", () => {
    expect(
      unmentionedChanges(schema, { updateFields: [{ key: "name", required: false, label: null }] }),
    ).toEqual([]);
  });

  it("counts a type change's new details as named", () => {
    // The number's range goes with its type; the label is named as well
    expect(
      unmentionedChanges(schema, { updateFields: [{ key: "age", type: "string", label: "Age group" }] }),
    ).toEqual([]);
  });

  it("flags what an add does to an existing field of the same key", () => {
    // The patch meant to add a field; the key was taken, so it rewrote one
    expect(
      unmentionedChanges(schema, {
        addFields: [{ key: "name", label: "Name of your dog", type: "string", required: false }],
      }),
    ).toEqual([{ key: "name", properties: ["label", "required"] }]);
  });

  it("doesn't count fields that merely share a section with a removed one", () => {
    expect(unmentionedChanges(schema, { removeFieldKeys: ["age"] })).toEqual([]);
  });
});

describe("fieldsBeyondSummary", () => {
  const after = apply({
    addFields: [
      { key: "sessionLength", label: "Session length", type: "number", required: false },
      { key: "trainingGoal", label: "Training goal", type: "string", required: false },
    ],
    updateFields: [{ key: "age", required: true }],
  });

  it("accepts a summary that names every field it touches", () => {
    expect(fieldsBeyondSummary("Adds session length and goal; age now required", schema, after)).toEqual([]);
  });

  it("lists the fields a summary leaves out", () => {
    expect(fieldsBeyondSummary("Adds session length and goal fields", schema, after)).toEqual(["age"]);
  });
});

describe("replaySpill", () => {
  const preview = {
    schemaPatch: {
      addFields: [{ key: "goal", label: "Goal", type: "string" as const, required: false }],
      updateFields: [{ key: "age", required: true }],
    },
    scope: { added: ["goal"], updated: ["age"], removed: [] },
  };

  it("reports nothing when the form hasn't changed", () => {
    expect(replaySpill(schema, preview, schema)).toEqual({
      unscoped: [],
      scoped: [],
      dropped: [],
      locked: [],
    });
  });

  it("keeps a replay inside what the preview showed", () => {
    // Meanwhile the creator added their own "goal" field: the preview's add
    // would now overwrite it. Scoping drops the add instead.
    const later = apply({
      addFields: [{ key: "goal", label: "Goal for this year", type: "string", required: true }],
    });
    const spill = replaySpill(schema, preview, later);
    expect(spill.scoped).toEqual([]);
    expect(spill.dropped).toEqual(["goal"]);
    expect(later.fields.find((f) => f.name === "goal")!.label).toBe("Goal for this year");
  });

  it("counts what an unscoped patch would have spilled onto", () => {
    // A preview from before scoping that also restated another field
    const old = {
      schemaPatch: {
        updateFields: [
          { key: "age", required: true },
          { key: "diet", label: "Diet", type: "select" as const, required: true },
        ],
      },
      scope: { added: [], updated: ["age"], removed: [] },
    };
    const spill = replaySpill(schema, old, schema);
    expect(spill.unscoped).toEqual(["diet"]);
    expect(spill.scoped).toEqual([]);
    expect(spill.dropped).toEqual(["diet"]);
  });

  it("derives the scope from the base form for previews recorded without one", () => {
    const later = apply({ addFields: [{ key: "goal", label: "Mine", type: "string", required: false }] });
    const spill = replaySpill(schema, { schemaPatch: preview.schemaPatch }, later);
    expect(spill.dropped).toEqual(["goal"]);
    expect(spill.scoped).toEqual([]);
  });
});

describe("unwantedChanges", () => {
  const after = apply({
    addFields: [{ key: "goal", label: "Goal", type: "string", required: false }],
    updateFields: [{ key: "age", required: true }],
    removeFieldKeys: ["diet"],
  });

  it("lists existing fields changed outside what the case allows", () => {
    expect(unwantedChanges(schema, after, { mayChange: ["age"] })).toEqual(["diet"]);
    expect(unwantedChanges(schema, after, { mayChange: [] }).sort()).toEqual(["age", "diet"]);
    expect(unwantedChanges(schema, after, { mustKeep: ["diet", "name"] })).toEqual(["diet"]);
  });

  it("covers additions and no-change expectations", () => {
    expect(unwantedChanges(schema, after, { mayAdd: false })).toEqual(["goal"]);
    expect(unwantedChanges(schema, after, { noFormChange: true }).sort()).toEqual(["age", "diet", "goal"]);
    expect(unwantedChanges(schema, schema, { noFormChange: true })).toEqual([]);
  });
});

describe("purposePreservation", () => {
  const before = "A sign-up form for our running group. We need to know who's coming! Bring water.";

  it("splits text into sentences and list lines", () => {
    expect(sentences("One. Two!\n- three\nFour?")).toEqual(["One.", "Two!", "- three", "Four?"]);
  });

  it("passes an append", () => {
    const kept = purposePreservation(before, `${before} It also asks for the usual pace.`);
    expect(kept).toMatchObject({ sentences: 3, lost: [], preserved: true });
    expect(kept.grownBy).toBeGreaterThan(0);
  });

  it("passes a replace of the sentence the edit named, and only that", () => {
    const after = "A sign-up form for our running group. We need names and paces. Bring water.";
    expect(purposePreservation(before, after, "We need to know who's coming!").preserved).toBe(true);
    expect(purposePreservation(before, after).lost).toEqual(["We need to know who's coming!"]);
  });

  it("catches a rewrite", () => {
    const kept = purposePreservation(
      before,
      "This form collects sign-ups for a running group, including attendance and hydration reminders.",
      "We need to know who's coming!",
    );
    expect(kept.preserved).toBe(false);
    expect(kept.lost).toEqual(["A sign-up form for our running group.", "Bring water."]);
  });
});

describe("committee and small statistics", () => {
  it("averages vote entropy and counts unanimous ops", () => {
    const stats = committeeStats([
      { votes: 2, voters: 4 },
      { votes: 4, voters: 4 },
    ]);
    expect(stats).toEqual({ ops: 2, meanEntropy: 0.5, unanimous: 1 });
    expect(committeeStats([])).toEqual({ ops: 0, meanEntropy: 0, unanimous: 0 });
  });

  it("measures how many probes arrive with every preview ready", () => {
    expect(
      readyPreviewShare([
        { options: [{ preview: {} }, { preview: {} }] },
        { options: [{ preview: {} }, {}] },
      ]),
    ).toBe(0.5);
    expect(readyPreviewShare([])).toBe(0);
  });

  it("takes nearest-rank percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });
});
