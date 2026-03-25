"use client";

import {
  generateOpinionInteractionsAction,
  resolveOpinionInteractionAction,
} from "@/app/actions/opinion-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { createClient } from "@/lib/supabase/client";
import { rowToOpinion } from "@/lib/supabase/types";
import type { OpinionInteraction, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function opinionsKey(portfolioId: string) {
  return ["opinions", portfolioId] as const;
}

/**
 * Fetch persisted opinion interactions for a portfolio.
 */
export function useOpinions(portfolioId: string | undefined) {
  return useQuery({
    queryKey: opinionsKey(portfolioId ?? ""),
    queryFn: async (): Promise<OpinionInteraction[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("opinion_interactions")
        .select("*")
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data ?? []).map(rowToOpinion);
    },
    enabled: !!portfolioId,
  });
}

/**
 * Generate new opinion interactions and persist them to the DB.
 */
export function useGenerateOpinions(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      acceptedStandards,
    }: {
      intent: StructuredIntent;
      acceptedStandards?: DetectedStandard[];
    }) => {
      const result = await generateOpinionInteractionsAction(
        intent,
        5,
        undefined,
        acceptedStandards?.length ? acceptedStandards : undefined,
      );

      if (!result.success || !result.interactions) {
        throw new Error(result.error ?? "Failed to generate opinions");
      }

      // Persist to DB
      const supabase = createClient();
      const rows = result.interactions.map((interaction) => ({
        portfolio_id: portfolioId,
        text: interaction.text,
        explanation: interaction.explanation ?? null,
        layer: interaction.layer,
        source: interaction.source,
        options: JSON.parse(JSON.stringify(interaction.options)),
        selected_option: null,
        status: "pending",
        dimension_id: interaction.dimensionId ?? null,
        dimension_name: interaction.dimensionName ?? null,
      }));

      const { data, error } = await supabase
        .from("opinion_interactions")
        .insert(rows)
        .select();

      if (error) throw error;
      return (data ?? []).map(rowToOpinion);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: opinionsKey(portfolioId) });
    },
  });
}

/**
 * Resolve an opinion: call LLM, update portfolio schema/intent,
 * persist status change and any follow-ups.
 */
export function useResolveOpinion(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      opinion,
      selectedValue,
      currentIntent,
      currentSchema,
    }: {
      opinion: OpinionInteraction;
      selectedValue: string;
      currentIntent: StructuredIntent;
      currentSchema: PortfolioSchema;
    }) => {
      const selectedOption = opinion.options.find(
        (o) => o.value === selectedValue,
      );
      if (!selectedOption) throw new Error("Invalid option selected");

      // Mark as loading in DB
      const supabase = createClient();
      await supabase
        .from("opinion_interactions")
        .update({ status: "loading", selected_option: selectedValue })
        .eq("id", opinion.id);

      const response = await resolveOpinionInteractionAction({
        intent: currentIntent,
        currentSchema,
        interactionText: opinion.text,
        selectedOptionLabel: selectedOption.label,
        maxFollowUps: 3,
      });

      if (!response.success || !response.result) {
        // Revert to pending
        await supabase
          .from("opinion_interactions")
          .update({ status: "pending", selected_option: null })
          .eq("id", opinion.id);
        throw new Error(response.error ?? "Failed to resolve opinion");
      }

      // Intent stays as-is — opinion decisions are tracked in opinion_interactions table
      const newIntent = currentIntent;

      // Update portfolio
      const opinionDiff = diffSchemas(
        currentSchema,
        response.result.artifactFormSchema,
      );

      const { error: updateError } = await supabase
        .from("portfolios")
        .update({
          intent: JSON.parse(JSON.stringify(newIntent)),
          schema: JSON.parse(
            JSON.stringify(response.result.artifactFormSchema),
          ),
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolioId);

      if (updateError) throw updateError;

      // Log provenance
      await logProvenance(
        portfolioId,
        "dimensions",
        "opinion_resolved",
        "creator",
        opinionDiff,
        `"${opinion.text}" → "${selectedOption.label}"`,
        { intent: currentIntent, schema: currentSchema },
      );

      // Mark resolved in DB
      await supabase
        .from("opinion_interactions")
        .update({ status: "resolved", selected_option: selectedValue })
        .eq("id", opinion.id);

      // Insert follow-ups
      if (response.result.followUpInteractions?.length) {
        const followUpRows = response.result.followUpInteractions.map((f) => ({
          portfolio_id: portfolioId,
          text: f.text,
          explanation: f.explanation ?? null,
          layer: f.layer,
          source: f.source,
          options: JSON.parse(JSON.stringify(f.options)),
          selected_option: null,
          status: "pending",
          dimension_id: f.dimensionId ?? null,
          dimension_name: f.dimensionName ?? null,
        }));

        await supabase.from("opinion_interactions").insert(followUpRows);
      }

      return {
        newIntent,
        newSchema: response.result.artifactFormSchema,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: opinionsKey(portfolioId) });
      queryClient.invalidateQueries({
        queryKey: ["portfolios", portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ["provenance", portfolioId],
      });
    },
  });
}

/**
 * Dismiss an opinion interaction.
 */
export function useDismissOpinion(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opinionId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("opinion_interactions")
        .update({ status: "dismissed" })
        .eq("id", opinionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: opinionsKey(portfolioId) });
    },
  });
}
