"use client";

import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/database.types";
import type { ResponseInsert, ResponseRow } from "@/lib/supabase/types";
import { rowToResponse } from "@/lib/supabase/types";
import type { FormResponse } from "@/lib/types";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { uploadFilesInData } from "./response-files";

function responsesKey(portfolioId: string) {
  return ["responses", portfolioId] as const;
}

function responseKey(responseId: string) {
  return ["response", responseId] as const;
}

/** Lineage-aware lists (see responses-lineage.ts) — prefix of all of them. */
const RESPONSES_WITH_PARENT_KEY = ["responses-with-parent"] as const;

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/**
 * Refresh every list a response write can show up in: the per-portfolio
 * lists of the touched portfolios and all lineage lists (a parent's rows
 * appear in each derived portfolio's table).
 */
export function invalidateResponseLists(
  queryClient: QueryClient,
  portfolioIds: Iterable<string>,
) {
  for (const id of new Set(portfolioIds)) {
    queryClient.invalidateQueries({ queryKey: responsesKey(id) });
  }
  queryClient.invalidateQueries({ queryKey: RESPONSES_WITH_PARENT_KEY });
}

// ---------------------------------------------------------------------------
// Paged fetching
// ---------------------------------------------------------------------------

/** PostgREST caps a single response at `max_rows` (1000, supabase/config.toml). */
const PAGE_SIZE = 1000;
/** Safety cap so a runaway table can't hang the browser. */
const MAX_ROWS = 50_000;

/**
 * Fetch *all* responses of the given portfolios, newest first, paging with
 * `.range()` so nothing is silently cut off at `max_rows`.
 */
export async function fetchAllResponseRows(
  portfolioIds: string[],
): Promise<ResponseRow[]> {
  if (portfolioIds.length === 0) return [];
  const supabase = createClient();
  const rows: ResponseRow[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let from = 0;

  while (rows.length < MAX_ROWS) {
    const { data, error, count } = await supabase
      .from("responses")
      .select("*", from === 0 ? { count: "exact" } : undefined)
      .in("portfolio_id", portfolioIds)
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (from === 0) total = count ?? null;
    const page = data ?? [];
    for (const row of page) {
      // Rows inserted between pages shift offsets; skip duplicates.
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
    from += page.length;
    if (page.length === 0) break;
    if (total !== null ? from >= total : page.length < PAGE_SIZE) break;
  }

  if (total !== null && rows.length < total) {
    console.warn(
      `[responses] Loaded ${rows.length} of ${total} responses (cap ${MAX_ROWS}).`,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useResponse(responseId: string | undefined) {
  return useQuery({
    queryKey: responseKey(responseId ?? ""),
    queryFn: async (): Promise<FormResponse | null> => {
      if (!responseId) return null;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("responses")
        .select("*")
        .eq("id", responseId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data ? rowToResponse(data) : null;
    },
    enabled: !!responseId,
  });
}

/** All responses of a portfolio (paged under the hood — no 1000-row cut-off). */
export function useResponses(portfolioId: string | undefined) {
  return useQuery({
    queryKey: responsesKey(portfolioId ?? ""),
    queryFn: async (): Promise<FormResponse[]> => {
      if (!portfolioId) return [];
      const rows = await fetchAllResponseRows([portfolioId]);
      return rows.map(rowToResponse);
    },
    enabled: !!portfolioId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Insert a response. `File` values (file fields) are uploaded to the
 * `response-files` bucket first and replaced by `StoredFile` references.
 */
export function useCreateResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ResponseInsert): Promise<FormResponse> => {
      const data = await uploadFilesInData(input.portfolio_id, input.data);
      const supabase = createClient();
      const { data: row, error } = await supabase
        .from("responses")
        .insert({
          portfolio_id: input.portfolio_id,
          data: toJson(data),
        })
        .select()
        .single();

      if (error) throw error;
      return rowToResponse(row);
    },
    onSuccess: (response) => {
      invalidateResponseLists(queryClient, [response.portfolioId]);
    },
  });
}

/**
 * Replace a response's `data`. Pass the *complete* data object (merge with
 * the stored data first — see `mergeEditedResponse`). New `File` values are
 * uploaded like in `useCreateResponse`.
 */
export function useUpdateResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      portfolioId: string;
      data: Record<string, unknown>;
    }): Promise<FormResponse> => {
      const data = await uploadFilesInData(input.portfolioId, input.data);
      const supabase = createClient();
      const { data: row, error } = await supabase
        .from("responses")
        .update({ data: toJson(data) })
        .eq("id", input.id)
        .select()
        .single();

      if (error) throw error;
      return rowToResponse(row);
    },
    onSuccess: (response) => {
      invalidateResponseLists(queryClient, [response.portfolioId]);
      queryClient.setQueryData(responseKey(response.id), response);
    },
  });
}

export interface BulkUpdateResult {
  updated: number;
  /** Ids whose write failed (their batch was rejected) */
  failed: string[];
  /** First error message, when anything failed */
  error?: string;
}

/** Rows per upsert request; each request is one atomic statement. */
const BULK_BATCH_SIZE = 500;

/**
 * Write many responses' `data` at once. Each update must carry the row's
 * *own* `portfolioId` (a parent row's id for rows shown in a derived
 * table) and its complete data. Rows are written with one `upsert` per
 * batch of 500 — atomic per batch, not N sequential round trips.
 *
 * Resolves with partial-failure details; rejects only when nothing could
 * be written.
 */
export function useBulkUpdateResponses() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      updates: Array<{
        id: string;
        portfolioId: string;
        data: Record<string, unknown>;
      }>,
    ): Promise<BulkUpdateResult> => {
      const supabase = createClient();
      const result: BulkUpdateResult = { updated: 0, failed: [] };

      for (let i = 0; i < updates.length; i += BULK_BATCH_SIZE) {
        const batch = updates.slice(i, i + BULK_BATCH_SIZE);
        const { error } = await supabase.from("responses").upsert(
          batch.map((u) => ({
            id: u.id,
            portfolio_id: u.portfolioId,
            data: toJson(u.data),
          })),
          { onConflict: "id" },
        );
        if (error) {
          result.failed.push(...batch.map((u) => u.id));
          result.error ??= error.message;
        } else {
          result.updated += batch.length;
        }
      }

      if (updates.length > 0 && result.updated === 0) {
        throw new Error(result.error ?? "Failed to update responses");
      }
      return result;
    },
    onSettled: (_data, _error, updates) => {
      invalidateResponseLists(
        queryClient,
        updates.map((u) => u.portfolioId),
      );
      const ids = new Set(updates.map((u) => u.id));
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "response" && ids.has(q.queryKey[1] as string),
      });
    },
  });
}
