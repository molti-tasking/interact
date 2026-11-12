/**
 * The intent out of step with the form, made visible (Phase 1B).
 *
 * The background update of the intent after field edits fails the way the
 * gateway fails — over budget, rate-limited, timed out — and the queue must
 * store and keep showing that until an update succeeds. The failures are
 * injected as the sync action reports them: through `llmErrorMessage`, from
 * the errors the gateway and the SDK actually raise.
 */
import { IntentSyncQueue, type SyncOutcome } from "@/lib/intent-sync-queue";
import { llmErrorMessage } from "@/lib/model";
import { APICallError } from "ai";
import {
  MAX_SYNC_ATTEMPTS,
  intentSyncStatus,
  type IntentSyncFlag,
} from "interact/forms/intent-sync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Gateway failures, as the sync action words them ----------------------

function budgetExceeded(): string {
  return llmErrorMessage(
    new Error("ExceededBudget: User=eval-key over budget. Spend=40.01, Budget=40.0"),
  );
}

function rateLimited(): string {
  return llmErrorMessage(
    new APICallError({
      message: "Too Many Requests",
      url: "http://gateway.local/v1/chat/completions",
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    }),
  );
}

function timedOut(): string {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return llmErrorMessage(error);
}

const failed = (message: string): SyncOutcome => ({ kind: "failed", message });
const SYNCED: SyncOutcome = { kind: "synced" };
const SUPERSEDED: SyncOutcome = { kind: "superseded" };

// --- A queue with a scripted gateway --------------------------------------

type Step = SyncOutcome | (() => Promise<SyncOutcome>);

