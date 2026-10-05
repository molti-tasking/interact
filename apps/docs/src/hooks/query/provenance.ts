"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  PortfolioSchema,
  ProvenanceLayer,
  SchemaDiff,
  StructuredIntent,
} from "@/lib/types";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

const PAGE_SIZE = 50;

function provenanceKey(portfolioId: string) {
  return ["provenance", portfolioId] as const;
}

/** A provenance row without the (large) prev_schema / prev_intent snapshots. */
export interface ProvenanceListEntry {
  id: string;
  portfolio_id: string;
  action: string;
  layer: ProvenanceLayer;
  actor: string;
  rationale: string | null;
  diff: SchemaDiff;
  created_at: string;
}

const LIST_COLUMNS =
  "id, portfolio_id, action, layer, actor, rationale, diff, created_at";

function toListEntry(row: {
  id: string;
  portfolio_id: string;
  action: string;
  layer: string;
  actor: string;
  rationale: string | null;
  diff: unknown;
  created_at: string | null;
}): ProvenanceListEntry {
  const diff = (row.diff ?? {}) as Partial<SchemaDiff>;
  return {
    ...row,
    layer: row.layer as ProvenanceLayer,
    diff: {
      added: diff.added ?? [],
      removed: diff.removed ?? [],
      modified: diff.modified ?? [],
    },
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

/** All provenance entries (newest first), without snapshots. */
export function useProvenance(portfolioId: string | undefined) {
  return useQuery({
    queryKey: [...provenanceKey(portfolioId ?? ""), "all"],
    queryFn: async (): Promise<ProvenanceListEntry[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provenance_log")
        .select(LIST_COLUMNS)
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(toListEntry);
    },
    enabled: !!portfolioId,
  });
}

/** Paginated provenance timeline (newest first), without snapshots. */
export function useProvenancePages(portfolioId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...provenanceKey(portfolioId ?? ""), "pages"],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<ProvenanceListEntry[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provenance_log")
        .select(LIST_COLUMNS)
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (error) throw error;
      return (data ?? []).map(toListEntry);
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE
        ? undefined
        : allPages.reduce((n, p) => n + p.length, 0),
    enabled: !!portfolioId,
  });
}

export interface ProvenanceSnapshot {
  prev_schema: PortfolioSchema | null;
  prev_intent: StructuredIntent | null;
}

/**
 * The state *before* a provenance entry was applied — fetched lazily (e.g.
 * when the user expands an entry or reverts to it).
 */
export function useProvenanceSnapshot(entryId: string | null) {
  return useQuery({
    queryKey: ["provenance-snapshot", entryId],
    queryFn: async (): Promise<ProvenanceSnapshot> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provenance_log")
        .select("prev_schema, prev_intent")
        .eq("id", entryId!)
        .single();
      if (error) throw error;
      return {
        prev_schema: data.prev_schema as unknown as PortfolioSchema | null,
        prev_intent: data.prev_intent as unknown as StructuredIntent | null,
      };
    },
    enabled: !!entryId,
    staleTime: Infinity, // provenance is append-only
  });
}

/**
 * The most recent purpose text that differs from the current one — powers
 * the intent pane's "view changes" diff without loading full snapshots.
 */
export function usePreviousPurpose(
  portfolioId: string | undefined,
  currentPurpose: string,
) {
  const query = useQuery({
    queryKey: [...provenanceKey(portfolioId ?? ""), "purposes"],
    queryFn: async (): Promise<string[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("provenance_log")
        .select("prev_purpose:prev_intent->purpose->>content")
        .eq("portfolio_id", portfolioId!)
        .not("prev_intent", "is", null)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? [])
        .map((r) => (r.prev_purpose as string | null) ?? "")
        .filter(Boolean);
    },
    enabled: !!portfolioId,
  });

  const previous =
    query.data?.find((p) => p.trim() !== currentPurpose.trim()) ?? null;
  return { ...query, data: previous };
}
