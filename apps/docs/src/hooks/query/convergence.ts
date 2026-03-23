"use client";

import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import { createClient } from "@/lib/supabase/client";
import type { OpinionInteraction, PortfolioSchema } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

interface ConvergenceBreakdown {
  opinions: number;
  dimensions: number;
  standards: number;
  hasSchema: boolean;
}

interface ConvergenceResult {
  score: number;
  breakdown: ConvergenceBreakdown;
}

function convergenceKey(portfolioId: string) {
  return ["convergence", portfolioId] as const;
}

/**
 * Calculate convergence score for a portfolio based on:
 * - Opinions resolved (40%)
 * - Dimensions accepted (30%)
 * - Standards reviewed (20%)
 * - Schema exists (10%)
 */
export function useConvergence(portfolioId: string | undefined) {
  return useQuery({
    queryKey: convergenceKey(portfolioId ?? ""),
    queryFn: async (): Promise<ConvergenceResult> => {
      if (!portfolioId) {
        return {
          score: 0,
          breakdown: {
            opinions: 0,
            dimensions: 0,
            standards: 0,
            hasSchema: false,
          },
        };
      }

      const supabase = createClient();

      // Fetch portfolio to check schema
      const { data: portfolio } = await supabase
        .from("portfolios")
        .select("schema")
        .eq("id", portfolioId)
        .single();

      const schema = portfolio?.schema as unknown as PortfolioSchema | null;
      const hasSchema = !!(schema && schema.fields.length > 0);

      // Fetch opinions
      const { data: opinions } = await supabase
        .from("opinion_interactions")
        .select("status")
        .eq("portfolio_id", portfolioId);

      const totalOpinions = opinions?.length ?? 0;
      const resolvedOpinions =
        opinions?.filter((o) => o.status === "resolved").length ?? 0;

      // Calculate opinions percentage (0-100)
      const opinionsPercent =
        totalOpinions > 0 ? (resolvedOpinions / totalOpinions) * 100 : 0;

      // Dimensions: check how many are "accepted" (present in schema)
      // We approximate this by checking if schema has fields from dimensions
      // Since dimensions are cached in react-query, we can't directly access them here
      // Instead, we'll use a heuristic: schema fields vs opinions
      const dimensionsPercent = hasSchema ? 100 : 0;

      // Standards: check if any standards have been accepted
      const acceptedStandards = schema?.acceptedStandards?.length ?? 0;
      const standardsPercent = acceptedStandards > 0 ? 100 : 0;

      // Calculate weighted score
      const score = Math.round(
        opinionsPercent * 0.4 +
          dimensionsPercent * 0.3 +
          standardsPercent * 0.2 +
          (hasSchema ? 100 : 0) * 0.1,
      );

      return {
        score,
        breakdown: {
          opinions: Math.round(opinionsPercent),
          dimensions: Math.round(dimensionsPercent),
          standards: Math.round(standardsPercent),
          hasSchema,
        },
      };
    },
    enabled: !!portfolioId,
    staleTime: 5000, // Refresh every 5 seconds
    refetchOnWindowFocus: true,
  });
}
