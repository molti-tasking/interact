import { describe, expect, it } from "vitest";
import {
  matchReference,
  referenceEntryFieldName,
  referenceLabelFor,
  type ReferenceCandidate,
} from "@/lib/voice/reference-resolution";
import { emptyPortfolioSchema, type PortfolioSchema } from "@/lib/types";

const productSchema: PortfolioSchema = {
  ...emptyPortfolioSchema(),
  fields: [
    {
      id: "p1",
      name: "sku",
      label: "SKU",
      type: { kind: "number" },
      required: false,
      constraints: [],
      origin: "system",
      tags: [],
    },
    {
      id: "p2",
      name: "productName",
      label: "Product name",
      type: { kind: "text" },
      required: true,
      constraints: [],
      origin: "system",
      tags: [],
    },
  ],
};

const candidates: ReferenceCandidate[] = [
  { responseId: "r1", label: "SuperGlue 50ml" },
  { responseId: "r2", label: "Blue Beanie" },
  { responseId: "r3", label: "Cotton T-Shirt (black)" },
];

describe("matchReference", () => {
  it("matches exact labels ignoring case and punctuation", () => {
    expect(matchReference("superglue 50ml", candidates)?.responseId).toBe("r1");
    expect(
      matchReference("cotton t-shirt black", candidates)?.responseId,
    ).toBe("r3");
  });

  it("matches by containment either way", () => {
    expect(matchReference("the Blue Beanie", candidates)?.responseId).toBe(
      "r2",
    );
    expect(matchReference("beanie", candidates)?.responseId).toBe("r2");
  });

  it("matches by token overlap", () => {
    expect(matchReference("superglue 50ml tube", candidates)?.responseId).toBe(
      "r1",
    );
  });

  it("returns null when nothing clears the bar", () => {
    expect(matchReference("wooden pallet", candidates)).toBeNull();
    expect(matchReference("", candidates)).toBeNull();
  });
});

describe("referenceLabelFor", () => {
  it("prefers the configured display field", () => {
    const label = referenceLabelFor(
      productSchema,
      { sku: 42, productName: "SuperGlue", note: "misc" },
      "note",
    );
    expect(label).toBe("misc");
  });

  it("falls back to the first text field with a value", () => {
    const label = referenceLabelFor(productSchema, {
      sku: 42,
      productName: "SuperGlue",
    });
    expect(label).toBe("SuperGlue");
  });

  it("returns null when no string value exists", () => {
    expect(referenceLabelFor(productSchema, { sku: 42 })).toBeNull();
  });
});

describe("referenceEntryFieldName", () => {
  it("uses the display field when it is a text field", () => {
    expect(referenceEntryFieldName(productSchema, "productName")).toBe(
      "productName",
    );
  });

  it("ignores a non-text display field and falls back to the first text field", () => {
    expect(referenceEntryFieldName(productSchema, "sku")).toBe("productName");
  });

  it("returns null when the schema has no text field", () => {
    const numbersOnly: PortfolioSchema = {
      ...emptyPortfolioSchema(),
      fields: [productSchema.fields[0]],
    };
    expect(referenceEntryFieldName(numbersOnly)).toBeNull();
  });
});
