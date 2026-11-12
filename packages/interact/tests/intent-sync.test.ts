import { describe, expect, it } from "vitest";
import {
  INTENT_SYNC_STALE_MS,
  intentSyncStatus,
  retryDelayMs,
  syncFailureReason,
  type IntentSyncFlag,
} from "../src/forms/intent-sync";

const at = (ms: number) => new Date(ms).toISOString();
const flag = (overrides: Partial<IntentSyncFlag> = {}): IntentSyncFlag => ({
  state: "pending",
  since: at(0),
  edits: [{ text: 'Made field "Age" required', at: at(0), decision: false }],
  attempts: 1,
  ...overrides,
});

describe("is the intent in step with the form?", () => {
  it("is in sync without a flag", () => {
    expect(intentSyncStatus(null, 0)).toBe("in-sync");
  });

  it("is syncing while an update is pending, and out of sync once it takes too long", () => {
    expect(intentSyncStatus(flag(), INTENT_SYNC_STALE_MS - 1)).toBe("syncing");
    expect(intentSyncStatus(flag(), INTENT_SYNC_STALE_MS)).toBe("out-of-sync");
    expect(intentSyncStatus(flag(), 1_000, 500)).toBe("out-of-sync");
  });

  it("is out of sync as soon as an update failed, also while it is tried again", () => {
    expect(intentSyncStatus(flag({ state: "failed", reason: "budget" }), 1)).toBe("out-of-sync");
    expect(intentSyncStatus(flag({ state: "pending", reason: "timeout" }), 1)).toBe("out-of-sync");
  });
});

describe("why an update failed", () => {
  it("reads the plain-language messages the app shows", () => {
    expect(
      syncFailureReason("The AI service has reached its usage limit. Please tell the study team; your work so far is saved."),
    ).toBe("budget");
    expect(syncFailureReason("The AI service is busy right now. Please try again in a moment.")).toBe("rate-limit");
    expect(syncFailureReason("The AI took too long to answer. Please try again.")).toBe("timeout");
  });

  it("reads the gateway's own messages", () => {
    expect(syncFailureReason("ExceededBudget: User=… over budget")).toBe("budget");
    expect(syncFailureReason("429 Too Many Requests")).toBe("rate-limit");
    expect(syncFailureReason("The operation was aborted due to timeout")).toBe("timeout");
    expect(syncFailureReason("No structured output")).toBe("other");
  });
});

describe("backoff", () => {
  it("doubles from 2 s with ±20 % jitter", () => {
    expect(retryDelayMs(1, () => 0.5)).toBe(2_000);
    expect(retryDelayMs(2, () => 0.5)).toBe(4_000);
    expect(retryDelayMs(3, () => 0.5)).toBe(8_000);
    expect(retryDelayMs(1, () => 0)).toBe(1_600);
    expect(retryDelayMs(1, () => 1)).toBe(2_400);
  });
});
