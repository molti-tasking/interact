// @vitest-environment node
/**
 * The per-turn measures of the `assistant` arm: question sentences in a
 * reply (a documented, deterministic heuristic) and the size of a patch.
 */
import { describe, expect, it } from "vitest";
import { countQuestionSentences, patchOperationCount } from "@/lib/study/assistant-metrics";

describe("countQuestionSentences", () => {
  it.each([
    ["", 0],
    ["I added a field for the child's name.", 0],
    ["What age range are the children?", 1],
    ["What age range? And which days can they attend?", 2],
    ["Before I build it: who fills it in? Parents, I assume.", 1],
    ["Really?!", 1],
    ["??", 0],
    ["Is that right?)", 1],
    ["(Is that right?)", 1],
    ["**Which ground does the child attend?**", 1],
    ['You wrote "Is it free?" earlier.', 1],
    ["A few things to settle:\n- Which days?\n- Who collects the child?\n- Photos allowed?", 3],
    ["1. Name\n2. Age\n3. Allergies", 0],
    ["See https://example.org/form?id=3 for an example.", 0],
    ["Let me know which days.", 0],
    ["Hmm… what do you think?", 1],
    ["Version 1.5? Sure.", 1],
    ["Möchten Sie das Feld?", 1],
    ["全角の質問ですか？", 1],
  ])("%j → %i", (text, expected) => {
    expect(countQuestionSentences(text)).toBe(expected);
  });

  it("is deterministic", () => {
    const text = "Which days? I added the name field. Should photos be optional?";
    expect(countQuestionSentences(text)).toBe(countQuestionSentences(text));
    expect(countQuestionSentences(text)).toBe(2);
  });
});

describe("patchOperationCount", () => {
  const field = { key: "childName", label: "Child's name", type: "string" } as never;

  it("is null without a patch", () => {
    expect(patchOperationCount(null)).toBeNull();
    expect(patchOperationCount(undefined)).toBeNull();
  });

  it("is 0 for a patch that names nothing", () => {
    expect(patchOperationCount({})).toBe(0);
    expect(patchOperationCount({ addFields: [], removeFieldKeys: [] })).toBe(0);
  });

  it("counts added, updated, removed fields and section placements", () => {
    expect(
      patchOperationCount({
        addFields: [field, field],
        updateFields: [{ key: "age" } as never],
        removeFieldKeys: ["tshirt"],
        sections: [{ title: "Child", fieldKeys: ["childName"] }],
      }),
    ).toBe(5);
  });
});
