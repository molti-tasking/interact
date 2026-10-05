import { describe, expect, it } from "vitest";
import {
  audioFileExtension,
  baseMimeType,
  resolveAudioMediaType,
  sniffAudioMediaType,
} from "@/lib/voice/audio-format";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p,
    ),
  );

describe("audio format", () => {
  it("detects MP4 by its ftyp box at offset 4 (Safari recordings)", () => {
    const mp4 = bytes([0, 0, 0, 0x20], "ftypM4A ");
    expect(sniffAudioMediaType(mp4)).toBe("audio/mp4");
    expect(resolveAudioMediaType(mp4, "audio/wav")).toBe("audio/mp4");
  });

  it("detects WebM and Ogg", () => {
    expect(sniffAudioMediaType(bytes([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe(
      "audio/webm",
    );
    expect(sniffAudioMediaType(bytes("OggS", [0, 2]))).toBe("audio/ogg");
  });

  it("falls back to the declared type, then WebM", () => {
    const unknown = bytes([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(resolveAudioMediaType(unknown, "audio/ogg;codecs=opus")).toBe(
      "audio/ogg",
    );
    expect(resolveAudioMediaType(unknown, "application/octet-stream")).toBe(
      "audio/webm",
    );
  });

  it("names uploads with an extension matching the recorder's type", () => {
    expect(baseMimeType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(audioFileExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(audioFileExtension("audio/mp4")).toBe("mp4");
    expect(audioFileExtension("audio/x-m4a")).toBe("m4a");
    expect(audioFileExtension("audio/ogg")).toBe("ogg");
    expect(audioFileExtension("")).toBe("webm");
  });
});
