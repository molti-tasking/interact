"use client";

import { createClient } from "@/lib/supabase/client";
import { rowToResponse } from "@/lib/supabase/types";
import type { DerivationSpec, FormResponse, Portfolio, PortfolioSchema } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";

export interface ResponseWithOrigin extends FormResponse {
  /** "own" = submitted against this portfolio, "parent" = from parent, projected */
  origin: "own" | "parent";
}

/**
 * For derived portfolios: fetch own + parent responses in a single query
 * using `portfolio_id.in.(id, baseId)`, then tag and project them.
 * For base portfolios: just returns own responses with origin="own".
 */
export function useResponsesWithParent(portfolio: Portfolio | null | undefined) {
  const id = portfolio?.id;
  const baseId = portfolio?.base_id;
  const projection = portfolio?.projection as DerivationSpec | null;

  return useQuery({
    queryKey: ["responses-with-parent", id],
    queryFn: async (): Promise<ResponseWithOrigin[]> => {
      if (!id) return [];

      const supabase = createClient();
      const ids = baseId ? [id, baseId] : [id];

      const { data, error } = await supabase
        .from("responses")
        .select("*")
        .in("portfolio_id", ids)
        .order("submitted_at", { ascending: false });

      if (error) throw error;

      // Field names in the derived schema — used to project parent responses
      const derivedFieldNames = projection
        ? new Set(
            (portfolio!.schema as unknown as PortfolioSchema).fields.map(
              (f) => f.name,
            ),
          )
        : null;

      // Explicit remappings from the projection (parent name → derived name)
      const fieldMappings = projection?.fieldMappings ?? {};
      const reverseMappings = new Map(
        Object.entries(fieldMappings).map(([from, to]) => [from, to]),
      );

      return (data ?? []).map((row) => {
        const response = rowToResponse(row);
        const isOwn = row.portfolio_id === id;

        if (isOwn || !derivedFieldNames) {
          return { ...response, origin: "own" as const };
        }

        // Project: keep only fields that exist in the derived schema
        const projected: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(response.data)) {
          const mappedName = reverseMappings.get(key) ?? key;
          if (derivedFieldNames.has(mappedName)) {
            projected[mappedName] = value;
          }
        }

        return { ...response, data: projected, origin: "parent" as const };
      });
    },
    enabled: !!id,
  });
}
