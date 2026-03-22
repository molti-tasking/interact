"use client";

import { generateDimensionsAction } from "@/app/actions/dimension-actions";
import type { DimensionObject } from "@/lib/dimension-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function dimensionsKey(portfolioId: string) {
  return ["dimensions", portfolioId] as const;
}

/**
 * Read dimensions from react-query cache. Dimensions are generated via
 * useGenerateDimensions and cached here — they aren't persisted to the DB
 * since they're a transient elicitation artifact.
 */
export function useDimensions(portfolioId: string | undefined) {
  return useQuery({
    queryKey: dimensionsKey(portfolioId ?? ""),
    queryFn: (): DimensionObject[] => [],
    enabled: false, // never auto-fetches; populated by mutation
    staleTime: Infinity,
  });
}

export function useGenerateDimensions(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (intent: string) => {
      const result = await generateDimensionsAction(intent);
      if (!result.success || !result.dimensions) {
        throw new Error(result.error ?? "Failed to generate dimensions");
      }
      return result.dimensions;
    },
    onSuccess: (dimensions) => {
      queryClient.setQueryData(dimensionsKey(portfolioId), dimensions);
    },
  });
}
