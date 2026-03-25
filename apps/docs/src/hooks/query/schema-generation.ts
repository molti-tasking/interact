"use client";

import { intentToSchemaAction } from "@/app/actions/schema-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { createClient } from "@/lib/supabase/client";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { emptyPortfolioSchema } from "@/lib/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Generate a schema from the structured intent and accepted standards,
 * then persist to portfolio.
 */
export function useGenerateSchema(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent: newIntent,
      currentSchema,
      acceptedStandards,
    }: {
      intent: StructuredIntent;
      currentSchema: PortfolioSchema;
      acceptedStandards?: DetectedStandard[];
    }) => {
      const result = await intentToSchemaAction(
        newIntent,
        acceptedStandards?.length ? acceptedStandards : undefined,
      );

      if (!result.success || !result.result) {
        throw new Error(result.error ?? "Failed to generate schema");
      }

      const newSchema = result.result.artifactFormSchema;
      const schemaDiff = diffSchemas(
        currentSchema.fields.length > 0
          ? currentSchema
          : emptyPortfolioSchema(),
        newSchema,
      );

      // Persist to portfolio
      const supabase = createClient();
      const { error } = await supabase
        .from("portfolios")
        .update({
          intent: JSON.parse(JSON.stringify(newIntent)),
          schema: JSON.parse(JSON.stringify(newSchema)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolioId);

      if (error) throw error;

      // Log provenance
      await logProvenance(
        portfolioId,
        "configuration",
        "schema_generated",
        "system",
        schemaDiff,
        `Generated ${newSchema.fields.length} fields from intent`,
        { intent: newIntent, schema: currentSchema },
      );

      return { intent: newIntent, schema: newSchema };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portfolios", portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ["provenance", portfolioId],
      });
    },
  });
}
