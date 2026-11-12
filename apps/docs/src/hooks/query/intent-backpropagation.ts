"use client";

import { callLlm } from "@/lib/llm-client";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { IntentSyncQueue, type SyncOutcome } from "@/lib/intent-sync-queue";
import { sanitizePurposeText } from "interact/forms/structured-intent";
import type { UnsyncedEdit } from "interact/forms/intent-sync";
import type { Field, Portfolio } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { applyCommitToCache, portfolioKey, writeIntentSync } from "./portfolios";

const LOG_PREFIX = "[IntentBackpropagation]";

/**
 * Keeps the intent's purpose in step with the form after direct field edits
 * and applied answers: changes are batched into one background model call
 * that rewords the purpose (one bounded edit, see `purpose-edit.ts`).
 *
 * The queue (`lib/intent-sync-queue.ts`) stores on the portfolio whether
 * the intent is behind the form (`intent_sync`): the editor shows it as out
 * of sync when a call failed or is still pending after a timeout. Failed
 * calls are retried with backoff. A call whose purpose changed while it ran
 * (a resolved question, the creator typing) is not applied over the newer
 * text; it is queued again as a new call on the current state.
 *
 * Usage:
 *   const { scheduleSync, retrySync } = useIntentBackpropagation(portfolio);
 *   // after saving a field edit:
 *   scheduleSync('Renamed field "Name" to "Full Name"');
 *   // after applying a pre-computed elicitation question answer:
 *   scheduleSync('"Track sessions?" → "Yes, per week"', "design-decision");
 */
export function useIntentBackpropagation(
  portfolio: Portfolio | null | undefined,
  /** False where there is no intent portfolio to keep in step (baseline) */
  enabled = true,
) {
  const queryClient = useQueryClient();
  const portfolioId = portfolio?.id;
  // Latest portfolio, for when it isn't in the query cache (updated after
  // render, not during)
  const latestRef = useRef(portfolio);
  useEffect(() => {
    latestRef.current = portfolio;
  }, [portfolio]);
  const queueRef = useRef<IntentSyncQueue | null>(null);

  useEffect(() => {
    if (!portfolioId || !enabled) return;
    const current = () =>
      queryClient.getQueryData<Portfolio>(portfolioKey(portfolioId)) ??
      (latestRef.current?.id === portfolioId ? latestRef.current : undefined);
    const queue = new IntentSyncQueue(
      {
        run: (batch) =>
          trackActivity(portfolioId, "Syncing intent", () =>
            syncPurpose(queryClient, current(), batch.edits, batch.decision),
          ),
        writeFlag: (flag) => writeIntentSync(queryClient, portfolioId, flag),
      },
      // Changes an earlier visit left unsynced are picked up again
      current()?.intent_sync ?? null,
    );
    queueRef.current = queue;
    // Leaving the workspace: run what is still waiting, keep what failed
    return () => {
      if (queueRef.current === queue) queueRef.current = null;
      void queue.close();
    };
  }, [portfolioId, enabled, queryClient]);

  const scheduleSync = useCallback(
    (
      editDescription: string,
      kind: "field-edit" | "design-decision" = "field-edit",
    ) => {
      queueRef.current?.schedule(editDescription, kind);
    },
    [],
  );

  /** "Retry now" on the out-of-sync notice */
  const retrySync = useCallback(() => {
    void queueRef.current?.retryNow();
  }, []);

  return { scheduleSync, retrySync };
}

/**
 * One sync: a model call on the portfolio as it is now, its purpose edit
 * committed unless the purpose changed while the call ran.
 */
async function syncPurpose(
  queryClient: QueryClient,
  p: Portfolio | undefined,
  edits: UnsyncedEdit[],
  decision: boolean,
): Promise<SyncOutcome> {
  if (!p) return { kind: "failed", message: "The form isn't loaded." };
  const portfolioId = p.id;

  const kind = decision ? "design-decision" : "field-edit";
  const bulkDescription = edits.map((e) => e.text).join(". ");
  const basePurpose = p.intent.purpose.content;

  const syncResult = await callLlm("sync-intent", {
    intent: p.intent,
    currentSchema: p.schema,
    editDescription: bulkDescription,
    kind,
  });
  if (!syncResult.success) {
    console.error(LOG_PREFIX, "action failed:", syncResult.error);
    return { kind: "failed", message: syncResult.error ?? "The intent couldn't be updated." };
  }
  // Nothing to reword: the purpose already reflects the changes
  if (!syncResult.shouldUpdate || !syncResult.updatedPurpose) return { kind: "synced" };

  const updatedPurpose = sanitizePurposeText(syncResult.updatedPurpose);
  let superseded = false;
  const commit = await commitPortfolioChange(portfolioId, (current) => {
    if (current.intent.purpose.content !== basePurpose) {
      superseded = true;
      return null;
    }
    return {
      // Keeps the intent text in step; never touches the form
      trigger: "background",
      intent: {
        ...current.intent,
        purpose: {
          content: updatedPurpose,
          updatedAt: new Date().toISOString(),
        },
      },
      provenance: {
        layer: "intent",
        action: "intent_synced_from_edit",
        actor: "system",
        rationale:
          kind === "design-decision"
            ? `Purpose updated after design decisions: ${bulkDescription}`
            : `Purpose updated after field edits: ${bulkDescription}`,
      },
    };
  });
  applyCommitToCache(queryClient, commit);
  if (superseded) {
    console.log(LOG_PREFIX, "purpose changed meanwhile — queued again");
    return { kind: "superseded" };
  }
  return { kind: "synced" };
}

// ---------------------------------------------------------------------------
// Helper: build a human-readable description of a field edit
// ---------------------------------------------------------------------------

export function buildEditDescription(
  oldField: Field | undefined,
  updates: Partial<Field>,
): string {
  const parts: string[] = [];
  const fieldName = updates.label ?? oldField?.label ?? "unknown";

  if (updates.label && oldField && updates.label !== oldField.label) {
    parts.push(`Renamed field "${oldField.label}" to "${updates.label}"`);
  }

  if (updates.type && oldField) {
    if (updates.type.kind !== oldField.type.kind) {
      parts.push(
        `Changed field "${fieldName}" type from ${oldField.type.kind} to ${updates.type.kind}`,
      );
    } else if (
      updates.type.kind === "select" &&
      oldField.type.kind === "select"
    ) {
      const oldOpts = oldField.type.options.map((o) => o.label).join(", ");
      const newOpts = updates.type.options.map((o) => o.label).join(", ");
      if (oldOpts !== newOpts) {
        parts.push(
          `Changed options for "${fieldName}" from [${oldOpts}] to [${newOpts}]`,
        );
      }
    }
  }

  if (
    updates.required !== undefined &&
    oldField &&
    updates.required !== oldField.required
  ) {
    parts.push(
      `Made field "${fieldName}" ${updates.required ? "required" : "optional"}`,
    );
  }

  if (
    updates.description !== undefined &&
    oldField &&
    updates.description !== oldField.description
  ) {
    parts.push(`Updated description of field "${fieldName}"`);
  }

  return parts.length > 0 ? parts.join(". ") : `Modified field "${fieldName}"`;
}
