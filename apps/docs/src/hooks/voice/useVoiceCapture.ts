"use client";

import {
  transcribeAudioAction,
  type TranscribeAudioResponse,
} from "@/app/actions/transcribe-actions";
import { useCallback, useRef, useState } from "react";

export interface UseVoiceCaptureResult {
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * MediaRecorder lifecycle hook: getUserMedia → record → stop → Blob, then posts
 * the clip to {@link transcribeAudioAction} and hands the transcript back via
 * `onTranscript`. The microphone is released as soon as recording stops.
 */
export function useVoiceCapture(
  onTranscript: (text: string, meta: TranscribeAudioResponse) => void,
): UseVoiceCaptureResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Release the mic immediately so the OS indicator clears.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (blob.size === 0) return;

        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");
          const res = await transcribeAudioAction(formData);
          if (res.success && res.text?.trim()) {
            onTranscript(res.text.trim(), res);
          } else if (!res.success) {
            setError(res.error ?? "Transcription failed");
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setIsRecording(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
      setIsRecording(false);
    }
  }, [onTranscript]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    recorderRef.current = null;
    setIsRecording(false);
  }, []);

  return { isRecording, isTranscribing, error, start, stop };
}
