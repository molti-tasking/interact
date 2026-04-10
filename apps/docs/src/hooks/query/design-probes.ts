"use client";

import {
  generateDesignProbesAction,
  resolveDesignProbeAction,
} from "@/app/actions/design-probe-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { sanitizePurposeText } from "@/lib/engine/structured-intent";
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
 * Optionally accepts an external prompt + current schema to generate
 * probes from a collaborator's perspective.
 */
export function useGenerateDesignProbes(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      acceptedStandards,
      externalPrompt,
      currentSchema,
    }: {
      intent: StructuredIntent;
      acceptedStandards?: DetectedStandard[];
      externalPrompt?: string;
      currentSchema?: PortfolioSchema;
    }) => {
      const result = await generateDesignProbesAction(
        intent,
        5,
        undefined,
        acceptedStandards?.length ? acceptedStandards : undefined,
        externalPrompt,
        currentSchema,
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
      resolvedBy,
    }: {
      probe: DesignProbe;
      selectedValue: string;
      currentIntent: StructuredIntent;
      currentSchema: PortfolioSchema;
      resolvedBy?: string;
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
        ? sanitizePurposeText(response.result.updatedPurpose)
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
        resolvedBy ?? "creator",
        probeDiff,
        `"${probe.text}" → "${optionLabel}"`,
        { intent: currentIntent, schema: currentSchema },
      );

      // Mark resolved in DB
      await supabase
        .from("design_probes")
        .update({
          status: "resolved",
          selected_option: selectedValue,
          resolved_at: new Date().toISOString(),
          resolved_by: resolvedBy ?? null,
        })
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
 * Re-resolve an already-resolved design probe with a different answer.
 * Updates edit history metadata, then runs resolution from the current state.
 */
export function useReResolveDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      probe,
      newSelectedValue,
      currentIntent,
      currentSchema,
      editedBy,
    }: {
      probe: DesignProbe;
      newSelectedValue: string;
      currentIntent: StructuredIntent;
      currentSchema: PortfolioSchema;
      editedBy: string;
    }) => {
      const isCustom = newSelectedValue.startsWith("custom:");
      const customText = isCustom
        ? newSelectedValue.slice("custom:".length)
        : null;

      const selectedOption = isCustom
        ? null
        : probe.options.find((o) => o.value === newSelectedValue);

      if (!isCustom && !selectedOption) {
        throw new Error("Invalid option selected");
      }

      const optionLabel = isCustom ? customText! : selectedOption!.label;

      const supabase = createClient();

      // Store previous answer and update edit metadata
      await supabase
        .from("design_probes")
        .update({
          status: "loading",
          previous_selected_option: probe.selectedOption,
          edited_by: editedBy,
          edited_at: new Date().toISOString(),
          edit_count: (probe.editCount ?? 0) + 1,
        })
        .eq("id", probe.id);

      const response = await resolveDesignProbeAction({
        intent: currentIntent,
        currentSchema,
        interactionText: probe.text,
        selectedOptionLabel: optionLabel,
        maxFollowUps: 0, // No follow-ups on re-edits
      });

      if (!response.success || !response.result) {
        // Revert to resolved with previous answer
        await supabase
          .from("design_probes")
          .update({
            status: "resolved",
            edited_at: null,
            edited_by: null,
            edit_count: probe.editCount ?? 0,
            previous_selected_option: probe.previousSelectedOption ?? null,
          })
          .eq("id", probe.id);
        throw new Error(response.error ?? "Failed to re-resolve design probe");
      }

      // Update intent
      const newPurpose = response.result.updatedPurpose
        ? sanitizePurposeText(response.result.updatedPurpose)
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
        "design_probe_re_resolved",
        editedBy || "creator",
        probeDiff,
        `Re-edited: "${probe.text}" → "${optionLabel}" (was: "${probe.selectedOption}")`,
        { intent: currentIntent, schema: currentSchema },
      );

      // Mark resolved with new answer
      await supabase
        .from("design_probes")
        .update({
          status: "resolved",
          selected_option: newSelectedValue,
          resolved_at: new Date().toISOString(),
          resolved_by: editedBy,
        })
        .eq("id", probe.id);

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
