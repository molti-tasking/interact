"use client";

import {
  intentToSchemaAction,
  refineSchemaFromIntentAction,
} from "@/app/actions/schema-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { mergePatchOntoLatest } from "@/lib/engine/merge";
import { mergeRegeneratedSchema } from "@/lib/engine/schema-patch";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyCommitToCache } from "./portfolios";

/**
 * Generate a schema from the structured intent and accepted standards, then
 * fold it into the portfolio's current schema (field ids, creator-authored
 * fields, accepted standards and column actions survive regeneration).
 * Used for the first generation; an existing form is refined instead
 * (`useRefineSchema`).
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

/**
 * Refine an existing form after an intent edit: the LLM returns only the
 * fields the edit changes, and that change is merged onto the latest state.
 * Fields from design probes and direct edits are left alone, and anything
 * changed while the LLM was working (e.g. a probe answered meanwhile) wins
 * over the refinement where both touched the same property.
 *
 * Resolves to null when the edit didn't change the form.
 */
export function useRefineSchema(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      previousIntent,
      intent,
      baseSchema,
      decisions,
      acceptedStandards,
      actor,
    }: {
      previousIntent: StructuredIntent;
      intent: StructuredIntent;
      /** The schema the refinement is computed from */
      baseSchema: PortfolioSchema;
      decisions?: { question: string; answer: string }[];
      acceptedStandards?: DetectedStandard[];
      actor: string;
    }) => {
      const result = await refineSchemaFromIntentAction({
        previousIntent,
        intent,
        currentSchema: baseSchema,
        decisions,
        standardNames: acceptedStandards?.map((s) => s.standard.name),
      });

      if (!result.success || !result.result) {
        throw new Error(result.error ?? "Failed to refine the form");
      }

      const { schemaPatch, summary } = result.result;
      return commitPortfolioChange(portfolioId, (current) => {
        const schema = mergePatchOntoLatest(
          baseSchema,
          schemaPatch,
          current.schema,
        );
        if (!schema) return null;
        return {
          schema,
          provenance: {
            layer: "configuration",
            action: "schema_refined",
            actor,
            rationale: summary,
          },
        };
      });
    },
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}
