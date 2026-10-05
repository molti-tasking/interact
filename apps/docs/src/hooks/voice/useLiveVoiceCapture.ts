"use client";

import type { TranscribeAudioResponse } from "@/lib/voice/transcription";
import type { CaptureMode } from "@/lib/voice-modes";
import {
  useCaptureSession,
  useSpeechRecognitionSupported,
  type CaptureErrorInfo,
} from "./useCaptureSession";

export interface UseLiveVoiceCaptureOptions {
  /** Authoritative, Whisper-transcribed text for one spoken segment (in order). */
  onSegment: (text: string, meta: TranscribeAudioResponse) => void;
  /** Live, unfinalized text from the browser recognizer (visual only). */
  onInterim?: (text: string) => void;
  /** Every error / notice as it happens (e.g. to log each one). */
  onError?: (message: string, info: CaptureErrorInfo) => void;
  /** BCP-47 language tag for the live recognizer. */
  lang?: string;
  /**
   * "live": the browser's speech recognizer provides captions and phrase
   * boundaries — Chrome/Edge stream the audio to Google, Safari to Apple.
   * "private": phrases are detected locally from pauses and audio only goes
   * to the deployment's own Whisper. Read when a recording starts.
   */
  mode?: CaptureMode;
}

export interface UseLiveVoiceCaptureResult {
  isRecording: boolean;
  /** Waiting for microphone permission. */
  isStarting: boolean;
  /** True while at least one segment is being transcribed by Whisper. */
  isTranscribing: boolean;
  /** Whether this browser has a speech recognizer for live captions. */
  liveSupported: boolean;
  /** The recognizer is running for the current recording. */
  liveActive: boolean;
  /** Latest hard error; cleared by the next transcript or recording. */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
}

/**
 * Real-time voice capture for record mode: speech is cut into phrases while
 * recording continues, each phrase is transcribed by the self-hosted Whisper
 * (authoritative), and transcripts are handed to `onSegment` in the order
 * they were spoken — even though uploads run in parallel.
 *
 * In "live" mode the browser recognizer (Chrome/Edge, Safari) also shows
 * interim captions; where it's unavailable (Firefox) or fails, phrases are
 * detected from pauses instead ("private" behaviour).
 */
export function useLiveVoiceCapture(
  options: UseLiveVoiceCaptureOptions,
): UseLiveVoiceCaptureResult {
  const { onSegment, onInterim, onError, lang = "en-US", mode = "live" } =
    options;
  const liveSupported = useSpeechRecognitionSupported();

  const capture = useCaptureSession({
    segmentation: mode === "live" ? "recognizer" : "pauses",
    onSegment,
    onInterim,
    onError,
    lang,
  });

  return { ...capture, liveSupported };
}
