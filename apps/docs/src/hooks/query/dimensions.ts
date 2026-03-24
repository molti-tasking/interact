"use client";

import { generateDimensionsAction } from "@/app/actions/dimension-actions";
import type { DimensionObject } from "@/lib/dimension-types";
import { dimensionCacheKey } from "@/lib/engine/structured-intent";
import type { StructuredIntent } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function dimensionsKey(portfolioId: string) {
  return ["dimensions", portfolioId] as const;
}

/** Key stored alongside cached dimensions for invalidation. */
function dimensionsCacheKeyKey(portfolioId: string) {
  return ["dimensions-cache-key", portfolioId] as const;
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
    mutationFn: async (intent: StructuredIntent) => {
      // Check cache key — skip LLM if purpose+audience haven't changed
      const newCacheKey = dimensionCacheKey(intent);
      const storedCacheKey = queryClient.getQueryData<string>(
        dimensionsCacheKeyKey(portfolioId),
      );
      const cachedDimensions = queryClient.getQueryData<DimensionObject[]>(
        dimensionsKey(portfolioId),
      );

      if (
        storedCacheKey === newCacheKey &&
        cachedDimensions &&
        cachedDimensions.length > 0
      ) {
        return cachedDimensions;
      }

      const result = await generateDimensionsAction(intent);
      if (!result.success || !result.dimensions) {
        throw new Error(result.error ?? "Failed to generate dimensions");
      }

      // Store cache key for future comparisons
      queryClient.setQueryData(dimensionsCacheKeyKey(portfolioId), newCacheKey);

      return result.dimensions;
    },
    onSuccess: (dimensions) => {
      queryClient.setQueryData(dimensionsKey(portfolioId), dimensions);
    },
  });
}
