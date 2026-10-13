"use client";

import { commitPortfolioChange } from "@/lib/engine/commit";
import {
  planRecode,
  planRecodeUndo,
  type RecodeOp,
  type RecodePlan,
} from "@/lib/engine/recode";
import type {
  ResponseRowLike,
  RowWrite,
} from "@/lib/form-renderer/response-rows";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { applyCommitToCache } from "./portfolios";
import { useBulkUpdateResponses } from "./responses-new";

/**
 * Recode responses from the dashboard, and undo it.
 *
 * Applying re-plans on freshly fetched rows (`getRows`), then writes rows
 * and form in the plan's order — if any row write fails, the form is left
 * as it was. Every recode is logged in History, even one that only touches
 * rows. Undo replays the inverse on the *current* state (a snapshot revert
 * would fail as soon as the intent re-synced after the change).
 */
export function useRecode(
  portfolio: Portfolio,
  getRows: () => Promise<readonly ResponseRowLike[]>,
) {
  const queryClient = useQueryClient();
  const bulkUpdate = useBulkUpdateResponses();

  const writeRows = async (writes: RowWrite[]) => {
    if (writes.length === 0) return;
    const result = await bulkUpdate.mutateAsync(writes);
    if (result.failed.length > 0) {
      throw new Error(
        `${result.failed.length} of ${writes.length} responses couldn't be updated${result.error ? ` (${result.error})` : ""}. The form was left unchanged — try again.`,
      );
    }
  };

  const commit = async (
    change: ((schema: PortfolioSchema) => PortfolioSchema) | null,
    action: string,
    rationale: string,
    actor: string,
  ) => {
    const result = await commitPortfolioChange(portfolio.id, (current) => ({
      ...(change ? { schema: change(current.schema) } : {}),
      provenance: { layer: "configuration", action, actor, rationale },
    }));
    applyCommitToCache(queryClient, result);
    return result;
  };

  const apply = useMutation({
    mutationFn: async ({ op, actor }: { op: RecodeOp; actor: string }) =>
      trackActivity(portfolio.id, "Recoding responses", async () => {
        const rows = await getRows();
        const plan = planRecode(op, { schema: portfolio.schema, portfolio, rows });
        if (!plan || (plan.changes.length === 0 && !plan.schemaChange)) {
          throw new Error("Nothing to change.");
        }
        const writes = plan.changes.map((c) => c.write);
        if (plan.order === "schema-first") {
          await commit(plan.schemaChange, "responses_recoded", plan.summary, actor);
          await writeRows(writes);
        } else {
          await writeRows(writes);
          await commit(plan.schemaChange, "responses_recoded", plan.summary, actor);
        }
        return plan;
      }),
  });

  const undo = useMutation({
    mutationFn: async ({ plan, actor }: { plan: RecodePlan; actor: string }) =>
      trackActivity(portfolio.id, "Undoing a recode", async () => {
        const writes = planRecodeUndo(plan, await getRows(), portfolio);
        const rationale = `Undid: ${plan.summary}`;
        // The reverse of the apply order
        if (plan.order === "rows-first") {
          await commit(plan.inverseSchemaChange, "responses_recode_undone", rationale, actor);
          await writeRows(writes);
        } else {
          await writeRows(writes);
          await commit(plan.inverseSchemaChange, "responses_recode_undone", rationale, actor);
        }
        return writes.length;
      }),
  });

  return { apply, undo };
}
