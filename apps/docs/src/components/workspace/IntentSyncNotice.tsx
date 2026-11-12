"use client";

import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import {
  INTENT_SYNC_STALE_MS,
  intentSyncStatus,
  syncReasonText,
  type IntentSyncFlag,
} from "interact/forms/intent-sync";
import { RefreshCw, TriangleAlert } from "lucide-react";

/** How long an update may be pending before it is shown (configurable) */
const STALE_MS =
  Number(process.env.NEXT_PUBLIC_INTENT_SYNC_STALE_MS) || INTENT_SYNC_STALE_MS;

/**
 * Shown in the intent editor when the intent no longer reflects the form:
 * the update after a field edit or an answer failed, or is still pending
 * after a while. Gone once an update succeeded.
 */
export function IntentSyncNotice({
  flag,
  onRetry,
  now: fixedNow,
}: {
  flag: IntentSyncFlag | null | undefined;
  onRetry?: () => void;
  /** For tests: the current time */
  now?: number;
}) {
  const ticking = useNow(5_000);
  const now = fixedNow ?? ticking;
  if (!flag || intentSyncStatus(flag, now, STALE_MS) !== "out-of-sync") return null;

  const n = flag.edits.length;
  // A pending update without a failure yet is merely slow
  const reason = flag.state === "failed" || flag.reason ? flag.reason : undefined;
  return (
    <div
      role="status"
      data-testid="intent-sync-notice"
      data-reason={reason ?? "pending"}
      className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">The intent may not match the form</p>
        <p>
          {n} change{n === 1 ? "" : "s"} to the form {n === 1 ? "is" : "are"} not
          reflected in it yet: {syncReasonText(reason)}.
        </p>
      </div>
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={onRetry}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Retry now
        </Button>
      )}
    </div>
  );
}
