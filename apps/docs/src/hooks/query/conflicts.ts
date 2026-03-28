"use client";

import {
  detectSchemaConflictsAction,
  resolveSchemaConflictAction,
  type ConflictFix,
  type SchemaConflict,
} from "@/app/actions/conflict-actions";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { createClient } from "@/lib/supabase/client";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";

function conflictsKey(portfolioId: string) {
  return ["conflicts", portfolioId] as const;
}

/**
 * Detect conflicts in the current schema.
 * Automatically runs when schema changes (via queryKey including version).
 *
 * Pass `?skipConflicts=true` in the URL to disable conflict detection
 * (used during automated evaluation to save ~25s per probe resolution).
 */
export function useDetectConflicts(
  portfolioId: string,
  schema: PortfolioSchema | undefined,
  intent: StructuredIntent,
) {
  const searchParams = useSearchParams();
  const skipConflicts = searchParams.get("skipConflicts") === "true";

  return useQuery({
    queryKey: [...conflictsKey(portfolioId), schema?.version ?? 0],
    queryFn: async () => {
      if (!schema || schema.fields.length === 0) return [];
      const result = await detectSchemaConflictsAction(schema, intent);
      if (!result.success) throw new Error(result.error);
      return result.conflicts ?? [];
    },
    enabled:
      !skipConflicts &&
      !!portfolioId &&
      !!schema &&
      schema.fields.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Resolve a conflict by applying a selected fix.
 */
export function useResolveConflict(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conflict,
      fix,
      currentSchema,
      currentIntent,
    }: {
      conflict: SchemaConflict;
      fix: ConflictFix;
      currentSchema: PortfolioSchema;
      currentIntent: StructuredIntent;
    }) => {
      const response = await resolveSchemaConflictAction(
        currentSchema,
        currentIntent,
        conflict,
        fix,
      );

      if (!response.success || !response.result) {
        throw new Error(response.error ?? "Failed to resolve conflict");
      }

      const { updatedSchema, updatedIntent, rationale } = response.result;
      const conflictDiff = diffSchemas(currentSchema, updatedSchema);

      // Update portfolio in DB
      const supabase = createClient();
      const { error } = await supabase
        .from("portfolios")
        .update({
          intent: JSON.parse(JSON.stringify(updatedIntent)),
          schema: JSON.parse(JSON.stringify(updatedSchema)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolioId);

      if (error) throw error;

      // Log provenance
      await logProvenance(
        portfolioId,
        "configuration",
        "conflict_resolved",
        "system",
        conflictDiff,
        `${conflict.kind}: "${conflict.description}" → fix: "${fix.label}". ${rationale}`,
        { intent: currentIntent, schema: currentSchema },
      );

      return { updatedSchema, updatedIntent };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conflictsKey(portfolioId) });
      queryClient.invalidateQueries({
        queryKey: ["portfolios", portfolioId],
      });
      queryClient.invalidateQueries({
        queryKey: ["provenance", portfolioId],
      });
    },
  });
}
