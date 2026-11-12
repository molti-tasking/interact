/**
 * Creating a derived form from the model's derivation: the projection
 * records the base fields it includes by id, the form links to its base,
 * and its trail starts with who derived it and for what.
 */
import { derivedPortfolio } from "@/lib/derivation";
import type { Field, PortfolioSchema } from "@/lib/types";
import { describe, expect, it } from "vitest";

const field = (name: string): Field => ({
  id: `f-${name}`,
  name,
  label: name,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});
const base = { id: "base-1", title: "Sales application", space_id: "space-1" };
const parentSchema: PortfolioSchema = {
  fields: [field("name"), field("email"), field("coverLetter")],
  groups: [],
  version: 3,
};

describe("derivedPortfolio", () => {
  it("records the projection, the base and the first trail entry", () => {
    const linkedin = { ...field("linkedin"), id: "f-new" };
    const result = derivedPortfolio(
      base,
      parentSchema,
      {
        derivationType: "mixed",
        includedFieldKeys: ["name", "email"],
        additionalFields: [linkedin],
        schema: { fields: [field("name"), field("email"), linkedin], groups: [], version: 1 },
        derivedPurpose: "Phone screen",
      },
      "  Phone screen with contact details  ",
      "Sarah (Founder)",
      new Date("2026-11-12T10:00:00Z"),
    );
    expect(result.base_id).toBe("base-1");
    expect(result.space_id).toBe("space-1");
    expect(result.title).toBe("Sales application — Phone screen with contact details");
    expect(result.projection).toEqual({
      type: "mixed",
      scenarioIntent: "Phone screen with contact details",
      includedFieldIds: ["f-name", "f-email"],
      additionalFields: [linkedin],
      fieldMappings: {},
    });
    expect(result.intent.purpose).toEqual({
      content: "Phone screen",
      updatedAt: "2026-11-12T10:00:00.000Z",
    });
    expect(result.derivation).toEqual({
      actor: "Sarah (Founder)",
      rationale: 'Derived from "Sales application" for: Phone screen with contact details',
    });
  });
});
