/**
 * Is the intent in step with the form?
 *
 * After a direct field edit (or an applied answer) a background model call
 * rewords the purpose to match the form. Until that call succeeds the intent
 * lags behind, and when it fails — the gateway's budget, a rate limit, a
 * timeout — the creator must be able to see it. In the workshop pilot such
 * failures were silent.
 *
 * The state is stored with the portfolio (`portfolios.intent_sync`, NULL
 * when in step). These helpers decide what it means; the queue that keeps
 * it is in the app (`lib/intent-sync-queue.ts`).
 */

export type IntentSyncReason =
  | "budget"
  | "rate-limit"
  | "timeout"
  /** The purpose kept changing while the update was worked out */
  | "conflict"
  | "other";

/** A change the intent doesn't reflect yet */
export interface UnsyncedEdit {
  /** e.g. `Renamed field "Name" to "Full name"` */
  text: string;
  /** ISO time it was made */
  at: string;
  /** An applied answer (the purpose should follow), not a direct edit */
  decision: boolean;
}

export interface IntentSyncFlag {
  /** An update is under way or scheduled, or the last attempt failed */
  state: "pending" | "failed";
  /** ISO time of the oldest change not yet reflected */
  since: string;
  /** Oldest first */
  edits: UnsyncedEdit[];
  /** Attempts for these changes so far */
  attempts: number;
  /** Why the last attempt failed; kept while it is tried again */
  reason?: IntentSyncReason;
  /** The last failure, in plain language */
  message?: string;
}

/** After this long an update still pending counts as out of sync. */
export const INTENT_SYNC_STALE_MS = 30_000;

/** Automatic attempts for one set of changes (then "Retry now"). */
export const MAX_SYNC_ATTEMPTS = 4;

export type IntentSyncStatus = "in-sync" | "syncing" | "out-of-sync";

/**
 * - no flag → in sync;
 * - the last attempt failed, or one failed and it is being tried again →
 *   out of sync;
 * - pending for `staleMs` or longer → out of sync;
 * - otherwise → syncing (not shown as a problem yet).
 */
export function intentSyncStatus(
  flag: IntentSyncFlag | null | undefined,
  now: number,
  staleMs: number = INTENT_SYNC_STALE_MS,
): IntentSyncStatus {
  if (!flag) return "in-sync";
  if (flag.state === "failed" || flag.reason) return "out-of-sync";
  const since = Date.parse(flag.since);
  return Number.isFinite(since) && now - since >= staleMs ? "out-of-sync" : "syncing";
}

/**
 * Why a sync failed, from its error message — the plain-language one the
 * app shows (`llmErrorMessage`) or the gateway's own.
 */
export function syncFailureReason(message: string): IntentSyncReason {
  if (/usage limit|budget/i.test(message)) return "budget";
  if (/busy|rate.?limit|too many requests|\b429\b/i.test(message)) return "rate-limit";
  if (/too long|timed? ?out|timeout|aborted/i.test(message)) return "timeout";
  return "other";
}

/** Wait before automatic attempt `attempt + 1`: 2 s, 4 s, 8 s …, ±20 %. */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 2_000 * 2 ** Math.max(0, attempt - 1);
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** What the creator is told, per reason. */
export function syncReasonText(reason: IntentSyncReason | undefined): string {
  switch (reason) {
    case "budget":
      return "the AI service has reached its usage limit";
    case "rate-limit":
      return "the AI service is busy";
    case "timeout":
      return "the AI took too long to answer";
    case "conflict":
      return "the description kept changing while it was being updated";
    case "other":
      return "the update failed";
    default:
      return "the update is taking longer than usual";
  }
}
