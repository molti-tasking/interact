import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscribeAudioResponse } from "@/lib/voice/transcription";

// --- Controllable transcription ---------------------------------------------
const pending: {
  resolve: (r: TranscribeAudioResponse) => void;
  durationMs?: number;
}[] = [];
vi.mock("@/lib/voice/transcription", () => ({
  transcribeClip: vi.fn(
    (_blob: Blob, opts: { durationMs?: number }) =>
      new Promise<TranscribeAudioResponse>((resolve) =>
        pending.push({ resolve, durationMs: opts.durationMs }),
      ),
  ),
}));

const { startCaptureSession } = await import("@/lib/voice/capture-session");
const { createOrderedDelivery } = await import("@/lib/voice/ordered-delivery");

// --- Browser fakes ------------------------------------------------------------
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public stream: unknown) {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
    setTimeout(() => this.onstart?.(), 0);
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["audio-bytes"]) });
      this.onstop?.();
    }, 0);
  }
}

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
  finalize(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: text }], { isFinal: true })],
    });
  }
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function harness(segmentation: "recognizer" | "pauses" | "single") {
  const out: string[] = [];
  const errors: string[] = [];
  const delivery = createOrderedDelivery<string>((text) => out.push(text));
  const { stream, track } = fakeStream();
  const onLiveUnavailable = vi.fn();
  const session = startCaptureSession({
    stream,
    segmentation,
    reserve: delivery.reserve,
    resolve: (seq, text) => delivery.resolve(seq, text),
    skip: delivery.skip,
    onError: (message) => errors.push(message),
    onInFlightChange: () => {},
    onLiveUnavailable,
  });
  return { session, out, errors, track, onLiveUnavailable };
}

const ok = (text: string): TranscribeAudioResponse => ({ success: true, text });

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
    ],
  });
  pending.length = 0;
  FakeMediaRecorder.instances = [];
  FakeRecognition.instances = [];
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("capture session", () => {
  it("delivers phrases in spoken order although transcripts return out of order", async () => {
    const { session, out } = harness("recognizer");
    const rec = FakeRecognition.instances[0];

    await vi.advanceTimersByTimeAsync(600);
    rec.finalize("first");
    await vi.advanceTimersByTimeAsync(600);
    rec.finalize("second");
    await vi.advanceTimersByTimeAsync(600);
    expect(pending).toHaveLength(2);

    pending[1].resolve(ok("second"));
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toEqual([]);
    pending[0].resolve(ok("first"));
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toEqual(["first", "second"]);
    session.abort();
  });

  it("starts the next recorder before stopping the previous one", async () => {
    const { session } = harness("recognizer");
    await vi.advanceTimersByTimeAsync(600);
    FakeRecognition.instances[0].finalize("phrase");
    await vi.advanceTimersByTimeAsync(50);
    const [first, second] = FakeMediaRecorder.instances;
    expect(second?.state).toBe("recording");
    expect(first.state).toBe("recording"); // still overlapping
    await vi.advanceTimersByTimeAsync(400);
    expect(first.state).toBe("inactive");
    session.abort();
  });

  it("a stopped session never starts recorders for itself again (stop → quick restart)", async () => {
    const a = harness("recognizer");
    await vi.advanceTimersByTimeAsync(600);
    a.session.stop();
    const b = harness("recognizer"); // restarted before A's recorder reported stop
    const countAfterRestart = FakeMediaRecorder.instances.length;

    await vi.advanceTimersByTimeAsync(100); // A's onstop fires now
    expect(FakeMediaRecorder.instances).toHaveLength(countAfterRestart);
    expect(a.track.stop).toHaveBeenCalled();
    expect(b.track.stop).not.toHaveBeenCalled();
    expect(pending).toHaveLength(1); // only A's final clip, once

    pending[0].resolve(ok("last words"));
    await vi.advanceTimersByTimeAsync(0);
    expect(a.out).toEqual(["last words"]);
    b.session.abort();
  });

  it("abort releases the microphone and drops transcripts still in flight", async () => {
    const { session, out, track } = harness("recognizer");
    await vi.advanceTimersByTimeAsync(600);
    FakeRecognition.instances[0].finalize("phrase");
    await vi.advanceTimersByTimeAsync(600);
    expect(pending).toHaveLength(1);

    session.abort();
    expect(track.stop).toHaveBeenCalled();
    pending[0].resolve(ok("too late"));
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toEqual([]);
  });

  it("gives up live recognition on a fatal error instead of restarting forever", async () => {
    const { session, errors, onLiveUnavailable } = harness("recognizer");
    const rec = FakeRecognition.instances[0];
    rec.onerror?.({ error: "not-allowed" });
    expect(onLiveUnavailable).toHaveBeenCalledTimes(1);
    expect(errors[0]).toMatch(/Live captions stopped/);
    expect(rec.abort).toHaveBeenCalled();
    expect(rec.onend).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(rec.start).toHaveBeenCalledTimes(1);
    session.abort();
  });

  it("backs off on repeated transient errors and stops after a few", async () => {
    const { session, onLiveUnavailable } = harness("recognizer");
    const rec = FakeRecognition.instances[0];
    for (let i = 0; i < 4; i++) {
      rec.onerror?.({ error: "network" });
      rec.onend?.();
      await vi.advanceTimersByTimeAsync(100);
    }
    // Backing off: not restarted within 100 ms after repeated failures.
    expect(rec.start.mock.calls.length).toBeLessThan(5);
    rec.onerror?.({ error: "network" });
    expect(onLiveUnavailable).toHaveBeenCalledTimes(1);
    session.abort();
  });

  it("joins the chunks of a single recording into one transcript, in order", async () => {
    const { session, out } = harness("single");
    await vi.advanceTimersByTimeAsync(30_100); // past the ~30 s chunk limit
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2_000);
    session.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(pending).toHaveLength(2);

    pending[1].resolve(ok("and the rest."));
    pending[0].resolve(ok("The first part"));
    await vi.advanceTimersByTimeAsync(0);
    expect(out).toEqual(["The first part and the rest."]);
  });
});
