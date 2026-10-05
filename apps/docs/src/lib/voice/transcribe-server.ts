// Server-only: uses the Whisper model credentials. Imported by the
// transcription route handler and server action, never by client code.
import { whisperModel } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
import { APICallError } from "ai";
import { resolveAudioMediaType } from "./audio-format";
import { assessTranscript } from "./transcript-guard";
import type { TranscribeAudioResponse } from "./transcription";

const MAX_ATTEMPTS = 3;

/**
 * Call Whisper with an explicit media type. (`transcribe()` from the AI SDK
 * only sniffs byte 0 and labels MP4 — whose `ftyp` box is at offset 4 — as
 * WAV, so Safari recordings would be uploaded as `audio.wav`.)
 */
async function callWhisper(bytes: Uint8Array, mediaType: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await whisperModel.doGenerate({ audio: bytes, mediaType });
    } catch (error) {
      lastError = error;
      const retryable = APICallError.isInstance(error) && error.isRetryable;
      if (!retryable) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * Transcribe one clip via the self-hosted Whisper route and reject
 * hallucinations (looped boilerplate, stock phrases on silence) before they
 * reach the intent pipeline.
 *
 * @param declaredType the recorder's media type as sent by the client
 * @param clipSeconds  client-measured clip length — a fallback for the
 *                     length-plausibility check when Whisper doesn't report one
 */
export async function transcribeAudioBytes(
  bytes: Uint8Array,
  options: { declaredType?: string | null; clipSeconds?: number } = {},
): Promise<TranscribeAudioResponse> {
  try {
    const mediaType = resolveAudioMediaType(bytes, options.declaredType);
    const result = await withTracing({ tags: ["voice", "transcribe"] }, () =>
      callWhisper(bytes, mediaType),
    );

    const durationInSeconds =
      result.durationInSeconds ?? options.clipSeconds ?? undefined;
    const assessment = assessTranscript(result.text ?? "", durationInSeconds);
    if (!assessment.ok) {
      console.warn("Transcript rejected:", assessment.reason);
      return {
        success: false,
        rejected: assessment.reason,
        error:
          "No clear speech detected — try again a bit closer to the microphone.",
      };
    }

    return {
      success: true,
      text: assessment.text,
      language: result.language,
      durationInSeconds,
    };
  } catch (error) {
    console.error("Transcription error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
