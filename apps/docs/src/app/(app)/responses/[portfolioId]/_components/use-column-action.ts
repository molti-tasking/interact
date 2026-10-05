"use client";

import { processColumnPromptAction } from "@/app/actions/column-actions";
import { useBulkUpdateResponses } from "@/hooks/query/responses-new";
import {
  buildColumnPreview,
  chunk,
  mapWithConcurrency,
  type ColumnPreview,
  type ResponseRowLike,
} from "@/lib/form-renderer/response-rows";
import type { Field, Portfolio } from "@/lib/types";
import { useState } from "react";

/** Rows per LLM call — small enough that output never truncates. */
const BATCH_SIZE = 25;
/** LLM calls in flight at once. */
const CONCURRENCY = 3;

export interface ColumnRunResult extends ColumnPreview {
  /** Distinct batch errors (e.g. rate limit), if any batch failed */
  errors: string[];
}

/**
 * Column actions in two steps: `run` asks the model for new values (in
 * batches) and returns a preview — nothing is written; `apply` writes the
 * previewed changes, `revert` restores the previewed rows.
 */
export function useColumnAction(portfolio: Portfolio) {
  const bulkUpdate = useBulkUpdateResponses();
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const run = async (
    field: Field,
    prompt: string,
    rows: ResponseRowLike[],
  ): Promise<ColumnRunResult> => {
    const results: Record<string, string | null> = {};
    const errors = new Set<string>();
    let done = 0;
    setProgress({ done, total: rows.length });

    try {
      await mapWithConcurrency(
        chunk(rows, BATCH_SIZE),
        CONCURRENCY,
        async (batch) => {
          try {
            const res = await processColumnPromptAction(
              field,
              prompt,
              batch.map((r) => ({
                responseId: r.id,
                value: r.data[field.name] ?? null,
              })),
            );
            if (res.success && res.results) Object.assign(results, res.results);
            else errors.add(res.error ?? "Unknown error");
          } catch (err) {
            errors.add(err instanceof Error ? err.message : String(err));
          }
          done += batch.length;
          setProgress({ done, total: rows.length });
        },
      );
    } finally {
      setProgress(null);
    }

    return {
      ...buildColumnPreview({ field, portfolio, rows, results }),
      errors: [...errors],
    };
  };

  const apply = (preview: ColumnPreview) =>
    bulkUpdate.mutateAsync(preview.changes.map((c) => c.write));

  /** Restore the rows of `preview` (except those whose write failed). */
  const revert = (preview: ColumnPreview, failedIds: string[] = []) => {
    const failed = new Set(failedIds);
    return bulkUpdate.mutateAsync(
      preview.changes.filter((c) => !failed.has(c.row.id)).map((c) => c.revert),
    );
  };

  return { run, apply, revert, progress, isApplying: bulkUpdate.isPending };
}
