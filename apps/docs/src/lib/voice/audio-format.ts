/**
 * Audio container handling shared by the browser (choosing a MediaRecorder
 * format, naming the upload) and the server (telling Whisper what it gets).
 *
 * The AI SDK sniffs the media type from the first bytes only, and MP4 carries
 * its `ftyp` box at offset 4 — so Safari's `audio/mp4` recordings would be
 * labelled `audio/wav`. We therefore pass the real type end to end.
 */

/** Formats Whisper accepts, in order of preference for recording. */
const RECORDER_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
];

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "video/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
};

/** Media types accepted for transcription (container, without codecs). */
export const SUPPORTED_AUDIO_TYPES = new Set(Object.keys(EXTENSIONS));

/** "audio/webm;codecs=opus" → "audio/webm" */
export function baseMimeType(mimeType: string | null | undefined): string {
  return (mimeType ?? "").split(";")[0].trim().toLowerCase();
}

/** File extension matching a media type ("webm", "ogg", "mp4", …). */
export function audioFileExtension(mimeType: string | null | undefined): string {
  return EXTENSIONS[baseMimeType(mimeType)] ?? "webm";
}

/**
 * The best recording format this browser's MediaRecorder supports, or
 * undefined to let the browser choose.
 */
export function pickRecorderMimeType(): string | undefined {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return undefined;
  }
  return RECORDER_CANDIDATES.find((t) => {
    try {
      return MediaRecorder.isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

function startsWith(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/** Detect the container from magic bytes (MP4 `ftyp` at offset 4 included). */
export function sniffAudioMediaType(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return "audio/webm";
  }
  if (startsWith(bytes, 0, "OggS")) return "audio/ogg";
  if (startsWith(bytes, 4, "ftyp")) return "audio/mp4";
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WAVE")) {
    return "audio/wav";
  }
  if (startsWith(bytes, 0, "fLaC")) return "audio/flac";
  if (startsWith(bytes, 0, "ID3")) return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  return undefined;
}

/**
 * The media type to declare to Whisper: what the bytes say, else what the
 * client declared (if it's a supported audio type), else WebM (the format
 * every Chromium/Firefox MediaRecorder produces).
 */
export function resolveAudioMediaType(
  bytes: Uint8Array,
  declared: string | null | undefined,
): string {
  const sniffed = sniffAudioMediaType(bytes);
  if (sniffed) return sniffed;
  const base = baseMimeType(declared);
  if (SUPPORTED_AUDIO_TYPES.has(base)) {
    return base === "video/webm" ? "audio/webm" : base === "video/mp4" ? "audio/mp4" : base;
  }
  return "audio/webm";
}
