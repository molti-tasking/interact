"use client";

import { createClient } from "@/lib/supabase/client";
import type { Portfolio, PortfolioStatus } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

/** Lightweight portfolio row for lineage display (no schema/intent JSONB). */
export interface LineagePortfolio {
  id: string;
  title: string;
  status: PortfolioStatus;
  base_id: string | null;
  fieldCount: number;
  created_at: string;
}

export interface PortfolioLineage {
  parent: LineagePortfolio | null;
  children: LineagePortfolio[];
}

const LINEAGE_COLUMNS = "id, title, status, base_id, field_count, created_at";

function toLineagePortfolio(row: {
  id: string;
  title: string;
  status: string | null;
  base_id: string | null;
  field_count: number | null;
  created_at: string | null;
}): LineagePortfolio {
  return {
    id: row.id,
    title: row.title,
    status: (row.status ?? "draft") as PortfolioStatus,
    base_id: row.base_id,
    fieldCount: row.field_count ?? 0,
    created_at: row.created_at ?? "",
  };
}

/**
 * Fetch derivation lineage for a portfolio:
 * - parent: the portfolio this one derives from (via base_id)
 * - children: portfolios that derive from this one
 */
export function usePortfolioLineage(
  portfolio: Pick<Portfolio, "id" | "base_id"> | null | undefined,
) {
  const id = portfolio?.id;
  const baseId = portfolio?.base_id ?? null;

  return useQuery({
    queryKey: ["lineage", id, baseId],
    queryFn: async (): Promise<PortfolioLineage> => {
      const supabase = createClient();

      const [parentResult, childrenResult] = await Promise.all([
        baseId
          ? supabase
              .from("portfolios")
              .select(LINEAGE_COLUMNS)
              .eq("id", baseId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("portfolios")
          .select(LINEAGE_COLUMNS)
          .eq("base_id", id!)
          .order("created_at", { ascending: true }),
      ]);

      if (parentResult.error) throw parentResult.error;
      if (childrenResult.error) throw childrenResult.error;

      return {
        parent: parentResult.data ? toLineagePortfolio(parentResult.data) : null,
        children: (childrenResult.data ?? []).map(toLineagePortfolio),
      };
    },
    enabled: !!id,
  });
}
