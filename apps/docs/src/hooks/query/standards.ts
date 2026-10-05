"use client";

import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { detectStandards, getStandardById } from "@/lib/standards";
import type { AcceptedStandardRef } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyCommitToCache } from "./portfolios";

function detectedStandardsKey(portfolioId: string) {
  return ["detected-standards", portfolioId] as const;
}

/**
 * Detected standards from the latest intent analysis.
 * Populated by useDetectStandards mutation, cached in react-query.
 */
export function useDetectedStandards(portfolioId: string | undefined) {
  return useQuery({
    queryKey: detectedStandardsKey(portfolioId ?? ""),
    queryFn: (): DetectedStandard[] => [],
    enabled: false,
    staleTime: Infinity,
  });
}

/**
 * Keyword-based standard detection. Pure and cheap, so it runs in the browser
 * rather than costing a server-action round trip.
 */
export function useDetectStandards(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (intent: string) => detectStandards(intent),
    onSuccess: (standards) => {
      queryClient.setQueryData(detectedStandardsKey(portfolioId), standards);
    },
  });
}

/**
 * Resolve a standard by id for a "standard" design probe. Falls back to the
 * static catalog when the detection cache is empty (e.g. after a reload).
 */
export function findStandard(
  standardId: string,
  detected: DetectedStandard[] | undefined,
): DetectedStandard | undefined {
  const hit = detected?.find((s) => s.standard.id === standardId);
  if (hit) return hit;
  const standard = getStandardById(standardId);
  return standard
    ? {
        standard,
        confidence: 1,
        matchedKeywords: [],
        relevantConstraints: standard.fieldConstraints,
      }
    : undefined;
}

/**
 * Accept a standard: records it in the portfolio schema's acceptedStandards
 * (revision-checked, logged).
 */
export function useAcceptStandard(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      detected,
      actor,
    }: {
      detected: DetectedStandard;
      actor: string;
    }) => {
      const newRef: AcceptedStandardRef = {
        standardId: detected.standard.id,
        standardName: detected.standard.name,
        domain: detected.standard.domain,
      };

      return commitPortfolioChange(portfolioId, (current) => {
        const existing = current.schema.acceptedStandards ?? [];
        // Already accepted (double click, another tab) — nothing to do
        if (existing.some((s) => s.standardId === newRef.standardId)) {
          return null;
        }
        // Standard is tracked in schema.acceptedStandards — no need to
        // also append to constraints.content (which would inject markdown
        // headings into the user-facing editor).
        return {
          schema: {
            ...current.schema,
            acceptedStandards: [...existing, newRef],
          },
          provenance: {
            layer: "dimensions",
            action: "standard_accepted",
            actor,
            rationale: `Applied standard: ${detected.standard.name}`,
          },
        };
      });
    },
    onSuccess: (result) => applyCommitToCache(queryClient, result),
  });
}
