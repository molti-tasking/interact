"use client";

import type { TranscribeAudioResponse } from "@/lib/voice/transcription";
import { useCaptureSession, type CaptureErrorInfo } from "./useCaptureSession";

export interface UseVoiceCaptureResult {
  isRecording: boolean;
  /** Waiting for microphone permission. */
  isStarting: boolean;
  isTranscribing: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
}

/**
 * Click-to-record dictation: record → stop → one transcript via
 * `onTranscript`. Long recordings are uploaded in ~30 s chunks while you
 * speak (cut in pauses) and joined on stop, so there's no upload size limit
 * and little wait at the end. Audio goes only to the self-hosted Whisper.
 * The microphone is released when recording stops or the component unmounts.
 */
export function useVoiceCapture(
  onTranscript: (text: string, meta: TranscribeAudioResponse) => void,
  options: {
    onError?: (message: string, info: CaptureErrorInfo) => void;
  } = {},
): UseVoiceCaptureResult {
  const { isRecording, isStarting, isTranscribing, error, start, stop, toggle } =
    useCaptureSession({
      segmentation: "single",
      onSegment: onTranscript,
      onError: options.onError,
    });
  return { isRecording, isStarting, isTranscribing, error, start, stop, toggle };
}
