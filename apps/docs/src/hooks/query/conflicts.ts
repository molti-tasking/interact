"use client";

import {
  detectSchemaConflictsAction,
  resolveSchemaConflictAction,
  type ConflictFix,
  type SchemaConflict,
} from "@/app/actions/conflict-actions";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { mergeIntentChange, mergeSchemaChange } from "@/lib/engine/merge";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { applyCommitToCache } from "./portfolios";

/** Wait this long after the last schema/intent change before re-checking. */
const DETECT_DEBOUNCE_MS = 4000;

function conflictsKey(portfolioId: string) {
  return ["conflicts", portfolioId] as const;
}

/** Small stable string hash (djb2) — only used for cache keys. */
function hashString(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** Only what conflict detection reads: fields + the intent text. */
function contentHash(
  schema: PortfolioSchema | undefined,
  intent: StructuredIntent,
): string {
  return hashString(
    JSON.stringify([
      schema?.fields ?? [],
      intent.purpose.content,
      intent.audience.content,
      intent.exclusions.content,
      intent.constraints.content,
    ]),
  );
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Detect conflicts in the current schema.
 *
 * Keyed on a hash of the schema fields + intent text, debounced so bursts of
 * edits trigger a single (slow, ~25s) LLM check, and cached forever per
 * content — revisiting the workspace never re-runs detection for a state
 * that was already checked. Previous results stay visible while re-checking.
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
  const hash = useDebounced(contentHash(schema, intent), DETECT_DEBOUNCE_MS);
  const settled = hash === contentHash(schema, intent);

  return useQuery({
    queryKey: [...conflictsKey(portfolioId), hash],
    queryFn: async () => {
      if (!schema || schema.fields.length === 0) return [];
      const result = await detectSchemaConflictsAction(schema, intent);
      if (!result.success) throw new Error(result.error);
      return result.conflicts ?? [];
    },
    enabled:
      !skipConflicts &&
      settled &&
      !!portfolioId &&
      !!schema &&
      schema.fields.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/**
 * Resolve a conflict by applying a selected fix. The fix is computed from the
 * snapshot the user saw and replayed onto the latest state at commit time.
 */
export function useResolveConflict(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conflict,
      fix,
      snapshot,
      actor,
    }: {
      conflict: SchemaConflict;
      fix: ConflictFix;
      snapshot: { schema: PortfolioSchema; intent: StructuredIntent };
      actor: string;
    }) =>
      trackActivity(portfolioId, "Fixing a conflict", async () => {
        const response = await resolveSchemaConflictAction(
          snapshot.schema,
          snapshot.intent,
          conflict,
          fix,
        );

        if (!response.success || !response.result) {
          throw new Error(response.error ?? "Failed to resolve conflict");
        }

        const { updatedSchema, updatedIntent, rationale } = response.result;

        return commitPortfolioChange(portfolioId, (current) => ({
          schema: mergeSchemaChange(
            snapshot.schema,
            updatedSchema,
            current.schema,
          ),
          intent: mergeIntentChange(
            snapshot.intent,
            updatedIntent,
            current.intent,
          ),
          provenance: {
            layer: "configuration",
            action: "conflict_resolved",
            actor,
            rationale: `${conflict.kind}: "${conflict.description}" → fix: "${fix.label}". ${rationale}`,
          },
        }));
      }),
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}
