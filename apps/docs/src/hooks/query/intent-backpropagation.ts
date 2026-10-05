"use client";

import { syncIntentFromFieldEditAction } from "@/app/actions/design-probe-actions";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { sanitizePurposeText } from "@/lib/engine/structured-intent";
import type { Field, Portfolio } from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { applyCommitToCache } from "./portfolios";

const LOG_PREFIX = "[IntentBackpropagation]";
const DEBOUNCE_MS = 2000;

/**
 * Hook that debounces field edit descriptions and sends a single
 * batched LLM call to sync the intent/purpose text.
 *
 * The rewrite is computed from the purpose as it was when the flush started.
 * If anything else changed the purpose while the LLM was working (a resolved
 * probe, the user typing), the automated rewrite is dropped rather than
 * clobbering the newer human/probe change.
 *
 * Usage:
 *   const { scheduleSync } = useIntentBackpropagation(portfolio);
 *   // after saving a field edit:
 *   scheduleSync('Renamed field "Name" to "Full Name"');
 */
export function useIntentBackpropagation(
  portfolio: Portfolio | null | undefined,
) {
  const queryClient = useQueryClient();

  const pendingEditsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  // Latest portfolio for the flush closure (updated after render, not during)
  const portfolioRef = useRef(portfolio);
  useEffect(() => {
    portfolioRef.current = portfolio;
  }, [portfolio]);

  const flush = useCallback(async (): Promise<void> => {
    // Serialize flushes: a second batch waits for the first to land, so
    // rewrites can't apply out of order.
    if (inFlightRef.current) await inFlightRef.current;

    const p = portfolioRef.current;
    if (!p || pendingEditsRef.current.length === 0) return;

    const descriptions = [...pendingEditsRef.current];
    pendingEditsRef.current = [];
    const bulkDescription = descriptions.join(". ");
    const basePurpose = p.intent.purpose.content;

    const run = trackActivity(p.id, "Syncing intent", async () => {
      try {
        const syncResult = await syncIntentFromFieldEditAction({
          intent: p.intent,
          currentSchema: p.schema,
          editDescription: bulkDescription,
        });

        if (!syncResult.success) {
          console.error(LOG_PREFIX, "action failed:", syncResult.error);
          return;
        }
        if (!syncResult.shouldUpdate || !syncResult.updatedPurpose) return;

        const updatedPurpose = sanitizePurposeText(syncResult.updatedPurpose);
        const commit = await commitPortfolioChange(p.id, (current) => {
          if (current.intent.purpose.content !== basePurpose) {
            console.log(LOG_PREFIX, "purpose changed meanwhile — skipping");
            return null;
          }
          return {
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
              rationale: `Purpose updated after field edits: ${bulkDescription}`,
            },
          };
        });
        applyCommitToCache(queryClient, commit);
      } catch (err) {
        console.error(LOG_PREFIX, "flush error:", err);
      }
    });

    inFlightRef.current = run.finally(() => {
      inFlightRef.current = null;
    });
    await inFlightRef.current;
  }, [queryClient]);

  const scheduleSync = useCallback(
    (editDescription: string) => {
      pendingEditsRef.current.push(editDescription);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void flush();
      }, DEBOUNCE_MS);
    },
    [flush],
  );

  // Leaving the workspace: flush what's pending now instead of dropping it
  // (the flush captured its portfolio, so it writes to the right one).
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void flush();
      }
    },
    [flush],
  );

  return { scheduleSync };
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
