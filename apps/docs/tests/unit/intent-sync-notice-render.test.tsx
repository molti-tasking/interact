/**
 * The intent editor says when the intent no longer reflects the form: after
 * a failed update at once, after a slow one once it takes too long, and not
 * at all while it is in step.
 */
import { IntentSyncNotice } from "@/components/workspace/IntentSyncNotice";
import { fireEvent, render, screen } from "@testing-library/react";
import { INTENT_SYNC_STALE_MS, type IntentSyncFlag } from "interact/forms/intent-sync";
import { describe, expect, it, vi } from "vitest";

const T0 = Date.parse("2026-11-12T10:00:00Z");
const flag = (overrides: Partial<IntentSyncFlag> = {}): IntentSyncFlag => ({
  state: "pending",
  since: new Date(T0).toISOString(),
  edits: [
    { text: 'Made field "Age" required', at: new Date(T0).toISOString(), decision: false },
    { text: 'Removed field "Notes"', at: new Date(T0).toISOString(), decision: false },
  ],
  attempts: 1,
  ...overrides,
});

describe("out-of-sync notice in the intent editor", () => {
  it("shows nothing while the intent is in step", () => {
    render(<IntentSyncNotice flag={null} now={T0} />);
    expect(screen.queryByTestId("intent-sync-notice")).toBeNull();
  });

  it("shows nothing while an update is under way, and the delay once it is slow", () => {
    const view = render(<IntentSyncNotice flag={flag()} now={T0 + 1_000} />);
    expect(screen.queryByTestId("intent-sync-notice")).toBeNull();

    view.rerender(<IntentSyncNotice flag={flag()} now={T0 + INTENT_SYNC_STALE_MS} />);
    const notice = screen.getByTestId("intent-sync-notice");
    expect(notice).toHaveAttribute("data-reason", "pending");
    expect(notice).toHaveTextContent("2 changes to the form are not reflected in it yet");
    expect(notice).toHaveTextContent("taking longer than usual");
  });

  it("names the reason of a failed update, and offers to retry", () => {
    const onRetry = vi.fn();
    render(
      <IntentSyncNotice
        flag={flag({ state: "failed", reason: "budget", message: "…" })}
        now={T0 + 1}
        onRetry={onRetry}
      />,
    );
    const notice = screen.getByTestId("intent-sync-notice");
    expect(notice).toHaveAttribute("data-reason", "budget");
    expect(notice).toHaveTextContent("The intent may not match the form");
    expect(notice).toHaveTextContent("usage limit");
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
