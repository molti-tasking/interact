/**
 * Applying a pre-computed answer, as a change function: the patch replayed
 * on the latest state within its preview's scope, never on locked fields,
 * with the question and the answer as rationale.
 */
import { answerChange } from "@/lib/engine/answer-change";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

const field = (name: string, extra: Partial<Field> = {}): Field => ({
  id: `f-${name}`,
  name,
  label: name,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
  ...extra,
});

const portfolio = (schema: PortfolioSchema) => ({ schema }) as Portfolio;
const question = { text: "Ask for a phone number?" };

describe("answerChange", () => {
  it("commits the previewed patch as the creator's answer", () => {
    const change = answerChange(
      question,
      {
        label: "Yes",
        preview: {
          summary: "Adds phone",
          schemaPatch: { addFields: [{ key: "phone", label: "Phone", type: "string", required: false }] },
          scope: { added: ["phone"], updated: [], removed: [] },
        },
      },
      "Ada (Coach)",
    );
    const result = change(portfolio({ fields: [field("name")], groups: [], version: 1 }))!;
    expect(result.trigger).toBe("answer");
    expect(result.automated).toBe(true);
    expect(result.schema!.fields.map((f) => f.name)).toEqual(["name", "phone"]);
    expect(result.provenance).toMatchObject({
      action: "design_probe_resolved",
      actor: "Ada (Coach)",
      rationale: '"Ask for a phone number?" → "Yes"',
    });
  });

  it("drops what the preview didn't show, and leaves locked fields alone", () => {
    const change = answerChange(question, {
      label: "Tidy up",
      preview: {
        summary: "Removes notes",
        // The patch also touches "name", which the preview's scope doesn't name
        schemaPatch: { removeFieldKeys: ["notes", "name"], updateFields: [{ key: "age", required: true }] },
        scope: { added: [], updated: ["age"], removed: ["notes", "name"] },
      },
    }, "Ada");
    const schema: PortfolioSchema = {
      fields: [field("name"), field("notes"), field("age", { locked: true })],
      groups: [],
      version: 1,
    };
    const next = change(portfolio(schema))!.schema!;
    // "name" is in scope and goes; the locked "age" stays as it was
    expect(next.fields.map((f) => f.name)).toEqual(["age"]);
    expect(next.fields[0].required).toBe(false);
  });

  it("writes nothing when the answer changes nothing on the latest state", () => {
    const change = answerChange(question, {
      label: "Drop notes",
      preview: {
        summary: "Removes notes",
        schemaPatch: { removeFieldKeys: ["notes"] },
        scope: { added: [], updated: [], removed: ["notes"] },
      },
    }, "Ada");
    // Someone removed "notes" meanwhile
    expect(change(portfolio({ fields: [field("name")], groups: [], version: 2 }))).toBeNull();
  });
});
