"use client";

import type { DetectedStandard } from "@/lib/domain-standards";
import {
  applyExclusions,
  computeDelta,
  determinePipelineStrategy,
  serializeForLLM,
} from "@/lib/engine/structured-intent";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { createClient } from "@/lib/supabase/client";
import type { PortfolioSchema, PipelineStrategy, StructuredIntent } from "@/lib/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useGenerateDesignProbes } from "./design-probes";
import { useGenerateSchema } from "./schema-generation";
import { useDetectStandards } from "./standards";

export interface PipelineResult {
  strategy: PipelineStrategy;
  intent: StructuredIntent;
  schema?: PortfolioSchema;
}

/**
 * Smart pipeline orchestrator that replaces the monolithic handleGenerate.
 *
 * Computes what changed in the structured intent, determines the minimal
 * pipeline strategy, and executes only the necessary work.
 */
export function usePipelineGenerate(portfolioId: string) {
  const queryClient = useQueryClient();
  const generateSchema = useGenerateSchema(portfolioId);
  const generateDesignProbes = useGenerateDesignProbes(portfolioId);
  const detectStandards = useDetectStandards(portfolioId);

  return useMutation({
    mutationFn: async ({
      previousIntent,
      currentIntent,
      currentSchema,
      actor = "creator",
    }: {
      previousIntent: StructuredIntent;
      currentIntent: StructuredIntent;
      currentSchema: PortfolioSchema;
      actor?: string;
    }): Promise<PipelineResult> => {
      const delta = computeDelta(previousIntent, currentIntent);
      const hasExistingSchema = currentSchema.fields.length > 0;
      const strategy = determinePipelineStrategy(delta, hasExistingSchema);

      switch (strategy.kind) {
        case "noop":
          return { strategy, intent: currentIntent };

        case "full": {
          // Save intent first
          const supabase = createClient();
          await supabase
            .from("portfolios")
            .update({
              intent: JSON.parse(JSON.stringify(currentIntent)),
              updated_at: new Date().toISOString(),
            })
            .eq("id", portfolioId);

          // Log intent update if changed
          if (delta.changedSections.length > 0) {
            await logProvenance(
              portfolioId,
              "intent",
              "intent_updated",
              actor,
              { added: [], removed: [], modified: [] },
              `Sections changed: ${delta.changedSections.join(", ")}`,
              { intent: previousIntent, schema: currentSchema },
            );
          }

          // Step 1: Detect standards (keyword-based, no LLM)
          const intentText = serializeForLLM(currentIntent);
          const standardsResult = await detectStandards.mutateAsync(intentText);

          // Step 2: Filter accepted standards
          const acceptedStandardRefs = currentSchema.acceptedStandards ?? [];
          const acceptedStandards = (standardsResult ?? []).filter(
            (s: DetectedStandard) =>
              acceptedStandardRefs.some(
                (ref) => ref.standardId === s.standard.id,
              ),
          );

          // Step 3: Generate schema directly from intent
          const schemaResult = await generateSchema.mutateAsync({
            intent: currentIntent,
            currentSchema,
            acceptedStandards:
              acceptedStandards.length > 0 ? acceptedStandards : undefined,
          });

          // Step 4: Generate design probes (fire-and-forget)
          generateDesignProbes.mutate({
            intent: schemaResult.intent,
            acceptedStandards:
              acceptedStandards.length > 0 ? acceptedStandards : undefined,
          });

          return {
            strategy,
            intent: schemaResult.intent,
            schema: schemaResult.schema,
          };
        }

        case "filter-only": {
          // Deterministic field filtering — no LLM needed
          const filteredSchema = applyExclusions(
            currentSchema,
            currentIntent.exclusions.content,
          );
          const filterDiff = diffSchemas(currentSchema, filteredSchema);

          // Persist
          const supabase = createClient();
          await supabase
            .from("portfolios")
            .update({
              intent: JSON.parse(JSON.stringify(currentIntent)),
              schema: JSON.parse(JSON.stringify(filteredSchema)),
              updated_at: new Date().toISOString(),
            })
            .eq("id", portfolioId);

          await logProvenance(
            portfolioId,
            "configuration",
            "exclusions_applied",
            actor,
            filterDiff,
            `Applied exclusions: ${currentIntent.exclusions.content.trim()}`,
            { intent: previousIntent, schema: currentSchema },
          );

          return { strategy, intent: currentIntent, schema: filteredSchema };
        }

        case "recheck-constraints": {
          // Save updated intent and invalidate conflict detection
          const supabase = createClient();
          await supabase
            .from("portfolios")
            .update({
              intent: JSON.parse(JSON.stringify(currentIntent)),
              updated_at: new Date().toISOString(),
            })
            .eq("id", portfolioId);

          // Invalidate conflicts so useDetectConflicts re-runs
          queryClient.invalidateQueries({
            queryKey: ["conflicts", portfolioId],
          });

          return { strategy, intent: currentIntent };
        }

      }
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
