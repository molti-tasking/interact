"use client";

import { createClient } from "@/lib/supabase/client";
import { Json } from "@/lib/supabase/database.types";
import type { PortfolioUpdate } from "@/lib/supabase/types";
import { rowToPortfolio } from "@/lib/supabase/types";
import type { Portfolio, PortfolioInsert } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const PORTFOLIOS_KEY = ["portfolios"] as const;

function portfolioKey(id: string) {
  return [...PORTFOLIOS_KEY, id] as const;
}

export function usePortfolios(spaceId?: string | null) {
  return useQuery({
    // Include the space filter in the key so per-space lists don't collide
    queryKey: spaceId ? [...PORTFOLIOS_KEY, { spaceId }] : PORTFOLIOS_KEY,
    queryFn: async (): Promise<Portfolio[]> => {
      const supabase = createClient();
      let query = supabase
        .from("portfolios")
        .select("*")
        .order("updated_at", { ascending: false });
      if (spaceId) query = query.eq("space_id", spaceId);

      const { data, error } = await query;

      if (error) throw error;
      return (data ?? []).map(rowToPortfolio);
    },
  });
}

export function usePortfolio(id: string | undefined) {
  return useQuery({
    queryKey: portfolioKey(id ?? ""),
    queryFn: async (): Promise<Portfolio | null> => {
      if (!id) return null;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("portfolios")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data ? rowToPortfolio(data) : null;
    },
    enabled: !!id,
  });
}

export function useCreatePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PortfolioInsert): Promise<Portfolio> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("portfolios")
        .insert({
          title: input.title,
          intent: input.intent as unknown as Json,
          schema: input.schema as unknown as Json,
          base_id: input.base_id ?? null,
          space_id: input.space_id ?? null,
          projection: input.projection
            ? (input.projection as unknown as Json)
            : null,
          status: input.status ?? "draft",
        })
        .select()
        .single();

      if (error) throw error;
      return rowToPortfolio(data);
    },
    onSuccess: (portfolio) => {
      queryClient.invalidateQueries({ queryKey: PORTFOLIOS_KEY });
      queryClient.setQueryData(portfolioKey(portfolio.id), portfolio);
    },
  });
}

export function useUpdatePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...update
    }: PortfolioUpdate & { id: string }): Promise<Portfolio> => {
      const supabase = createClient();

      // Build update object, serializing JSONB domain types for Supabase
      const dbUpdate: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (update.title !== undefined) dbUpdate.title = update.title;
      if (update.intent !== undefined)
        dbUpdate.intent = JSON.parse(JSON.stringify(update.intent));
      if (update.schema !== undefined)
        dbUpdate.schema = JSON.parse(JSON.stringify(update.schema));
      if (update.base_id !== undefined) dbUpdate.base_id = update.base_id;
      if (update.projection !== undefined)
        dbUpdate.projection = update.projection
          ? JSON.parse(JSON.stringify(update.projection))
          : null;
      if (update.status !== undefined) dbUpdate.status = update.status;

      const { data, error } = await supabase
        .from("portfolios")
        .update(dbUpdate)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return rowToPortfolio(data);
    },
    onSuccess: (portfolio) => {
      queryClient.invalidateQueries({ queryKey: PORTFOLIOS_KEY });
      queryClient.setQueryData(portfolioKey(portfolio.id), portfolio);
    },
  });
}

export function useDeletePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const supabase = createClient();
      const { error } = await supabase.from("portfolios").delete().eq("id", id);

      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: PORTFOLIOS_KEY });
      queryClient.removeQueries({ queryKey: portfolioKey(id) });
    },
  });
}
