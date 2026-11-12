import { describe, expect, it } from "vitest";
import { applyProbeOption } from "../src/forms/guards";
import {
  INTENT_EDIT_QUESTION,
  intentEditQuestion,
} from "../src/forms/intent-refinement";
import { field, schema } from "./helpers";

describe("an intent edit's form changes, as a question (1E)", () => {
  const base = schema("name", "age", "notes");
  const patch = {
    addFields: [{ key: "school", label: "School", type: "string" as const, required: true }],
    updateFields: [{ key: "age", required: true }],
    removeFieldKeys: ["notes"],
  };

  it("offers the changes with their preview and scope, and keeping the form", () => {
    const q = intentEditQuestion(base, patch, "Adds the school, makes age required")!;
    expect(q.text).toBe(INTENT_EDIT_QUESTION);
    expect(q.explanation).toBe("Adds the school, makes age required");
    const [apply, keep] = q.options;
    expect(apply.preview.scope).toEqual({ added: ["school"], updated: ["age"], removed: ["notes"] });
    expect(apply.preview.schemaPatch).toBe(patch);
    expect(keep.unchanged).toBe(true);
    expect(applyProbeOption(base, keep.preview).changed).toBe(false);
  });

  it("applied later, touches only what its preview showed", () => {
    const apply = intentEditQuestion(base, patch, "…")!.options[0];
    // Meanwhile the creator added their own "school" field and removed "age"
    const later = {
      ...base,
      fields: [field("name"), field("notes"), field("school", { label: "My school" })],
    };
    const { schema: next } = applyProbeOption(later, apply.preview);
    // The add would now overwrite the creator's field: dropped. "age" is gone
    // and must not come back. "notes" is removed as previewed.
    expect(next.fields.map((f) => [f.name, f.label])).toEqual([
      ["name", "Name"],
      ["school", "My school"],
    ]);
  });

  it("is no question when the patch changes nothing", () => {
    expect(intentEditQuestion(base, { removeFieldKeys: ["unknown"] }, "Nothing")).toBeNull();
    expect(intentEditQuestion(base, {}, "")).toBeNull();
  });
});
