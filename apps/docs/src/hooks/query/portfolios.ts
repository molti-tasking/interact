"use client";

import {
  type ChangeFn,
  commitPortfolioChange,
  type CommitResult,
} from "@/lib/engine/commit";
import { createClient } from "@/lib/supabase/client";
import type { Json, TablesUpdate } from "@/lib/supabase/database.types";
import type { PortfolioUpdate } from "@/lib/supabase/types";
import { rowToPortfolio } from "@/lib/supabase/types";
import type {
  DerivationSpec,
  Portfolio,
  PortfolioInsert,
  PortfolioStatus,
} from "@/lib/types";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

const PORTFOLIOS_KEY = ["portfolios"] as const;
const SUMMARIES_KEY = ["portfolio-summaries"] as const;

export function portfolioKey(id: string) {
  return [...PORTFOLIOS_KEY, id] as const;
}

/**
 * Invalidate list-shaped portfolio queries (full lists + summaries) without
 * touching per-portfolio detail queries, which callers update directly via
 * `setQueryData`. Detail keys are `["portfolios", "<id>"]`; list keys are
 * `["portfolios"]` or `["portfolios", { spaceId }]`.
 */
export function invalidatePortfolioLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({
    predicate: (q) =>
      q.queryKey[0] === PORTFOLIOS_KEY[0] && typeof q.queryKey[1] !== "string",
  });
  queryClient.invalidateQueries({ queryKey: SUMMARIES_KEY });
}

/**
 * Push a committed portfolio into the cache and refresh everything derived
 * from it (lists, provenance, lineage).
 */
export function applyCommitToCache(
  queryClient: QueryClient,
  result: CommitResult | null,
) {
  if (!result) return;
  const { portfolio } = result;
  queryClient.setQueryData(portfolioKey(portfolio.id), portfolio);
  invalidatePortfolioLists(queryClient);
  queryClient.invalidateQueries({ queryKey: ["provenance", portfolio.id] });
  queryClient.invalidateQueries({ queryKey: ["lineage"] });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Full portfolio rows (schema + intent). Prefer `usePortfolioSummaries` for lists. */
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

export interface PortfolioSummary {
  id: string;
  title: string;
  status: PortfolioStatus;
  base_id: string | null;
  space_id: string | null;
  created_at: string;
  updated_at: string;
  fieldCount: number;
  purpose: string;
  projectionType: DerivationSpec["type"] | null;
}

/**
 * Lightweight portfolio listing for navigation and overview pages — selects
 * scalar columns plus the purpose text, never the schema/intent JSONB.
 */
export function usePortfolioSummaries(spaceId?: string | null) {
  return useQuery({
    queryKey: spaceId ? [...SUMMARIES_KEY, { spaceId }] : SUMMARIES_KEY,
    queryFn: async (): Promise<PortfolioSummary[]> => {
      const supabase = createClient();
      let query = supabase
        .from("portfolios")
        .select(
          "id, title, status, base_id, space_id, created_at, updated_at, field_count, purpose:intent->purpose->>content, projection_type:projection->>type",
        )
        .order("updated_at", { ascending: false });
      if (spaceId) query = query.eq("space_id", spaceId);

      const { data, error } = await query;
      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        status: (row.status ?? "draft") as PortfolioStatus,
        base_id: row.base_id,
        space_id: row.space_id,
        created_at: row.created_at ?? new Date().toISOString(),
        updated_at: row.updated_at ?? new Date().toISOString(),
        fieldCount: row.field_count ?? 0,
        purpose: (row.purpose as string | null) ?? "",
        projectionType:
          (row.projection_type as DerivationSpec["type"] | null) ?? null,
      }));
    },
  });
}

/**
 * Other portfolios ("tables") in the same space — valid targets for
 * reference fields.
 */
export function useSpaceSiblings(
  portfolio: Pick<Portfolio, "id" | "space_id"> | null | undefined,
): { id: string; title: string }[] {
  const { data } = usePortfolioSummaries(portfolio?.space_id ?? undefined);
  if (!portfolio?.space_id || !data) return [];
  return data
    .filter((p) => p.id !== portfolio.id)
    .map((p) => ({ id: p.id, title: p.title }));
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

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

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
      queryClient.setQueryData(portfolioKey(portfolio.id), portfolio);
      invalidatePortfolioLists(queryClient);
      queryClient.invalidateQueries({ queryKey: ["lineage"] });
    },
  });
}

/**
 * Commit a schema/intent change with optimistic concurrency + provenance.
 * The change function receives the *current database state*; see
 * `commitPortfolioChange`.
 */
export function useCommitPortfolio(portfolioId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (change: ChangeFn) => {
      if (!portfolioId) throw new Error("No portfolio selected");
      return commitPortfolioChange(portfolioId, change);
    },
    onSuccess: (result) => applyCommitToCache(queryClient, result),
  });
}

/**
 * Update portfolio *metadata* (title, status, lineage, …). Schema and intent
 * are deliberately not accepted here — use `useCommitPortfolio` so the write
 * is revision-checked and logged.
 */
export function useUpdatePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...update
    }: Omit<PortfolioUpdate, "schema" | "intent"> & {
      id: string;
    }): Promise<Portfolio> => {
      const supabase = createClient();

      const dbUpdate: TablesUpdate<"portfolios"> = {
        updated_at: new Date().toISOString(),
      };
      if (update.title !== undefined) dbUpdate.title = update.title;
      if (update.base_id !== undefined) dbUpdate.base_id = update.base_id;
      if (update.space_id !== undefined) dbUpdate.space_id = update.space_id;
      if (update.projection !== undefined)
        dbUpdate.projection = update.projection
          ? JSON.parse(JSON.stringify(update.projection))
          : null;
      if (update.status !== undefined) dbUpdate.status = update.status;
      if (update.creator_role !== undefined)
        dbUpdate.creator_role = update.creator_role;

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
      queryClient.setQueryData(portfolioKey(portfolio.id), portfolio);
      invalidatePortfolioLists(queryClient);
    },
  });
}

export function useDeletePortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const supabase = createClient();
      const { error } = await supabase.from("portfolios").delete().eq("id", id);

      if (error) {
        // portfolios.base_id has no ON DELETE action: derived portfolios
        // block deleting their base.
        if (error.code === "23503") {
          throw new Error(
            "This portfolio has derived portfolios. Delete those first.",
          );
        }
        throw error;
      }
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: portfolioKey(id) });
      invalidatePortfolioLists(queryClient);
      queryClient.invalidateQueries({ queryKey: ["lineage"] });
    },
  });
}
