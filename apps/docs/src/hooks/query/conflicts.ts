"use client";

import {
  detectSchemaConflictsAction,
  previewConflictFixesAction,
  resolveSchemaConflictAction,
  type ConflictFix,
  type SchemaConflict,
} from "@/app/actions/conflict-actions";
import { commitPortfolioChange } from "@/lib/engine/commit";
import {
  applyConflictChanges,
  type ConflictFixPreview,
} from "@/lib/engine/conflict-changes";
import { mergeIntentChange, mergeSchemaChange } from "@/lib/engine/merge";
import type { Portfolio, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { applyCommitToCache, portfolioKey } from "./portfolios";

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

// ---------------------------------------------------------------------------
// Pre-computed fixes: preview + instant apply
// ---------------------------------------------------------------------------

interface ConflictFixPreviews {
  status: "pending" | "ready" | "failed";
  /** Fix value → what it would change */
  previews: Record<string, ConflictFixPreview>;
  retry: () => void;
}

/**
 * Work out, in the background, what each fix of every shown conflict would
 * change — so a fix can be previewed and applied without an LLM round trip.
 * Keyed on the conflict itself, so unrelated edits don't recompute it; the
 * id-based changes are replayed on the current schema when shown or applied.
 */
export function useConflictFixPreviews(
  portfolio: Portfolio,
  conflicts: SchemaConflict[],
): Map<string, ConflictFixPreviews> {
  const latest = useRef(portfolio);
  useEffect(() => {
    latest.current = portfolio;
  });

  return useQueries({
    queries: conflicts.map((conflict) => ({
      queryKey: [
        "conflict-fix-previews",
        portfolio.id,
        conflict.id,
        hashString(
          JSON.stringify([conflict.description, conflict.fieldIds, conflict.fixes]),
        ),
      ],
      queryFn: async () => {
        const { schema, intent } = latest.current;
        const response = await previewConflictFixesAction(
          schema,
          intent,
          conflict,
        );
        if (!response.success || !response.previews) {
          throw new Error(response.error ?? "No previews returned");
        }
        return response.previews;
      },
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    })),
    combine: (results) =>
      new Map(
        conflicts.map((conflict, i) => {
          const result = results[i];
          return [
            conflict.id,
            {
              status:
                result.status === "success"
                  ? "ready"
                  : result.status === "error"
                    ? "failed"
                    : "pending",
              previews: result.data ?? {},
              retry: () => void result.refetch(),
            },
          ] as const;
        }),
      ),
  });
}

function sameStructure(a: PortfolioSchema, b: PortfolioSchema): boolean {
  return (
    JSON.stringify([a.fields, a.groups]) === JSON.stringify([b.fields, b.groups])
  );
}

/**
 * Apply a pre-computed conflict fix: replay its changes on the latest state
 * (no LLM call). The form updates right away; the commit result replaces
 * the optimistic schema when it lands.
 */
export function useApplyConflictFix(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      conflict,
      fix,
      preview,
      actor,
    }: {
      conflict: SchemaConflict;
      fix: ConflictFix;
      preview: ConflictFixPreview;
      actor: string;
    }) =>
      trackActivity(portfolioId, "Fixing a conflict", () =>
        commitPortfolioChange(portfolioId, (current) => {
          const { schema } = applyConflictChanges(
            current.schema,
            preview.changes,
          );
          if (sameStructure(schema, current.schema)) return null;
          return {
            schema,
            provenance: {
              layer: "configuration",
              action: "conflict_resolved",
              actor,
              rationale: `${conflict.kind}: "${conflict.description}" → fix: "${fix.label}". ${preview.summary}`,
            },
          };
        }),
      ),
    onMutate: ({ preview }) => {
      const previous = queryClient.getQueryData<Portfolio>(
        portfolioKey(portfolioId),
      );
      if (previous) {
        queryClient.setQueryData(portfolioKey(portfolioId), {
          ...previous,
          schema: applyConflictChanges(previous.schema, preview.changes).schema,
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(portfolioKey(portfolioId), context.previous);
      }
    },
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}
