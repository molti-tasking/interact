"use server";

import { whisperModel } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
import { experimental_transcribe as transcribe } from "ai";

export interface TranscribeAudioResponse {
  success: boolean;
  text?: string;
  language?: string;
  durationInSeconds?: number;
  error?: string;
}

/**
 * Transcribe a recorded audio clip via the self-hosted Whisper route.
 *
 * Accepts a FormData with an `audio` Blob (MediaRecorder output, typically
 * `audio/webm;codecs=opus`). Fixture-guarded like the LLM actions so eval runs
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

  const bytes = new Uint8Array(await file.arrayBuffer());
  const descriptor = { byteLength: bytes.byteLength, mimeType: file.type };

  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "transcribeAudioAction",
      descriptor,
      () => transcribeReal(bytes),
      { prompt: `audio:${descriptor.mimeType}:${descriptor.byteLength}` },
    );
  }
  return transcribeReal(bytes);
}

async function transcribeReal(
  bytes: Uint8Array,
): Promise<TranscribeAudioResponse> {
  try {
    const result = await withTracing({ tags: ["voice", "transcribe"] }, () =>
      transcribe({ model: whisperModel, audio: bytes }),
    );
    return {
      success: true,
      text: result.text,
      language: result.language,
      durationInSeconds: result.durationInSeconds,
    };
  } catch (error) {
    console.error("Transcription error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
