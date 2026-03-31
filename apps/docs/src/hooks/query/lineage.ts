"use client";

import { createClient } from "@/lib/supabase/client";
import { rowToPortfolio } from "@/lib/supabase/types";
import type { Portfolio } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

export interface PortfolioLineage {
  parent: Portfolio | null;
  children: Portfolio[];
}

/**
 * Fetch derivation lineage for a portfolio:
 * - parent: the portfolio this one derives from (via base_id)
 * - children: portfolios that derive from this one
 */
export function usePortfolioLineage(portfolio: Portfolio | null | undefined) {
  const id = portfolio?.id;
  const baseId = portfolio?.base_id;

  return useQuery({
    queryKey: ["lineage", id],
    queryFn: async (): Promise<PortfolioLineage> => {
      const supabase = createClient();

      // Fetch parent and children in parallel
      const [parentResult, childrenResult] = await Promise.all([
        baseId
          ? supabase.from("portfolios").select("*").eq("id", baseId).single()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("portfolios")
          .select("*")
          .eq("base_id", id!)
          .order("created_at", { ascending: true }),
      ]);

      if (parentResult.error && parentResult.error.code !== "PGRST116") {
        throw parentResult.error;
      }
      if (childrenResult.error) throw childrenResult.error;

      return {
        parent: parentResult.data ? rowToPortfolio(parentResult.data) : null,
        children: (childrenResult.data ?? []).map(rowToPortfolio),
      };
    },
    enabled: !!id,
  });
}
