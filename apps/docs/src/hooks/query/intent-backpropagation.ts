"use client";

import { syncIntentFromFieldEditAction } from "@/app/actions/design-probe-actions";
import { useUpdatePortfolio } from "@/hooks/query/portfolios";
import { sanitizePurposeText } from "@/lib/engine/structured-intent";
import type { Field, Portfolio, PortfolioSchema } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

const LOG_PREFIX = "[IntentBackpropagation]";

/**
 * Hook that debounces field edit descriptions and sends a single
 * batched LLM call to sync the intent/purpose text.
 *
 * Usage:
 *   const { scheduleSync } = useIntentBackpropagation(portfolio);
 *   // after saving a field edit:
 *   scheduleSync('Renamed field "Name" to "Full Name"');
 */
export function useIntentBackpropagation(portfolio: Portfolio | null | undefined) {
  const updatePortfolio = useUpdatePortfolio();
  const queryClient = useQueryClient();

  const pendingEditsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a ref to the latest portfolio so the flush closure always sees
  // the most recent data, even if the component re-rendered since the
  // timer was started.
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;

  const flush = useCallback(async () => {
    const p = portfolioRef.current;
    if (!p || pendingEditsRef.current.length === 0) {
      console.log(LOG_PREFIX, "flush skipped — no portfolio or no pending edits");
      return;
    }

    const descriptions = [...pendingEditsRef.current];
    pendingEditsRef.current = [];
    const bulkDescription = descriptions.join(". ");

    const currentSchema = p.schema as unknown as PortfolioSchema;

    console.log(LOG_PREFIX, "flushing", descriptions.length, "edits:", bulkDescription);
    console.log(LOG_PREFIX, "current purpose:", p.intent.purpose.content.slice(0, 120) + "…");

    try {
      const syncResult = await syncIntentFromFieldEditAction({
        intent: p.intent,
        currentSchema,
        editDescription: bulkDescription,
      });

      console.log(LOG_PREFIX, "LLM response:", {
        success: syncResult.success,
        shouldUpdate: syncResult.shouldUpdate,
        hasUpdatedPurpose: !!syncResult.updatedPurpose,
        error: syncResult.error,
      });

      if (!syncResult.success) {
        console.error(LOG_PREFIX, "action failed:", syncResult.error);
        return;
      }

      if (!syncResult.shouldUpdate) {
        console.log(LOG_PREFIX, "LLM says no update needed — skipping");
        return;
      }

      if (!syncResult.updatedPurpose) {
        console.warn(LOG_PREFIX, "shouldUpdate=true but no updatedPurpose returned");
        return;
      }

      console.log(LOG_PREFIX, "updating intent purpose to:", syncResult.updatedPurpose.slice(0, 120) + "…");

      await updatePortfolio.mutateAsync({
        id: p.id,
        intent: {
          ...p.intent,
          purpose: {
            content: sanitizePurposeText(syncResult.updatedPurpose),
            updatedAt: new Date().toISOString(),
          },
        },
      });

      queryClient.invalidateQueries({ queryKey: ["portfolios", p.id] });
      console.log(LOG_PREFIX, "intent updated and queries invalidated");
    } catch (err) {
      console.error(LOG_PREFIX, "flush error:", err);
    }
  }, [updatePortfolio, queryClient]);

  const scheduleSync = useCallback(
    (editDescription: string) => {
      pendingEditsRef.current.push(editDescription);
      console.log(
        LOG_PREFIX,
        "queued edit:",
        editDescription,
        `(${pendingEditsRef.current.length} pending)`,
      );

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        console.log(LOG_PREFIX, "debounce timer fired — flushing");
        flush();
      }, 2000);
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
