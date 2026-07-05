import { describe, expect, it } from "vitest";
import {
  applyExclusions,
  computeDelta,
  determinePipelineStrategy,
  parseFromMarkdown,
  serializeToMarkdown,
} from "@/lib/engine/structured-intent";
import {
  emptyPortfolioSchema,
  emptyStructuredIntent,
  type PortfolioSchema,
  type StructuredIntent,
} from "@/lib/types";

function intentWith(sections: Partial<Record<keyof StructuredIntent, string>>) {
  const intent = emptyStructuredIntent();
  for (const [key, content] of Object.entries(sections)) {
    intent[key as keyof StructuredIntent] = {
      content: content ?? "",
      updatedAt: "2026-01-01T00:00:00Z",
    };
  }
  return intent;
}

describe("pipeline strategy for routed voice utterances", () => {
  const baseSchema: PortfolioSchema = {
    ...emptyPortfolioSchema(),
    fields: [
      {
        id: "f1",
        name: "email",
        label: "Email",
        type: { kind: "text" },
        required: true,
        constraints: [],
        origin: "system",
        tags: [],
      },
    ],
  };

  it("an exclusions-only change picks the deterministic filter (no LLM)", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const next = intentWith({
      purpose: "Collect feedback",
      exclusions: "email, phone",
    });
    const delta = computeDelta(prev, next);
    expect(determinePipelineStrategy(delta, baseSchema.fields.length > 0)).toEqual(
      { kind: "filter-only" },
    );
  });

  it("a constraints-only change only re-checks conflicts", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const next = intentWith({
      purpose: "Collect feedback",
      constraints: "GDPR compliant",
    });
    const delta = computeDelta(prev, next);
    expect(determinePipelineStrategy(delta, true)).toEqual({
      kind: "recheck-constraints",
    });
  });

  it("a purpose change triggers the full pipeline", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const next = intentWith({ purpose: "Collect detailed feedback" });
    const delta = computeDelta(prev, next);
    expect(determinePipelineStrategy(delta, true)).toEqual({ kind: "full" });
  });

  it("an unchanged intent is a noop", () => {
    const prev = intentWith({ purpose: "Collect feedback" });
    const delta = computeDelta(prev, intentWith({ purpose: "Collect feedback" }));
    expect(determinePipelineStrategy(delta, true)).toEqual({ kind: "noop" });
  });

  it("exclusion keywords remove matching fields deterministically", () => {
    const filtered = applyExclusions(baseSchema, "email");
    expect(filtered.fields).toHaveLength(0);
    expect(filtered.version).toBe(baseSchema.version + 1);
  });
});

describe("markdown projection", () => {
  it("keeps voice-appended purpose out of other sections on round-trip", () => {
    const intent = intentWith({
      purpose: "Collect feedback.\n\nAlso ask about delivery.",
      constraints: "Anonymous only",
    });
    const markdown = serializeToMarkdown(intent);
    const parsed = parseFromMarkdown(markdown, intent);
    expect(parsed.purpose.content).toContain("Also ask about delivery.");
    expect(parsed.constraints.content).toBe("Anonymous only");
  });
});
