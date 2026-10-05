import { describe, expect, it } from "vitest";
import {
  createLevelDetector,
  createSegmenter,
  type CutReason,
} from "@/lib/voice/segmenter";

const TICK = 50;

/** Drive a segmenter with a voiced/silent pattern; returns cut times. */
function run(
  segmenter: ReturnType<typeof createSegmenter>,
  pattern: { ms: number; voiced: boolean | null }[],
  hooks: { at?: number; boundary?: boolean }[] = [],
): { at: number; reason: CutReason }[] {
  const cuts: { at: number; reason: CutReason }[] = [];
  let t = 0;
  for (const { ms, voiced } of pattern) {
    for (let elapsed = 0; elapsed < ms; elapsed += TICK) {
      t += TICK;
      for (const h of hooks) {
        if (h.boundary && h.at === t) segmenter.requestBoundary(t);
      }
      const reason = segmenter.tick(t, voiced);
      if (reason) {
        cuts.push({ at: t, reason });
        segmenter.startSegment(t);
      }
    }
  }
  return cuts;
}

describe("segmenter", () => {
  it("cuts a phrase at the first pause long enough (private mode)", () => {
    const s = createSegmenter({ pauseMs: 900 }, 0);
    const cuts = run(s, [
      { ms: 2000, voiced: true },
      { ms: 400, voiced: false }, // short breath — no cut
      { ms: 1500, voiced: true },
      { ms: 1000, voiced: false },
    ]);
    expect(cuts).toHaveLength(1);
    expect(cuts[0].reason).toBe("pause");
    expect(cuts[0].at).toBeGreaterThanOrEqual(2000 + 400 + 1500 + 900);
  });

  it("places a recognizer boundary in the next silence, not mid-word", () => {
    const s = createSegmenter({}, 0);
    const cuts = run(
      s,
      [
        { ms: 1000, voiced: true }, // boundary arrives while still talking
        { ms: 300, voiced: false },
      ],
      [{ at: 500, boundary: true }],
    );
    expect(cuts).toEqual([{ at: 1000 + 150, reason: "boundary" }]);
  });

  it("forces a boundary cut when no silence comes", () => {
    const s = createSegmenter({ boundaryMaxWaitMs: 1200 }, 0);
    const cuts = run(s, [{ ms: 3000, voiced: true }], [
      { at: 500, boundary: true },
    ]);
    expect(cuts[0]).toEqual({ at: 1700, reason: "boundary" });
  });

  it("cuts immediately on a boundary when there is no level data", () => {
    const s = createSegmenter({}, 0);
    const cuts = run(s, [{ ms: 1000, voiced: null }], [
      { at: 300, boundary: true },
    ]);
    expect(cuts[0]).toEqual({ at: 300, reason: "boundary" });
  });

  it("chunks continuous speech at ~30 s, preferring a short silence", () => {
    const s = createSegmenter({ softMaxMs: 30_000, hardMaxMs: 40_000 }, 0);
    const cuts = run(s, [
      { ms: 31_000, voiced: true },
      { ms: 200, voiced: false },
      { ms: 5_000, voiced: true },
    ]);
    expect(cuts[0].reason).toBe("max-length");
    expect(cuts[0].at).toBe(31_000 + 150);
  });

  it("forces a cut at the hard maximum without any silence", () => {
    const s = createSegmenter({ softMaxMs: 30_000, hardMaxMs: 40_000 }, 0);
    const cuts = run(s, [{ ms: 45_000, voiced: true }]);
    expect(cuts[0]).toEqual({ at: 40_000, reason: "max-length" });
  });

  it("chunks at the soft maximum when level data is unavailable", () => {
    const s = createSegmenter({ softMaxMs: 30_000 }, 0);
    const cuts = run(s, [{ ms: 31_000, voiced: null }]);
    expect(cuts[0]).toEqual({ at: 30_000, reason: "max-length" });
  });

  it("recycles a segment that stayed silent", () => {
    const s = createSegmenter({ idleRecycleMs: 10_000 }, 0);
    const cuts = run(s, [{ ms: 10_500, voiced: false }]);
    expect(cuts[0].reason).toBe("idle");
    expect(s.voicedMs).toBe(0);
  });

  it("never pause-cuts when pause segmentation is off", () => {
    const s = createSegmenter({ pauseMs: null }, 0);
    const cuts = run(s, [
      { ms: 2000, voiced: true },
      { ms: 3000, voiced: false },
    ]);
    expect(cuts).toEqual([]);
  });

  it("can switch to pause segmentation mid-session", () => {
    const s = createSegmenter({ pauseMs: null }, 0);
    s.setPauseMs(900);
    const cuts = run(s, [
      { ms: 1000, voiced: true },
      { ms: 1000, voiced: false },
    ]);
    expect(cuts[0]?.reason).toBe("pause");
  });
});

describe("level detector", () => {
  it("separates speech from the room's noise floor", () => {
    const d = createLevelDetector();
    let t = 0;
    for (let i = 0; i < 40; i++) d.update((t += 50), 0.004); // quiet room
    expect(d.update((t += 50), 0.006)).toBe(false);
    expect(d.update((t += 50), 0.08)).toBe(true);
  });

  it("raises the threshold in a noisy room", () => {
    const d = createLevelDetector();
    let t = 0;
    for (let i = 0; i < 40; i++) d.update((t += 50), 0.02); // fan noise
    expect(d.update((t += 50), 0.04)).toBe(false);
    expect(d.update((t += 50), 0.12)).toBe(true);
  });

  it("tracks the peak level", () => {
    const d = createLevelDetector();
    d.update(0, 0.01);
    d.update(50, 0.3);
    expect(d.peak).toBe(0.3);
  });
});
