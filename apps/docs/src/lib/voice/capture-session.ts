/**
 * One recording session: microphone stream → segmented MediaRecorder clips →
 * parallel Whisper transcription → results handed on in recording order.
 *
 * Browser-only and framework-free; the React hooks in `src/hooks/voice` own
 * the session lifecycle. Every event handler closes over *this* session, so a
 * stopped session finishing in the background can never touch the recorder
 * of a newer one (stop → quick restart is safe).
 *
 * Segmentation strategies:
 * - "recognizer": the browser's SpeechRecognition finalizes phrases and
 *   provides live captions. NOTE: Chrome and Safari implement it as a cloud
 *   service — audio is streamed to Google / Apple.
 * - "pauses": phrases end at pauses detected locally (Web Audio level
 *   meter). Audio only goes to the deployment's own Whisper.
 * - "single": one transcript for the whole recording (dictation buttons).
 *
 * In every mode cuts land in silence where possible, the next recorder is
 * started before the previous one stops (no audio gap), long stretches are
 * cut at ~30 s so no upload grows large, and clips without speech are not
 * uploaded at all (Whisper hallucinates on silence).
 */

import { pickRecorderMimeType } from "./audio-format";
import { createLevelDetector, createSegmenter } from "./segmenter";
import { transcribeClip, type TranscribeAudioResponse } from "./transcription";

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings (not in the DOM lib). Only the surface we use.
// ---------------------------------------------------------------------------
interface SRAlternative {
  readonly transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  readonly [index: number]: SRResult;
}
interface SREvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
}

/**
 * The browser's speech recognizer, if any (Chrome/Edge: `SpeechRecognition`
 * or `webkitSpeechRecognition`; Safari: `webkitSpeechRecognition`; Firefox:
 * none).
 */
export function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Recognizer errors that won't go away by restarting. */
const FATAL_RECOGNIZER_ERRORS: Record<string, string> = {
  "not-allowed": "speech recognition was not permitted",
  "service-not-allowed": "the browser's speech service isn't available",
  "audio-capture": "the speech service can't access the microphone",
  "language-not-supported": "the language isn't supported",
  "bad-grammar": "the speech service rejected its configuration",
};
/** Consecutive transient errors before live recognition is given up. */
const MAX_TRANSIENT_ERRORS = 5;

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const TICK_MS = 50;
/** Silence that ends a phrase in "pauses" mode. */
const PAUSE_MS = 900;
/** Stop the previous recorder this long after the next one started at the latest. */
const HANDOVER_FALLBACK_MS = 300;
/** A clip with less detected speech than this… */
const MIN_VOICED_MS = 120;
/** …and no level reading above this is silence and is not uploaded. */
const QUIET_PEAK_RMS = 0.02;
/** Clips shorter than this can't contain a word. */
const MIN_CLIP_MS = 250;
/** Release the microphone even if a recorder never reports `stop`. */
const RELEASE_FALLBACK_MS = 3000;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export type Segmentation = "recognizer" | "pauses" | "single";

export interface CaptureSessionOptions {
  stream: MediaStream;
  segmentation: Segmentation;
  /** BCP-47 language tag for the live recognizer. */
  lang?: string;
  /** Reserve the next output position (see `createOrderedDelivery`). */
  reserve: () => number;
  /** A transcript for a reserved position. */
  resolve: (seq: number, text: string, meta: TranscribeAudioResponse) => void;
  /** A reserved position produced nothing. */
  skip: (seq: number) => void;
  /** Live, unfinalized recognizer text (recognizer mode only). */
  onInterim?: (text: string) => void;
  /**
   * Every problem, as it happens. `soft` marks notices that don't need
   * attention (a clip discarded as non-speech, live captions falling back).
   */
  onError: (message: string, info: { soft: boolean }) => void;
  /** Number of uploads in flight changed by `delta`. */
  onInFlightChange: (delta: number) => void;
  /** Live recognition stopped for good; segmentation fell back to pauses. */
  onLiveUnavailable?: (reason: string) => void;
  /** All recorders stopped and the microphone is released. */
  onReleased?: () => void;
  /** Everything recorded has been delivered or skipped. */
  onFinished?: () => void;
}

export interface CaptureSession {
  /** Stop recording; what was recorded is still transcribed and delivered. */
  stop(): void;
  /** Stop immediately and drop everything not yet delivered. */
  abort(): void;
}

