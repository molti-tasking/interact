import {
  capJson,
  capText,
  checkRateLimit,
  LIMITS,
  LlmGuardError,
} from "@/lib/llm-guard";
import { transcribeAudioBytes } from "@/lib/voice/transcribe-server";
import {
  MAX_AUDIO_BYTES,
  type TranscribeAudioResponse,
} from "@/lib/voice/transcription";
import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/transcribe — multipart form with an `audio` file (MediaRecorder
 * output; its type and extension name the container) and an optional
 * `durationMs` (client-measured clip length).
 *
 * A Route Handler rather than a server action: actions are capped at 1 MB
 * request bodies (≈2.5 min of Opus) and Next runs them one at a time per
 * client, so segment transcription would wait behind LLM routing calls.
 * Requests here run in parallel; the client re-orders results by segment.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

/** Multipart overhead allowance on top of the audio itself. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

function json(body: TranscribeAudioResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const declaredLength = Number(req.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_AUDIO_BYTES + FORM_OVERHEAD_BYTES
    ) {
      return json({ success: false, error: "Recording too large to transcribe." }, 413);
    }

    await checkRateLimit("transcribe");

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return json({ success: false, error: "Expected multipart form data." }, 400);
    }

    const file = form.get("audio");
    if (!(file instanceof Blob) || file.size === 0) {
      return json({ success: false, error: "No audio provided" }, 400);
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return json({ success: false, error: "Recording too large to transcribe." }, 413);
    }

    const declaredType = capText(file.type, 200, "Audio type");
    const durationRaw = form.get("durationMs");
    const meta = {
      declaredType,
      durationMs: typeof durationRaw === "string" ? Number(durationRaw) : NaN,
    };
    capJson(meta, LIMITS.shortText, "Audio metadata");
    const clipSeconds =
      Number.isFinite(meta.durationMs) && meta.durationMs > 0
        ? meta.durationMs / 1000
        : undefined;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const run = () => transcribeAudioBytes(bytes, { declaredType, clipSeconds });

    if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
      // Same fixture key as the server action, so recorded scenarios replay
      // regardless of which entry point the client used.
      const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
      const descriptor = { byteLength: bytes.byteLength, mimeType: file.type };
      return json(
        await fixtureGuard("transcribeAudioAction", descriptor, run, {
          prompt: `audio:${descriptor.mimeType}:${descriptor.byteLength}`,
        }),
      );
    }

    return json(await run());
  } catch (error) {
    if (error instanceof LlmGuardError) {
      const status = error.message.startsWith("Too many") ? 429 : 400;
      return json({ success: false, error: error.message }, status);
    }
    console.error("Transcription route error:", error);
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}
