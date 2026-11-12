/**
 * Keeps the intent in step with the form after direct edits and applied
 * answers, and keeps the creator told when it isn't.
 *
 * Changes are batched (debounced) into one background model call that
 * rewords the purpose. While that is pending, and after it failed, the
 * portfolio carries an `intent_sync` flag (see `interact/forms/intent-sync`):
 *
 * - a failed call (budget, rate limit, timeout, …) marks the flag `failed`
 *   with the reason, and is retried with backoff (2 s, 4 s, 8 s ±20 %) up to
 *   `MAX_SYNC_ATTEMPTS`; after that only "Retry now" or the next change
 *   tries again;
 * - a call whose purpose changed meanwhile is not applied, and not dropped
 *   either: it is queued again, as a new call on the current state;
 * - the flag is cleared only once a call succeeded, and only if no change
 *   arrived meanwhile;
 * - a flag left from an earlier visit is picked up and tried again.
 *
 * No React and no network here: what to call and where to store the flag
 * are passed in, so tests can fail the gateway on purpose.
 */

import {
  MAX_SYNC_ATTEMPTS,
  retryDelayMs,
  syncFailureReason,
  type IntentSyncFlag,
  type UnsyncedEdit,
} from "interact/forms/intent-sync";

export type SyncOutcome =
  /** The purpose now reflects the changes (rewritten, or nothing to change) */
  | { kind: "synced" }
  /** The purpose changed while the call ran: nothing was applied */
  | { kind: "superseded" }
  | { kind: "failed"; message: string };

export interface IntentSyncQueueOptions {
  /** One model call on the current state; applies the result if it can */
  run: (batch: { edits: UnsyncedEdit[]; decision: boolean }) => Promise<SyncOutcome>;
  /** Store the flag with the portfolio (null: the intent is in step) */
  writeFlag: (flag: IntentSyncFlag | null) => Promise<void> | void;
  now?: () => number;
  random?: () => number;
  /** Changes made within this window go into one call */
  debounceMs?: number;
  /** Times a call superseded by a newer purpose is queued again in a row */
  maxRequeues?: number;
}

export const SYNC_DEBOUNCE_MS = 2_000;
const MAX_REQUEUES = 3;

export class IntentSyncQueue {
  private flag: IntentSyncFlag | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private requeues = 0;
  private disposed = false;

  constructor(
    private readonly opts: IntentSyncQueueOptions,
    initial: IntentSyncFlag | null = null,
  ) {
    this.flag = initial;
    // Changes left from an earlier visit (or another tab): try again
    if (initial?.edits.length) this.later(this.debounceMs);
  }

  /** The flag as this queue last stored it */
  get current(): IntentSyncFlag | null {
    return this.flag;
  }

  /** A change the intent should follow; synced after the debounce. */
  schedule(text: string, kind: "field-edit" | "design-decision" = "field-edit"): void {
    if (this.disposed) return;
    const edit: UnsyncedEdit = {
      text,
      at: new Date(this.now()).toISOString(),
      decision: kind === "design-decision",
    };
    this.flag = this.flag
      ? // A new change gets a fresh set of automatic attempts
        { ...this.flag, edits: [...this.flag.edits, edit], attempts: 0 }
      : { state: "pending", since: edit.at, edits: [edit], attempts: 0 };
    this.later(this.debounceMs);
  }

  /** Try again now ("Retry now"), with a fresh set of attempts. */
  retryNow(): Promise<void> {
    if (!this.flag || this.disposed) return Promise.resolve();
    this.flag = { ...this.flag, attempts: 0 };
    this.requeues = 0;
    this.clearTimer();
    return this.flush();
  }

  /**
   * Leaving: run what is still waiting for its debounce, then stop. A
   * failed or pending flag stays stored, to be picked up on the next visit.
   */
  async close(): Promise<void> {
    const waiting = this.timer !== null;
    this.clearTimer();
    const work = waiting ? this.flush() : this.running;
    this.disposed = true;
    await work;
    await this.writing;
  }

  // -------------------------------------------------------------------------

  private get debounceMs() {
    return this.opts.debounceMs ?? SYNC_DEBOUNCE_MS;
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number) {
    if (this.disposed) return;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** Writes go out in order, and a failed write doesn't stop the queue. */
  private write(): Promise<void> {
    const flag = this.flag;
    this.writing = this.writing
      .then(() => this.opts.writeFlag(flag))
      .catch((err) => console.error("[intent-sync] could not store the flag:", err));
    return this.writing;
  }

  /** One attempt at a time; a second flush waits for the first. */
  private async flush(): Promise<void> {
    while (this.running) await this.running;
    if (!this.flag?.edits.length) return;
    const attempt = this.attempt();
    this.running = attempt;
    try {
      await attempt;
    } finally {
      if (this.running === attempt) this.running = null;
    }
  }

  private async attempt(): Promise<void> {
    const start = this.flag!;
    const batch = start.edits;
    const attempts = start.attempts + 1;
    this.flag = { ...start, state: "pending", attempts };
    await this.write();

    let outcome: SyncOutcome;
    try {
      outcome = await this.opts.run({
        edits: batch,
        decision: batch.some((e) => e.decision),
      });
    } catch (err) {
      outcome = { kind: "failed", message: err instanceof Error ? err.message : String(err) };
    }

    // Changes made while the call ran are still to be synced
    const latest = this.flag!;
    switch (outcome.kind) {
      case "synced": {
        this.requeues = 0;
        const rest = latest.edits.slice(batch.length);
        this.flag = rest.length
          ? { state: "pending", since: rest[0].at, edits: rest, attempts: 0 }
          : null;
        await this.write();
        if (rest.length) this.later(this.debounceMs);
        return;
      }
      case "superseded": {
        // A new call on the current state; not counted as a failed attempt
        if (++this.requeues > (this.opts.maxRequeues ?? MAX_REQUEUES)) {
          this.requeues = 0;
          this.flag = {
            ...latest,
            state: "failed",
            reason: "conflict",
            message: "The description kept changing while it was being updated.",
          };
          await this.write();
          return;
        }
        this.flag = { ...latest, attempts: attempts - 1 };
        this.later(0);
        return;
      }
      case "failed": {
        this.flag = {
          ...latest,
          state: "failed",
          reason: syncFailureReason(outcome.message),
          message: outcome.message,
        };
        await this.write();
        if (attempts < MAX_SYNC_ATTEMPTS) {
          this.later(retryDelayMs(attempts, this.opts.random));
        }
        return;
      }
    }
  }
}
