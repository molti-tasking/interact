/**
 * Pure, clock-driven logic deciding *when* to cut a continuous recording into
 * segments. No browser APIs — the capture session feeds it timestamps and
 * voice-activity readings, so it can be unit-tested deterministically.
 *
 * Cuts are placed in silence wherever possible so no word is split across
 * two uploads; when there's no silence to be found, a cut is forced (the
 * capture session overlaps consecutive recorders, so nothing is dropped).
 */

// ---------------------------------------------------------------------------
// Voice activity (level → voiced / silent)
// ---------------------------------------------------------------------------

export interface LevelDetectorConfig {
  /** RMS below this is never speech, whatever the noise floor. */
  minThreshold: number;
  /** Speech must be this many times louder than the noise floor. */
  floorRatio: number;
  /** Window for the rolling-minimum noise floor estimate. */
  windowMs: number;
}

export const DEFAULT_LEVEL_CONFIG: LevelDetectorConfig = {
  minThreshold: 0.01,
  floorRatio: 3,
  windowMs: 8000,
};

/**
 * Adaptive voice-activity detector over RMS levels: the noise floor is the
 * minimum level seen in a rolling window (speech always has inter-word dips,
 * so the minimum tracks the room, not the speaker).
 */
export function createLevelDetector(
  config: LevelDetectorConfig = DEFAULT_LEVEL_CONFIG,
) {
  const samples: { t: number; rms: number }[] = [];
  let peak = 0;

  return {
    /** Feed one RMS reading; returns whether it counts as speech. */
    update(now: number, rms: number): boolean {
      samples.push({ t: now, rms });
      while (samples.length > 0 && now - samples[0].t > config.windowMs) {
        samples.shift();
      }
      peak = Math.max(peak, rms);
      let floor = rms;
      for (const s of samples) floor = Math.min(floor, s.rms);
      const threshold = Math.max(config.minThreshold, floor * config.floorRatio);
      return rms > threshold;
    },
    /** Loudest reading so far — 0 means the analyser delivers no signal. */
    get peak() {
      return peak;
    },
  };
}

// ---------------------------------------------------------------------------
// Segmenter
// ---------------------------------------------------------------------------

export interface SegmenterConfig {
  /**
   * Phrase segmentation by pauses: cut once this much silence follows
   * speech. `null` disables it (boundaries come from elsewhere, or the
   * recording is one clip).
   */
  pauseMs: number | null;
  /** Speech needed in a segment before a pause can end it. */
  minPhraseMs: number;
  /** After an external boundary (recognizer final): silence needed to cut. */
  boundarySilenceMs: number;
  /** After an external boundary: cut anyway after this long. */
  boundaryMaxWaitMs: number;
  /** Past this age, cut at the next short silence… */
  softMaxMs: number;
  /** …and past this age, cut regardless. */
  hardMaxMs: number;
  /** Silence needed for a soft-max cut. */
  softMaxSilenceMs: number;
  /**
   * A segment with no speech yet is recycled after this long in silence, so
   * the segment a phrase eventually lands in starts close to it.
   */
  idleRecycleMs: number;
}

export const DEFAULT_SEGMENTER_CONFIG: SegmenterConfig = {
  pauseMs: null,
  minPhraseMs: 300,
  boundarySilenceMs: 150,
  boundaryMaxWaitMs: 1200,
  softMaxMs: 30_000,
  hardMaxMs: 40_000,
  softMaxSilenceMs: 150,
  idleRecycleMs: 10_000,
};

/** Ticks further apart than this (throttled background tabs) count as this. */
const MAX_TICK_GAP_MS = 250;

export type CutReason =
  | "boundary"
  | "pause"
  | "max-length"
  | "idle";

export function createSegmenter(
  initialConfig: Partial<SegmenterConfig>,
  now: number,
) {
  const config: SegmenterConfig = {
    ...DEFAULT_SEGMENTER_CONFIG,
    ...initialConfig,
  };
  let segmentStart = now;
  let lastTick = now;
  let voicedMs = 0;
  let silentSince: number | null = null;
  let boundaryAt: number | null = null;

  return {
    /** Begin a new segment (call right after every cut). */
    startSegment(at: number) {
      segmentStart = at;
      lastTick = at;
      voicedMs = 0;
      silentSince = null;
      boundaryAt = null;
    },

    /** An external phrase boundary (e.g. the recognizer finalized a phrase). */
    requestBoundary(at: number) {
      if (boundaryAt === null) boundaryAt = at;
    },

    /** Switch phrase segmentation on/off mid-session (recognizer failed). */
    setPauseMs(pauseMs: number | null) {
      config.pauseMs = pauseMs;
    },

    /**
     * Advance the clock. `voiced` is the voice-activity reading for this
     * tick, or `null` when no level data is available. Returns the reason to
     * cut the current segment now, or null to keep recording.
     */
    tick(at: number, voiced: boolean | null): CutReason | null {
      const dt = Math.min(MAX_TICK_GAP_MS, Math.max(0, at - lastTick));
      lastTick = at;
      if (voiced === true) {
        voicedMs += dt;
        silentSince = null;
      } else if (voiced === false) {
        silentSince ??= at - dt;
      } else {
        silentSince = null;
      }

      const age = at - segmentStart;
      const silentFor = silentSince === null ? 0 : at - silentSince;

      if (age >= config.hardMaxMs) return "max-length";

      if (boundaryAt !== null) {
        if (
          voiced === null ||
          silentFor >= config.boundarySilenceMs ||
          at - boundaryAt >= config.boundaryMaxWaitMs
        ) {
          return "boundary";
        }
      }

      if (
        config.pauseMs !== null &&
        voicedMs >= config.minPhraseMs &&
        silentFor >= config.pauseMs
      ) {
        return "pause";
      }

      if (
        age >= config.softMaxMs &&
        (voiced === null || silentFor >= config.softMaxSilenceMs)
      ) {
        return "max-length";
      }

      if (
        voiced !== null &&
        voicedMs === 0 &&
        age >= config.idleRecycleMs &&
        silentFor >= config.idleRecycleMs / 2
      ) {
        return "idle";
      }

      return null;
    },

    /** Milliseconds of detected speech in the current segment. */
    get voicedMs() {
      return voicedMs;
    },
  };
}

export type Segmenter = ReturnType<typeof createSegmenter>;