function setup(steps: Step[], initial: IntentSyncFlag | null = null) {
  const stored: (IntentSyncFlag | null)[] = [];
  const batches: string[][] = [];
  const run = vi.fn(async (batch: { edits: { text: string }[] }) => {
    batches.push(batch.edits.map((e) => e.text));
    const step = steps.shift() ?? SYNCED;
    return typeof step === "function" ? step() : step;
  });
  const queue = new IntentSyncQueue(
    { run, writeFlag: (flag) => void stored.push(flag), random: () => 0.5 },
    initial,
  );
  return {
    queue,
    run,
    batches,
    stored,
    last: () => stored.at(-1),
    status: () => intentSyncStatus(queue.current, Date.now()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T10:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a failed update is stored, shown, and retried with backoff", () => {
  it("over budget: stays out of sync until a retry succeeds, then clears", async () => {
    const q = setup([failed(budgetExceeded()), SYNCED]);
    q.queue.schedule('Made field "Age" required');

    await vi.advanceTimersByTimeAsync(2_000); // debounce, then the call
    expect(q.run).toHaveBeenCalledTimes(1);
    expect(q.last()).toMatchObject({
      state: "failed",
      reason: "budget",
      edits: [{ text: 'Made field "Age" required', decision: false }],
    });
    expect(q.last()?.message).toMatch(/usage limit/);
    expect(q.status()).toBe("out-of-sync");

    // Backoff: not before 2 s
    await vi.advanceTimersByTimeAsync(1_999);
    expect(q.run).toHaveBeenCalledTimes(1);
    // While retrying, still shown (it failed before)
    await vi.advanceTimersByTimeAsync(1);
    expect(q.run).toHaveBeenCalledTimes(2);

    // Cleared only now, after the successful update — never before
    expect(q.stored.slice(0, -1)).not.toContain(null);
    expect(q.last()).toBeNull();
    expect(q.status()).toBe("in-sync");
  });

  it.each([
    ["rate-limited", rateLimited, "rate-limit", /busy/],
    ["timed out", timedOut, "timeout", /too long/],
  ])("%s: stored with its reason", async (_name, message, reason, text) => {
    const q = setup([failed(message())]);
    q.queue.schedule('Removed field "Notes"');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(q.last()).toMatchObject({ state: "failed", reason });
    expect(q.last()?.message).toMatch(text);
    expect(q.status()).toBe("out-of-sync");
  });

  it("gives up after the last automatic attempt; Retry now tries again", async () => {
    const q = setup(Array.from({ length: 10 }, () => failed(budgetExceeded())));
    q.queue.schedule('Renamed field "Name" to "Full name"');

    await vi.advanceTimersByTimeAsync(2_000 + 2_000 + 4_000 + 8_000);
    expect(q.run).toHaveBeenCalledTimes(MAX_SYNC_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(q.run).toHaveBeenCalledTimes(MAX_SYNC_ATTEMPTS);
    expect(q.last()).toMatchObject({ state: "failed", reason: "budget" });

    await q.queue.retryNow();
    expect(q.run).toHaveBeenCalledTimes(MAX_SYNC_ATTEMPTS + 1);
    expect(q.status()).toBe("out-of-sync");
  });
});

describe("a pending update", () => {
  it("is shown as out of sync once it takes longer than the timeout", async () => {
    let finish!: (o: SyncOutcome) => void;
    const q = setup([() => new Promise<SyncOutcome>((resolve) => (finish = resolve))]);
    q.queue.schedule('Made field "Email" optional');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(q.last()).toMatchObject({ state: "pending" });
    expect(q.status()).toBe("syncing");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(q.status()).toBe("out-of-sync");

    finish(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.last()).toBeNull();
  });

  it("keeps changes made during the call, and syncs them next", async () => {
    let finish!: (o: SyncOutcome) => void;
    const q = setup([() => new Promise<SyncOutcome>((resolve) => (finish = resolve)), SYNCED]);
    q.queue.schedule("first change");
    await vi.advanceTimersByTimeAsync(2_000);
    q.queue.schedule("second change", "design-decision");

    finish(SYNCED);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.last()).toMatchObject({
      state: "pending",
      edits: [{ text: "second change", decision: true }],
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(q.batches).toEqual([["first change"], ["second change"]]);
    expect(q.last()).toBeNull();
  });
});

describe("an update overtaken by a newer purpose (D9)", () => {
  it("is queued again as a new call on the current state, not dropped", async () => {
    const q = setup([SUPERSEDED, SYNCED]);
    q.queue.schedule('Added field "Phone"');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(q.run).toHaveBeenCalledTimes(1);
    // Still behind the form, and not counted as a failure
    expect(q.last()).toMatchObject({ state: "pending" });
    expect(q.last()?.reason).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1); // re-queued: a new call at once
    expect(q.run).toHaveBeenCalledTimes(2);
    expect(q.batches[1]).toEqual(['Added field "Phone"']);
    expect(q.last()).toBeNull();
  });

  it("is shown as out of sync when the purpose keeps changing", async () => {
    const q = setup([SUPERSEDED, SUPERSEDED, SUPERSEDED, SUPERSEDED]);
    q.queue.schedule('Added field "Phone"');
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(1); // re-queued: a new call at once
    await vi.advanceTimersByTimeAsync(1); // re-queued: a new call at once
    await vi.advanceTimersByTimeAsync(1); // re-queued: a new call at once
    expect(q.run).toHaveBeenCalledTimes(4);
    expect(q.last()).toMatchObject({ state: "failed", reason: "conflict" });
    expect(q.status()).toBe("out-of-sync");
  });
});

describe("across visits", () => {
  it("picks up changes an earlier visit left unsynced", async () => {
    const left: IntentSyncFlag = {
      state: "failed",
      since: "2026-11-12T09:00:00.000Z",
      edits: [{ text: 'Removed field "Notes"', at: "2026-11-12T09:00:00.000Z", decision: false }],
      attempts: 4,
      reason: "budget",
      message: budgetExceeded(),
    };
    const q = setup([SYNCED], left);
    expect(q.status()).toBe("out-of-sync");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(q.batches).toEqual([['Removed field "Notes"']]);
    expect(q.last()).toBeNull();
  });

  it("on leaving, runs what waits for its debounce and keeps a failure stored", async () => {
    const q = setup([failed(timedOut())]);
    q.queue.schedule('Made field "Age" required');
    await q.queue.close();
    expect(q.run).toHaveBeenCalledTimes(1);
    expect(q.last()).toMatchObject({ state: "failed", reason: "timeout" });
    // No retry after leaving: the next visit picks it up
    await vi.advanceTimersByTimeAsync(60_000);
    expect(q.run).toHaveBeenCalledTimes(1);
  });
});
