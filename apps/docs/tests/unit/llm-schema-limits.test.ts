import { conflictChangesSchema } from "@/lib/engine/conflict-changes";
import {
  dashboardSuggestionSchema,
  widgetRevisionSchema,
} from "@/lib/engine/dashboard";
import { schemaPatchSchema } from "@/lib/engine/form-model";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The provider rejects structured outputs with more than 24 optional
 * parameters ("would make grammar compilation inefficient") — every probe
 * answer, preview, refine and conflict fix would fail. Shared schemas are
 * embedded in larger responses, so they keep some headroom.
 */
const PROVIDER_LIMIT = 24;

type JsonSchema = {
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
};

function countOptional(schema: JsonSchema): number {
  let count = 0;
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    if (!schema.required?.includes(key)) count++;
    count += countOptional(child);
  }
  if (schema.items) count += countOptional(schema.items);
  for (const option of schema.anyOf ?? []) count += countOptional(option);
  return count;
}

const optionalCount = (schema: z.ZodType) =>
  countOptional(z.toJSONSchema(schema) as JsonSchema);

describe("structured output size", () => {
  it("leaves room in schema patches for the responses that embed them", () => {
    // Preview and resolve responses add an optional follow-up question
    expect(optionalCount(schemaPatchSchema) + 1).toBeLessThanOrEqual(PROVIDER_LIMIT);
  });

  it("keeps dashboard suggestions free of optional parameters", () => {
    expect(optionalCount(dashboardSuggestionSchema)).toBe(0);
    expect(optionalCount(widgetRevisionSchema)).toBe(0);
  });

  it("keeps conflict fixes within the limit", () => {
    expect(optionalCount(conflictChangesSchema)).toBeLessThanOrEqual(PROVIDER_LIMIT);
  });
});
