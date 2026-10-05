import { describe, expect, it, beforeEach } from "vitest";
import {
  CAPTURE_MODES,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_VOICE_MODE,
  loadCaptureMode,
  loadVoiceMode,
  saveCaptureMode,
  saveVoiceMode,
  VOICE_MODES,
} from "@/lib/voice-modes";

describe("voice-modes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("falls back to the default when nothing is stored", () => {
    expect(loadVoiceMode()).toBe(DEFAULT_VOICE_MODE);
  });

  it("round-trips a saved mode", () => {
    saveVoiceMode("review");
    expect(loadVoiceMode()).toBe("review");
  });

  it("ignores invalid stored values", () => {
    window.localStorage.setItem("interact.voiceMode", "bogus");
    expect(loadVoiceMode()).toBe(DEFAULT_VOICE_MODE);
  });

  it("declares every mode exactly once", () => {
    const ids = VOICE_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_VOICE_MODE);
  });
});

describe("capture modes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to the private, Whisper-only mode", () => {
    expect(DEFAULT_CAPTURE_MODE).toBe("private");
    expect(loadCaptureMode()).toBe("private");
  });

  it("round-trips a saved capture mode and ignores invalid values", () => {
    saveCaptureMode("live");
    expect(loadCaptureMode()).toBe("live");
    window.localStorage.setItem("interact.captureMode", "cloud");
    expect(loadCaptureMode()).toBe(DEFAULT_CAPTURE_MODE);
  });

  it("discloses that live captions send audio to the browser vendor", () => {
    const live = CAPTURE_MODES.find((m) => m.id === "live");
    expect(live?.privacyNotice).toMatch(/Google/);
    expect(live?.privacyNotice).toMatch(/Apple/);
    const priv = CAPTURE_MODES.find((m) => m.id === "private");
    expect(priv?.privacyNotice).toBeNull();
  });
});
