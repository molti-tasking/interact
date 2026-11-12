/**
 * The background queue for answer previews: at most five at once, the most
 * important question first (the open one before all), and a click that
 * waits for a preview already under way instead of starting another call.
 */
import { MAX_CONCURRENT_PREVIEWS, PreviewQueue } from "@/lib/preview-queue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A task that runs until `finish(id)` is called; records the start order. */
function harness(max = MAX_CONCURRENT_PREVIEWS) {
  const queue = new PreviewQueue(max);
  const started: string[] = [];
  const finishers = new Map<string, () => void>();
  const add = (id: string, priority: number, createdAt: string) =>
    queue.run(
      () =>
        new Promise<void>((resolve) => {
          started.push(id);
          finishers.set(id, resolve);
        }),
      { probeId: id, rank: [priority, createdAt] },
    );
  const finish = async (id: string) => {
    finishers.get(id)!();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { queue, started, add, finish };
}

describe("preview queue", () => {
  it("runs at most five previews at once and starts the next when one ends", async () => {
    const h = harness();
    for (let i = 0; i < 7; i++) h.add(`q${i}`, 2, `2026-01-01T00:00:0${i}Z`);
    expect(h.queue.size).toEqual({ running: 5, queued: 2 });
    await h.finish(h.started[0]);
    expect(h.queue.size).toEqual({ running: 5, queued: 1 });
  });

  it("starts the most important first, newest first within a priority", async () => {
    const h = harness(1);
    h.add("busy", 2, "2026-01-01T00:00:00Z"); // takes the only slot
    h.add("lowOld", 3, "2026-01-01T00:00:01Z");
    h.add("midOld", 2, "2026-01-01T00:00:02Z");
    h.add("midNew", 2, "2026-01-01T00:00:03Z");
    h.add("high", 1, "2026-01-01T00:00:04Z");
    for (const id of ["busy", "high", "midNew", "midOld"]) await h.finish(id);
    expect(h.started).toEqual(["busy", "high", "midNew", "midOld", "lowOld"]);
  });

  it("moves the open question to the front", async () => {
    const h = harness(1);
    h.add("busy", 1, "2026-01-01T00:00:00Z");
    h.add("high", 1, "2026-01-01T00:00:01Z");
    h.add("opened", 3, "2026-01-01T00:00:02Z");
    h.queue.prioritize("opened");
    await h.finish("busy");
    expect(h.started).toEqual(["busy", "opened"]);
  });

  it("lets a click wait for a preview under way, up to 30 s", async () => {
    const h = harness();
    expect(await h.queue.wait("unknown")).toBe(false);

    h.add("q1", 2, "2026-01-01T00:00:00Z");
    let waited = false;
    void h.queue.wait("q1").then((r) => (waited = r));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(waited).toBe(false);
    await h.finish("q1");
    expect(waited).toBe(true);

    // A preview that never comes: the click gives up after 30 s
    h.add("q2", 2, "2026-01-01T00:00:01Z");
    let gaveUp = false;
    void h.queue.wait("q2").then(() => (gaveUp = true));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(gaveUp).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(gaveUp).toBe(true);
  });
});
