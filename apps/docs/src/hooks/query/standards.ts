"use client";

import { detectDomainStandardsAction } from "@/app/actions/standards-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { logProvenance } from "@/lib/engine/provenance";
import type { AcceptedStandardRef, PortfolioSchema } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function detectedStandardsKey(portfolioId: string) {
  return ["detected-standards", portfolioId] as const;
}

/**
 * Detected standards from the latest intent analysis.
 * Populated by useDetectStandards mutation, cached in react-query.
 */
export function useDetectedStandards(portfolioId: string | undefined) {
  return useQuery({
    queryKey: detectedStandardsKey(portfolioId ?? ""),
    queryFn: (): DetectedStandard[] => [],
    enabled: false,
    staleTime: Infinity,
  });
}

export function useDetectStandards(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (intent: string) => {
      const result = await detectDomainStandardsAction(intent);
      if (!result.success || !result.detectedStandards) {
        throw new Error(result.error ?? "Failed to detect standards");
      }
      return result.detectedStandards;
    },
    onSuccess: (standards) => {
      queryClient.setQueryData(detectedStandardsKey(portfolioId), standards);
    },
  });
}

/**
 * Accept a standard: persists to portfolio schema JSONB and appends a section
 * to the intent markdown.
 */
export function useAcceptStandard(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      detected,
      portfolio,
    }: {
      detected: DetectedStandard;
      portfolio: {
        id: string;
        intent: string;
        schema: PortfolioSchema;
      };
    }) => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const currentSchema = portfolio.schema;
      const existing = currentSchema.acceptedStandards ?? [];

      // Skip if already accepted
      if (existing.some((s) => s.standardId === detected.standard.id)) {
        return { schema: currentSchema, intent: portfolio.intent };
      }

      const newRef: AcceptedStandardRef = {
        standardId: detected.standard.id,
        standardName: detected.standard.name,
        domain: detected.standard.domain,
      };

      const updatedSchema: PortfolioSchema = {
        ...currentSchema,
        acceptedStandards: [...existing, newRef],
      };

      // Append standards section to intent if not already present
      let updatedIntent = portfolio.intent;
      const standardsHeader = "## Applied Standards";
      if (!updatedIntent.includes(standardsHeader)) {
        updatedIntent += `\n\n${standardsHeader}\n- **${detected.standard.name}** (${detected.standard.domain})`;
      } else if (!updatedIntent.includes(detected.standard.name)) {
        updatedIntent += `\n- **${detected.standard.name}** (${detected.standard.domain})`;
      }

      const { error } = await supabase
        .from("portfolios")
        .update({
          schema: JSON.parse(JSON.stringify(updatedSchema)),
          intent: updatedIntent,
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolio.id);

      if (error) throw error;

      // Log provenance
      await logProvenance(
        portfolio.id,
        "dimensions",
        "standard_accepted",
        "creator",
        { added: [], removed: [], modified: [] },
        `Applied standard: ${detected.standard.name}`,
        { intent: portfolio.intent, schema: currentSchema },
      );

      return { schema: updatedSchema, intent: updatedIntent };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["portfolios", portfolioId],
      });
    },
  });
}

/**
 * Track skipped standard IDs in react-query cache (ephemeral, per-session).
 */
export function useSkippedStandards(portfolioId: string | undefined) {
  return useQuery({
    queryKey: ["skipped-standards", portfolioId ?? ""],
    queryFn: (): Set<string> => new Set(),
    enabled: false,
    staleTime: Infinity,
  });
}

export function useSkipStandard(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (standardId: string) => standardId,
    onSuccess: (standardId) => {
      queryClient.setQueryData<Set<string>>(
        ["skipped-standards", portfolioId],
        (prev) => new Set([...(prev ?? []), standardId]),
      );
    },
  });
}
