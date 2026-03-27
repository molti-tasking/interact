"use client";

import {
  generateDesignProbesAction,
  resolveDesignProbeAction,
} from "@/app/actions/design-probe-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { createClient } from "@/lib/supabase/client";
import { rowToDesignProbe } from "@/lib/supabase/types";
import type { DesignProbe, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function designProbesKey(portfolioId: string) {
  return ["design-probes", portfolioId] as const;
}

/**
 * Fetch persisted design probes for a portfolio.
 */
export function useDesignProbes(portfolioId: string | undefined) {
  return useQuery({
    queryKey: designProbesKey(portfolioId ?? ""),
    queryFn: async (): Promise<DesignProbe[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_probes")
        .select("*")
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(rowToDesignProbe);
    },
    enabled: !!portfolioId,
  });
}

/**
 * Generate new design probes and persist them to the DB.
 */
export function useGenerateDesignProbes(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      acceptedStandards,
    }: {
      intent: StructuredIntent;
      acceptedStandards?: DetectedStandard[];
    }) => {
      const result = await generateDesignProbesAction(
        intent,
        5,
        undefined,
        acceptedStandards?.length ? acceptedStandards : undefined,
      );

      if (!result.success || !result.interactions) {
        throw new Error(result.error ?? "Failed to generate design probes");
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
        .from("design_probes")
        .insert(rows)
        .select();

      if (error) throw error;
      return (data ?? []).map(rowToDesignProbe);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Resolve a design probe: call LLM, update portfolio schema/intent,
 * persist status change and any follow-ups.
 */
export function useResolveDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      probe,
      selectedValue,
      currentIntent,
      currentSchema,
    }: {
      probe: DesignProbe;
      selectedValue: string;
      currentIntent: StructuredIntent;
      currentSchema: PortfolioSchema;
    }) => {
      // Handle custom answers (prefixed with "custom:")
      const isCustom = selectedValue.startsWith("custom:");
      const customText = isCustom ? selectedValue.slice("custom:".length) : null;

      const selectedOption = isCustom
        ? null
        : probe.options.find((o) => o.value === selectedValue);

      if (!isCustom && !selectedOption) {
        throw new Error("Invalid option selected");
      }

      const optionLabel = isCustom
        ? customText!
        : selectedOption!.label;

      // Mark as loading in DB
      const supabase = createClient();
      await supabase
        .from("design_probes")
        .update({ status: "loading", selected_option: selectedValue })
        .eq("id", probe.id);

      const response = await resolveDesignProbeAction({
        intent: currentIntent,
        currentSchema,
        interactionText: probe.text,
        selectedOptionLabel: optionLabel,
        maxFollowUps: 3,
      });

      if (!response.success || !response.result) {
        // Revert to pending
        await supabase
          .from("design_probes")
          .update({ status: "pending", selected_option: null })
          .eq("id", probe.id);
        throw new Error(response.error ?? "Failed to resolve design probe");
      }

      // Replace purpose with the LLM's coherent rewrite (falls back to append if missing)
      const newPurpose = response.result.updatedPurpose
        ? response.result.updatedPurpose
        : currentIntent.purpose.content.trimEnd() +
          "\n" +
          response.result.refinementDelta;

      const newIntent: StructuredIntent = {
        ...currentIntent,
        purpose: {
          content: newPurpose,
          updatedAt: new Date().toISOString(),
        },
      };

      // Update portfolio
      const probeDiff = diffSchemas(
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
        "design_probe_resolved",
        "creator",
        probeDiff,
        `"${probe.text}" → "${optionLabel}"`,
        { intent: currentIntent, schema: currentSchema },
      );

      // Mark resolved in DB
      await supabase
        .from("design_probes")
        .update({ status: "resolved", selected_option: selectedValue })
        .eq("id", probe.id);

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

        await supabase.from("design_probes").insert(followUpRows);
      }

      return {
        newIntent,
        newSchema: response.result.artifactFormSchema,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
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
 * Insert detected standards as design probes (source="standard").
 * Skips standards that already have a corresponding probe in the DB.
 */
export function useInsertStandardProbes(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      standards: { standard: { id: string; name: string; description: string }; confidence: number }[],
    ) => {
      if (!standards.length) return;

      const supabase = createClient();

      // Check for existing standard probes to avoid duplicates
      const { data: existing } = await supabase
        .from("design_probes")
        .select("dimension_id")
        .eq("portfolio_id", portfolioId)
        .eq("source", "standard");

      const existingIds = new Set(
        (existing ?? []).map((r: { dimension_id: string | null }) => r.dimension_id),
      );

      const newRows = standards
        .filter((s) => !existingIds.has(s.standard.id))
        .map((s) => ({
          portfolio_id: portfolioId,
          text: `Apply standard: ${s.standard.name}?`,
          explanation: `${s.standard.description} (${Math.round(s.confidence * 100)}% confidence match)`,
          layer: "dimensions",
          source: "standard",
          options: JSON.parse(
            JSON.stringify([
              { value: "accept", label: "Apply Standard" },
              { value: "skip", label: "Skip" },
            ]),
          ),
          selected_option: null,
          status: "pending",
          dimension_id: s.standard.id,
          dimension_name: s.standard.name,
        }));

      if (!newRows.length) return;

      const { error } = await supabase
        .from("design_probes")
        .insert(newRows);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Mark a standard probe as resolved in the DB (after accept/skip is handled externally).
 */
export function useResolveStandardProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      probeId,
      selectedOption,
    }: {
      probeId: string;
      selectedOption: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("design_probes")
        .update({ status: "resolved", selected_option: selectedOption })
        .eq("id", probeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Dismiss a design probe.
 */
export function useDismissDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (probeId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("design_probes")
        .update({ status: "dismissed" })
        .eq("id", probeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}
