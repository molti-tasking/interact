"use client";

import {
  projectParentData,
  type ResponseWithOrigin,
} from "@/lib/form-renderer/response-rows";
import { rowToResponse } from "@/lib/supabase/types";
import type { FormResponse, Portfolio } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { fetchAllResponseRows } from "./responses-new";

export type { ResponseWithOrigin } from "@/lib/form-renderer/response-rows";

/**
 * For derived portfolios: fetch own + parent responses together
 * (`portfolio_id IN (id, baseId)`, paged), tag them and project parent rows
 * into the derived schema. Each row keeps its unprojected `rawData` and
 * `sourcePortfolioId` so edits can be written back without dropping the
 * parent's other fields (see `buildRowWrite`).
 * For base portfolios: just returns own responses with origin="own".
 *
 * Projection runs in `select`, so schema edits re-project without refetching.
 */
export function useResponsesWithParent(portfolio: Portfolio | null | undefined) {
  const id = portfolio?.id;
  const baseId = portfolio?.base_id;
  const projection = portfolio?.projection ?? null;
  const schema = portfolio?.schema;

  const project = useCallback(
    (rows: FormResponse[]): ResponseWithOrigin[] =>
      rows.map((response) => {
        const rawData = response.data ?? {};
        const isOwn = response.portfolioId === id;
        return {
          ...response,
          data:
            isOwn || !projection || !schema
              ? rawData
              : projectParentData(rawData, schema, projection),
          rawData,
          sourcePortfolioId: response.portfolioId,
          origin: isOwn ? "own" : "parent",
        };
      }),
    [id, schema, projection],
  );

  return useQuery({
    queryKey: ["responses-with-parent", id],
    queryFn: async (): Promise<FormResponse[]> => {
      if (!id) return [];
      const rows = await fetchAllResponseRows(baseId ? [id, baseId] : [id]);
      return rows.map(rowToResponse);
    },
    select: project,
    enabled: !!id,
  });
}