interface Segment {
  index: number;
  /** Output position, or -1 for chunks of a "single" recording. */
  seq: number;
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  stoppedAt: number | null;
  voicedMs: number;
  peak: number;
  stopRequested: boolean;
}

type ChunkResult = { text: string; meta: TranscribeAudioResponse } | null;

/**
 * Start recording on an already-open microphone stream. The session owns the
 * stream from here on and stops its tracks when done. Throws if recording
 * can't start at all (the caller should then release the stream).
 */
export function startCaptureSession(opts: CaptureSessionOptions): CaptureSession {
  const { stream, segmentation } = opts;
  let state: "recording" | "stopping" | "aborted" = "recording";
  const uploads = new AbortController();
  const mimeType = pickRecorderMimeType();
  const now = () => performance.now();
  const sessionStart = now();

  const pendingSeqs = new Set<number>();
  const active = new Set<Segment>();
  let current: Segment | null = null;
  let segmentIndex = 0;
  let inFlight = 0;
  let released = false;
  let finished = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  // "single": one output position, filled from the ordered chunk results.
  const singleSeq = segmentation === "single" ? opts.reserve() : null;
  const chunkResults: Promise<ChunkResult>[] = [];
  /** Chunk failures already reported to the user ("single" mode). */
  let singleReportedErrors = 0;
  let singleDone = singleSeq === null;

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  // --- Voice activity (Web Audio level meter) -------------------------------
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let levelBuf: Float32Array<ArrayBuffer> | null = null;
  const level = createLevelDetector();
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      const source = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      levelBuf = new Float32Array(analyser.fftSize);
      void audioCtx.resume().catch(() => {});
    }
  } catch {
    audioCtx = null;
    analyser = null;
  }
  const hasLevelMeter = analyser !== null;

  /** Level data is flowing (some browsers hand the analyser pure zeros). */
  const vadHealthy = () => hasLevelMeter && level.peak > 1e-4;

  /** Voice activity for this tick, or null when unknown. */
  function readVoiced(): boolean | null {
    if (!analyser || !levelBuf || audioCtx?.state !== "running") return null;
    analyser.getFloatTimeDomainData(levelBuf);
    let sum = 0;
    for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
    const rms = Math.sqrt(sum / levelBuf.length);
    const voiced = level.update(now(), rms);
    if (current) current.peak = Math.max(current.peak, rms);
    if (now() - sessionStart > 2000 && level.peak <= 1e-4) return null;
    return voiced;
  }

  const segmenter = createSegmenter(
    { pauseMs: segmentation === "pauses" ? PAUSE_MS : null },
    now(),
  );

  // --- Recorders ------------------------------------------------------------

  function createRecorder(): MediaRecorder {
    if (mimeType) {
      try {
        return new MediaRecorder(stream, { mimeType });
      } catch {
        /* advertised but refused — let the browser pick */
      }
    }
    return new MediaRecorder(stream);
  }

  function beginSegment(): Segment {
    const recorder = createRecorder();
    const seg: Segment = {
      index: segmentIndex++,
      seq: segmentation === "single" ? -1 : opts.reserve(),
      recorder,
      chunks: [],
      startedAt: now(),
      stoppedAt: null,
      voicedMs: 0,
      peak: 0,
      stopRequested: false,
    };
    if (seg.seq >= 0) pendingSeqs.add(seg.seq);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) seg.chunks.push(e.data);
    };
    recorder.onstop = () => {
      active.delete(seg);
      finalizeSegment(seg);
      maybeRelease();
    };
    recorder.onerror = () => {
      if (state === "aborted") return;
      opts.onError("The recorder stopped unexpectedly.", { soft: false });
      stopSegment(seg);
    };

    try {
      recorder.start();
    } catch (err) {
      if (seg.seq >= 0) {
        pendingSeqs.delete(seg.seq);
        opts.skip(seg.seq);
      }
      throw err;
    }
    active.add(seg);
    segmenter.startSegment(seg.startedAt);
    return seg;
  }

  function stopSegment(seg: Segment) {
    if (seg.stopRequested) return;
    seg.stopRequested = true;
    seg.stoppedAt = now();
    try {
      if (seg.recorder.state !== "inactive") seg.recorder.stop();
      else {
        active.delete(seg);
        finalizeSegment(seg);
      }
    } catch {
      active.delete(seg);
      finalizeSegment(seg);
    }
  }

  /** Cut: start the next recorder first, then stop the old one once it runs. */
  function cut() {
    const old = current;
    if (!old) return;
    old.voicedMs = segmenter.voicedMs;
    let next: Segment;
    try {
      next = beginSegment();
    } catch {
      // Can't rotate — keep the current recorder going rather than lose audio.
      return;
    }
    current = next;
    let handedOver = false;
    const handOver = () => {
      if (handedOver) return;
      handedOver = true;
      stopSegment(old);
    };
    next.recorder.onstart = () => later(handOver, 30);
    later(handOver, HANDOVER_FALLBACK_MS);
  }

  function finalizeSegment(seg: Segment) {
    if (seg.recorder.ondataavailable === null) return; // already finalized
    seg.recorder.ondataavailable = null;
    seg.recorder.onstop = null;

    const settle = (result: Promise<ChunkResult>) => {
      if (segmentation === "single") {
        chunkResults[seg.index] = result;
        return;
      }
      void result.then((r) => {
        pendingSeqs.delete(seg.seq);
        if (state === "aborted") return;
        if (r) opts.resolve(seg.seq, r.text, r.meta);
        else opts.skip(seg.seq);
        maybeFinish();
      });
    };

    const blob = new Blob(seg.chunks, {
      type: seg.recorder.mimeType || mimeType || "audio/webm",
    });
    seg.chunks = [];
    const durationMs = (seg.stoppedAt ?? now()) - seg.startedAt;
    const silent =
      vadHealthy() && seg.voicedMs < MIN_VOICED_MS && seg.peak < QUIET_PEAK_RMS;

    if (state === "aborted" || blob.size === 0 || durationMs < MIN_CLIP_MS || silent) {
      settle(Promise.resolve(null));
      return;
    }
    settle(upload(blob, durationMs));
  }

  async function upload(blob: Blob, durationMs: number): Promise<ChunkResult> {
    inFlight += 1;
    opts.onInFlightChange(1);
    try {
      const res = await transcribeClip(blob, {
        durationMs,
        signal: uploads.signal,
      });
      if (state === "aborted") return null;
      const text = res.text?.trim();
      if (res.success && text) return { text, meta: { ...res, text } };
      if (res.rejected) {
        if (segmentation !== "single") {
          opts.onError("Ignored a clip without clear speech.", { soft: true });
        }
      } else if (!res.success) {
        singleReportedErrors += 1;
        opts.onError(res.error ?? "Transcription failed", { soft: false });
      }
      return null;
    } catch (err) {
      if (state !== "aborted") {
        singleReportedErrors += 1;
        opts.onError(
          err instanceof Error ? err.message : "Transcription failed",
          { soft: false },
        );
      }
      return null;
    } finally {
      inFlight -= 1;
      opts.onInFlightChange(-1);
      maybeFinish();
    }
  }

  function maybeRelease() {
    if (released || state === "recording" || active.size > 0) return;
    release();
    if (singleSeq !== null && state !== "aborted") {
      void Promise.all(chunkResults).then((results) => {
        if (state === "aborted") return;
        const parts = results.filter((r): r is NonNullable<ChunkResult> => !!r);
        if (parts.length === 0) {
          opts.skip(singleSeq);
          if (singleReportedErrors === 0) {
            opts.onError(
              "No clear speech detected — try again a bit closer to the microphone.",
              { soft: false },
            );
          }
        } else {
          const text = parts.map((p) => p.text).join(" ");
          const seconds = parts.reduce(
            (sum, p) => sum + (p.meta.durationInSeconds ?? 0),
            0,
          );
          opts.resolve(singleSeq, text, {
            success: true,
            text,
            language: parts[0].meta.language,
            durationInSeconds: seconds || undefined,
          });
        }
        singleDone = true;
        maybeFinish();
      });
    }
  }

  function maybeFinish() {
    if (finished || !released || inFlight > 0) return;
    if (segmentation !== "single" && pendingSeqs.size > 0) return;
    if (!singleDone && state !== "aborted") return;
    finished = true;
    opts.onFinished?.();
  }

  function release() {
    if (released) return;
    released = true;
    stream.getTracks().forEach((t) => t.stop());
    void audioCtx?.close().catch(() => {});
    audioCtx = null;
    analyser = null;
    opts.onReleased?.();
    maybeFinish();
  }

  // --- Live recognizer ------------------------------------------------------
  let recognition: SpeechRecognitionLike | null = null;
  let liveDisabled = segmentation !== "recognizer";
  let transientErrors = 0;
  let restartsWithoutResult = 0;

  function stopRecognition() {
    const r = recognition;
    recognition = null;
    if (!r) return;
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    try {
      r.abort();
    } catch {
      /* ignore */
    }
  }

  function disableLive(reason: string) {
    if (liveDisabled) return;
    liveDisabled = true;
    stopRecognition();
    opts.onInterim?.("");
    // Keep phrase-by-phrase processing going without the recognizer.
    segmenter.setPauseMs(PAUSE_MS);
    opts.onLiveUnavailable?.(reason);
    opts.onError(
      `Live captions stopped: ${reason}. Still recording — phrases are now detected locally and transcribed by Whisper only.`,
      { soft: false },
    );
  }

  function startRecognition() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      disableLive("this browser has no speech recognition");
      return;
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = opts.lang ?? "en-US";

    r.onresult = (e) => {
      if (recognition !== r || state !== "recording") return;
      transientErrors = 0;
      restartsWithoutResult = 0;
      let interim = "";
      let boundary = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) boundary = true;
        else interim += result[0].transcript;
      }
      opts.onInterim?.(interim);
      // A finalized phrase is a segment boundary; the segmenter places the
      // actual cut in the next bit of silence.
      if (boundary) segmenter.requestBoundary(now());
    };
    r.onerror = (e) => {
      if (recognition !== r) return;
      // Routine: silence timeouts and our own aborts.
      if (e.error === "no-speech" || e.error === "aborted") return;
      const fatal = FATAL_RECOGNIZER_ERRORS[e.error];
      if (fatal) {
        disableLive(fatal);
        return;
      }
      transientErrors += 1;
      if (transientErrors >= MAX_TRANSIENT_ERRORS) {
        disableLive(
          e.error === "network"
            ? "the speech service can't be reached"
            : `the speech service keeps failing (${e.error})`,
        );
      }
    };
    r.onend = () => {
      // Recognition ends on long silence even when continuous; revive it,
      // backing off while it keeps failing.
      if (recognition !== r || state !== "recording" || liveDisabled) return;
      restartsWithoutResult += 1;
      const delay =
        transientErrors > 0
          ? Math.min(8000, 500 * 2 ** (transientErrors - 1))
          : restartsWithoutResult > 5
            ? 2000
            : 0;
      later(() => {
        if (recognition !== r || state !== "recording" || liveDisabled) return;
        try {
          r.start();
        } catch {
          /* already starting — ignore */
        }
      }, delay);
    };

    recognition = r;
    try {
      r.start();
    } catch {
      /* already started — ignore */
    }
  }

  // --- Start ----------------------------------------------------------------
  try {
    current = beginSegment();
  } catch (err) {
    // Recording isn't possible at all; the caller releases the stream.
    void audioCtx?.close().catch(() => {});
    throw err;
  }
  if (segmentation === "recognizer") startRecognition();

  const ticker = setInterval(() => {
    if (state !== "recording" || !current) return;
    if (segmenter.tick(now(), readVoiced())) cut();
  }, TICK_MS);

  function clearTimers() {
    clearInterval(ticker);
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
  }

  return {
    stop() {
      if (state !== "recording") return;
      state = "stopping";
      clearInterval(ticker);
      stopRecognition();
      opts.onInterim?.("");
      if (current) {
        current.voicedMs = segmenter.voicedMs;
        current = null;
      }
      for (const seg of [...active]) stopSegment(seg);
      maybeRelease();
      // Some browsers never fire `stop` if the device vanished.
      setTimeout(() => {
        if (released) return;
        for (const seg of [...active]) {
          active.delete(seg);
          finalizeSegment(seg);
        }
        maybeRelease();
      }, RELEASE_FALLBACK_MS);
    },

    abort() {
      if (state === "aborted") return;
      state = "aborted";
      clearTimers();
      uploads.abort();
      stopRecognition();
      current = null;
      for (const seg of [...active]) {
        seg.recorder.ondataavailable = null;
        seg.recorder.onstop = null;
        try {
          if (seg.recorder.state !== "inactive") seg.recorder.stop();
        } catch {
          /* ignore */
        }
      }
      active.clear();
      release();
      for (const seq of pendingSeqs) opts.skip(seq);
      pendingSeqs.clear();
      if (singleSeq !== null) opts.skip(singleSeq);
      if (!finished) {
        finished = true;
        opts.onFinished?.();
      }
    },
  };
}
