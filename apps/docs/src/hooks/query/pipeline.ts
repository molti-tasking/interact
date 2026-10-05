"use client";

import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { mergeIntentChange } from "@/lib/engine/merge";
import {
  computeDelta,
  determinePipelineStrategy,
  filterExcludedFields,
  serializeForLLM,
} from "@/lib/engine/structured-intent";
import type {
  PipelineStrategy,
  PortfolioSchema,
  StructuredIntent,
} from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useGenerateDesignProbes } from "./design-probes";
import { applyCommitToCache } from "./portfolios";
import { useGenerateSchema } from "./schema-generation";
import { findStandard, useDetectStandards } from "./standards";

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
      /** Intent as last loaded from the DB (base of the user's edit) */
      previousIntent: StructuredIntent;
      /** The user's edited intent */
      currentIntent: StructuredIntent;
      currentSchema: PortfolioSchema;
      actor?: string;
    }): Promise<PipelineResult> => {
      const delta = computeDelta(previousIntent, currentIntent);
      const hasExistingSchema = currentSchema.fields.length > 0;
      const strategy = determinePipelineStrategy(delta, hasExistingSchema);

      if (strategy.kind === "noop") {
        return { strategy, intent: currentIntent };
      }

      return trackActivity(portfolioId, "Updating the form", async () => {
        // Persist the user's intent edit first — merged onto the latest
        // state — so it survives even if generation fails afterwards.
        const needsCommit =
          strategy.kind === "filter-only" || delta.changedSections.length > 0;
        const intentCommit = !needsCommit
          ? null
          : await commitPortfolioChange(
          portfolioId,
          (current) => {
            const intent = mergeIntentChange(
              previousIntent,
              currentIntent,
              current.intent,
            );

            if (strategy.kind === "filter-only") {
              // Deterministic field filtering — no LLM needed
              const { schema: filtered, removedFields } = filterExcludedFields(
                current.schema,
                intent.exclusions.content,
              );
              return {
                intent,
                schema: filtered,
                provenance: {
                  layer: "configuration",
                  action: "exclusions_applied",
                  actor,
                  rationale:
                    removedFields.length > 0
                      ? `Applied exclusions — removed ${removedFields.map((f) => `"${f.label}"`).join(", ")}`
                      : `Updated exclusions (no matching fields): ${intent.exclusions.content.trim()}`,
                },
              };
            }

            return {
              intent,
              provenance:
                delta.changedSections.length > 0
                  ? {
                      layer: "intent",
                      action: "intent_updated",
                      actor,
                      rationale: `Sections changed: ${delta.changedSections.join(", ")}`,
                    }
                  : null,
            };
          },
        );
        applyCommitToCache(queryClient, intentCommit);

        const intent = intentCommit?.portfolio.intent ?? currentIntent;
        const schema = intentCommit?.portfolio.schema ?? currentSchema;

        switch (strategy.kind) {
          case "filter-only":
            return { strategy, intent, schema };

          case "recheck-constraints":
            // Conflict detection is keyed on schema + intent content, so the
            // committed constraint change re-triggers it automatically.
            return { strategy, intent };

          case "full": {
            // Step 1: Detect standards (keyword-based, no LLM)
            const standardsResult = await detectStandards.mutateAsync(
              serializeForLLM(intent),
            );

            // Step 2: Accepted standards always feed generation — even when
            // the edited intent no longer mentions their keywords.
            const acceptedStandards = (schema.acceptedStandards ?? [])
              .map((ref) => findStandard(ref.standardId, standardsResult))
              .filter((s): s is DetectedStandard => !!s);

            // Step 3: Generate schema and merge it into the current one
            const schemaCommit = await generateSchema.mutateAsync({
              intent,
              acceptedStandards:
                acceptedStandards.length > 0 ? acceptedStandards : undefined,
            });
            const newSchema = schemaCommit?.portfolio.schema ?? schema;

            // Step 4: Generate design probes against the new schema
            // (fire-and-forget; the deck shows progress)
            generateDesignProbes.mutate(
              {
                intent,
                acceptedStandards:
                  acceptedStandards.length > 0 ? acceptedStandards : undefined,
                currentSchema: newSchema,
              },
              {
                onError: (err) =>
                  toast.error(
                    `Couldn't generate design probes: ${err instanceof Error ? err.message : "unknown error"}`,
                  ),
              },
            );

            return { strategy, intent, schema: newSchema };
          }
        }
      });
    },
  });
}
