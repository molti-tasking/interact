"use server";

import { checkRateLimit, LlmGuardError } from "@/lib/llm-guard";
import { transcribeAudioBytes } from "@/lib/voice/transcribe-server";
import {
  MAX_AUDIO_BYTES,
  type TranscribeAudioResponse,
} from "@/lib/voice/transcription";

export type { TranscribeAudioResponse } from "@/lib/voice/transcription";

/**
 * Transcribe a recorded audio clip via the self-hosted Whisper route.
 *
 * Kept for fixtures/tests and small clips. The capture hooks upload to the
 * `/api/transcribe` Route Handler instead: server actions are limited to 1 MB
 * request bodies and run serially per client (transcription would queue
 * behind LLM routing calls).
 *
 * Accepts a FormData with an `audio` Blob (MediaRecorder output) and an
 * optional `durationMs`. Fixture-guarded like the LLM actions so eval runs
 * stay deterministic — keyed on a lightweight descriptor since the raw bytes
 * are not a stable fixture key.
 */
export async function transcribeAudioAction(
  formData: FormData,
): Promise<TranscribeAudioResponse> {
  const file = formData.get("audio");
  if (!(file instanceof Blob)) {
    return { success: false, error: "No audio provided" };
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return { success: false, error: "Recording too large to transcribe." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const descriptor = { byteLength: bytes.byteLength, mimeType: file.type };
  const durationMs = Number(formData.get("durationMs"));
  const clipSeconds =
    Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : undefined;

  const run = async (): Promise<TranscribeAudioResponse> => {
    try {
      await checkRateLimit("transcribe");
    } catch (error) {
      if (error instanceof LlmGuardError) {
        return { success: false, error: error.message };
      }
      throw error;
    }
    return transcribeAudioBytes(bytes, {
      declaredType: file.type,
      clipSeconds,
    });
  };

  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard("transcribeAudioAction", descriptor, run, {
      prompt: `audio:${descriptor.mimeType}:${descriptor.byteLength}`,
    });
  }
  return run();
}
