"use client";

import { createClient } from "@/lib/supabase/client";
import { rowToProvenance } from "@/lib/supabase/types";
import type { ProvenanceEntry } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

function provenanceKey(portfolioId: string) {
  return ["provenance", portfolioId] as const;
}

export function useProvenance(portfolioId: string | undefined) {
  return useQuery({
    queryKey: provenanceKey(portfolioId ?? ""),
    queryFn: async (): Promise<ProvenanceEntry[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provenance_log")
        .select("*")
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(rowToProvenance);
    },
    enabled: !!portfolioId,
  });
}
