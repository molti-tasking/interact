import { audioFileExtension, baseMimeType } from "./audio-format";
import type { TranscriptRejection } from "./transcript-guard";

/** Result of transcribing one audio clip (route handler and server action). */
export interface TranscribeAudioResponse {
  success: boolean;
  text?: string;
  language?: string;
  durationInSeconds?: number;
  error?: string;
  /**
   * Set when Whisper returned something but the hallucination guard threw it
   * away (silence, stock phrases, loops) — callers in continuous capture can
   * treat this as "nothing was said" rather than as a failure.
   */
  rejected?: TranscriptRejection;
}

/** Upload limit for one clip (the capture hooks cut segments well below it). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/**
 * Endpoint of the transcription Route Handler. A route rather than a server
 * action: server actions are capped at 1 MB bodies and run one at a time per
 * client, which would queue transcription behind LLM routing calls.
 */
export const TRANSCRIBE_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/transcribe`;

/**
 * Upload one recorded clip for transcription. Declares the recorder's real
 * media type with a matching file extension so Whisper decodes it as what it
 * is (MP4 from Safari, WebM/Ogg elsewhere).
 */
export async function transcribeClip(
  blob: Blob,
  options: { durationMs?: number; signal?: AbortSignal } = {},
): Promise<TranscribeAudioResponse> {
  const mimeType = baseMimeType(blob.type) || "audio/webm";
  const typed =
    blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });

  const formData = new FormData();
  formData.append("audio", typed, `clip.${audioFileExtension(mimeType)}`);
  if (options.durationMs && options.durationMs > 0) {
    formData.append("durationMs", String(Math.round(options.durationMs)));
  }

  const res = await fetch(TRANSCRIBE_URL, {
    method: "POST",
    body: formData,
    signal: options.signal,
  });

  let body: TranscribeAudioResponse | null = null;
  try {
    body = (await res.json()) as TranscribeAudioResponse;
  } catch {
    /* non-JSON error page */
  }
  if (body && typeof body.success === "boolean") return body;
  return {
    success: false,
    error:
      res.status === 413
        ? "Recording too large to transcribe."
        : `Transcription failed (HTTP ${res.status}).`,
  };
}
