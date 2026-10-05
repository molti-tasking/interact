import { describe, expect, it } from "vitest";
import {
  matchReference,
  referenceEntryFieldName,
  referenceLabelFor,
  resolveReferenceMatch,
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

  it("matches labels that differ only in spacing", () => {
    expect(matchReference("super glue 50 ml", candidates)?.responseId).toBe(
      "r1",
    );
  });
});

describe("resolveReferenceMatch", () => {
  it("only matches on whole tokens", () => {
    const rows: ReferenceCandidate[] = [
      { responseId: "p", label: "Pink hoodie" },
    ];
    expect(resolveReferenceMatch("ink", rows)).toEqual({ kind: "none" });
  });

  it("reports ties as ambiguous instead of taking the first row", () => {
    const rows: ReferenceCandidate[] = [
      { responseId: "b1", label: "Blue Beanie" },
      { responseId: "b2", label: "Blue Scarf" },
    ];
    const result = resolveReferenceMatch("blue", rows);
    expect(result.kind).toBe("ambiguous");
    expect(
      result.kind === "ambiguous" && result.candidates.map((c) => c.responseId),
    ).toEqual(["b1", "b2"]);
  });

  it("is independent of the order rows come back in", () => {
    const rows: ReferenceCandidate[] = [
      { responseId: "long", label: "Blue Beanie with Pom Pom" },
      { responseId: "short", label: "Blue Beanie" },
    ];
    expect(matchReference("the blue beanie", rows)?.responseId).toBe("short");
    expect(matchReference("the blue beanie", [...rows].reverse())?.responseId).toBe(
      "short",
    );
  });

  it("prefers the closest token overlap among contained labels", () => {
    const rows: ReferenceCandidate[] = [
      { responseId: "a", label: "Hoodie" },
      { responseId: "b", label: "Hoodie pink" },
    ];
    expect(matchReference("pink hoodie", rows)?.responseId).toBe("b");
  });

  it("treats rows with identical labels as ambiguous", () => {
    const rows: ReferenceCandidate[] = [
      { responseId: "x1", label: "Blue Beanie" },
      { responseId: "x2", label: "blue beanie" },
    ];
    expect(resolveReferenceMatch("Blue Beanie", rows).kind).toBe("ambiguous");
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
