import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_VOICE_MODE,
  loadVoiceMode,
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
