"use client";

import { intentToSchemaAction } from "@/app/actions/schema-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { mergeRegeneratedSchema } from "@/lib/engine/schema-patch";
import type { StructuredIntent } from "@/lib/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyCommitToCache } from "./portfolios";

/**
 * Generate a schema from the structured intent and accepted standards, then
 * fold it into the portfolio's current schema (field ids, creator-authored
 * fields, accepted standards and column actions survive regeneration).
 */
export function useGenerateSchema(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      acceptedStandards,
    }: {
      intent: StructuredIntent;
      acceptedStandards?: DetectedStandard[];
    }) => {
      const result = await intentToSchemaAction(
        intent,
        acceptedStandards?.length ? acceptedStandards : undefined,
      );

      if (!result.success || !result.result) {
        throw new Error(result.error ?? "Failed to generate schema");
      }

      const generated = result.result.artifactFormSchema;

      return commitPortfolioChange(portfolioId, (current) => ({
        schema: mergeRegeneratedSchema(current.schema, generated),
        provenance: {
          layer: "configuration",
          action: "schema_generated",
          actor: "system",
          rationale: `Generated ${generated.fields.length} fields from intent`,
        },
      }));
    },
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}
