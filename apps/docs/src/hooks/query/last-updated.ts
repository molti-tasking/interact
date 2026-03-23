"use client";

import { useMemo } from "react";
import type { ProvenanceEntry } from "@/lib/types";

/**
 * Derive the last-updated timestamps for intent and schema
 * from the provenance log entries.
 *
 * Intent actions: "intent_updated", "prompt_edit", opinion resolutions that change intent
 * Schema actions: "schema_generated", "field_modified", "field_removed", "prompt_edit",
 *                 opinion resolutions that change schema
 */

const INTENT_ACTIONS = new Set([
  "intent_updated",
  "prompt_edit",
  "opinion_resolved",
]);

const SCHEMA_ACTIONS = new Set([
  "schema_generated",
  "field_modified",
  "field_removed",
  "field_added",
  "prompt_edit",
  "opinion_resolved",
  "standard_accepted",
]);

export interface LastUpdatedTimestamps {
  intentUpdatedAt: string | null;
  schemaUpdatedAt: string | null;
}

export function useLastUpdated(
  provenanceEntries: ProvenanceEntry[] | undefined,
  portfolioCreatedAt: string | null | undefined,
): LastUpdatedTimestamps {
  return useMemo(() => {
    if (!provenanceEntries || provenanceEntries.length === 0) {
      return {
        intentUpdatedAt: portfolioCreatedAt ?? null,
        schemaUpdatedAt: portfolioCreatedAt ?? null,
      };
    }

    // Entries are sorted descending (newest first)
    let intentUpdatedAt: string | null = null;
    let schemaUpdatedAt: string | null = null;

    for (const entry of provenanceEntries) {
      if (!intentUpdatedAt && INTENT_ACTIONS.has(entry.action)) {
        intentUpdatedAt = entry.created_at;
      }
      if (!schemaUpdatedAt && SCHEMA_ACTIONS.has(entry.action)) {
        schemaUpdatedAt = entry.created_at;
      }
      if (intentUpdatedAt && schemaUpdatedAt) break;
    }

    return {
      intentUpdatedAt: intentUpdatedAt ?? portfolioCreatedAt ?? null,
      schemaUpdatedAt: schemaUpdatedAt ?? portfolioCreatedAt ?? null,
    };
  }, [provenanceEntries, portfolioCreatedAt]);
}

/**
 * Format a timestamp as a relative or absolute time string.
 */
export function formatLastUpdated(timestamp: string | null): string {
  if (!timestamp) return "never";

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
