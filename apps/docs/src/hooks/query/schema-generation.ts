"use client";

import { dimensionsToSchemaAction } from "@/app/actions/dimension-actions";
import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { createClient } from "@/lib/supabase/client";
import type { PortfolioSchema } from "@/lib/types";
import { emptyPortfolioSchema } from "@/lib/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Generate a schema from dimensions and accepted standards,
 * then persist to portfolio.
 */
export function useGenerateSchema(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dimensions,
      intent,
      currentSchema,
      acceptedStandards,
    }: {
      dimensions: DimensionObject[];
      intent: string;
      currentSchema: PortfolioSchema;
      acceptedStandards?: DetectedStandard[];
    }) => {
      const result = await dimensionsToSchemaAction(
        dimensions,
        intent,
        acceptedStandards?.length ? acceptedStandards : undefined,
      );

      if (!result.success || !result.result) {
        throw new Error(result.error ?? "Failed to generate schema");
      }

      const newIntent = result.result.basePrompt || intent;
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
          intent: newIntent,
          schema: JSON.parse(JSON.stringify(newSchema)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolioId);

      if (error) throw error;

      // Log provenance
      await logProvenance(
        portfolioId,
        "dimensions",
        "schema_generated",
        "system",
        schemaDiff,
        `Generated ${newSchema.fields.length} fields from ${dimensions.length} dimensions`,
        { intent, schema: currentSchema },
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
