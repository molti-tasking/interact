"use client";

import {
  transcribeAudioAction,
  type TranscribeAudioResponse,
} from "@/app/actions/transcribe-actions";
import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Minimal Web Speech API typings (not in the DOM lib). Only the surface we use.
// ---------------------------------------------------------------------------
interface SRAlternative {
  readonly transcript: string;
}
interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SRAlternative;
}
interface SRResultList {
  readonly length: number;
  readonly [index: number]: SRResult;
}
interface SREvent {
  readonly resultIndex: number;
  readonly results: SRResultList;
}
interface SRErrorEvent {
  readonly error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseLiveVoiceCaptureOptions {
  /** Authoritative, Whisper-transcribed text for one spoken segment. */
  onSegment: (text: string, meta: TranscribeAudioResponse) => void;
  /** Live, unfinalized text from the browser recognizer (visual only). */
  onInterim?: (text: string) => void;
  /** BCP-47 language tag for the live recognizer. */
  lang?: string;
}

export interface UseLiveVoiceCaptureResult {
  isRecording: boolean;
  /** True while at least one segment is being transcribed by Whisper. */
  isTranscribing: boolean;
  /** Whether real-time segmentation + live interim text are available here. */
  liveSupported: boolean;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Live, real-time voice capture for record mode.
 *
 * The browser's SpeechRecognition provides two things: instant interim text for
 * on-screen feedback, and segment boundaries (a pause finalizes a phrase). At
 * each boundary the phrase's audio — captured by a per-segment MediaRecorder so
 * every blob is self-contained — is transcribed by the self-hosted Whisper
 * (authoritative) and handed back via `onSegment` *while recording continues*,
 * so the pipeline processes speech in real time rather than only on stop.
 *
 * Where SpeechRecognition is unavailable (Firefox/Safari) this degrades to a
 * single batch transcription on stop: no interim text, no mid-utterance
 * segmentation, but the same Whisper result flows through `onSegment`.
 */
export function useLiveVoiceCapture(
  options: UseLiveVoiceCaptureOptions,
): UseLiveVoiceCaptureResult {
  const { onSegment, onInterim, lang = "en-US" } = options;

  const liveSupported = useRef(getSpeechRecognition() !== null).current;

  const [isRecording, setIsRecording] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // True while the user intends to keep recording; drives segment restarts.
  const recordingRef = useRef(false);

  // Keep the latest callbacks without resubscribing recorder handlers.
  const onSegmentRef = useRef(onSegment);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onSegmentRef.current = onSegment;
    onInterimRef.current = onInterim;
  }, [onSegment, onInterim]);

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const transcribeSegment = useCallback(async (blob: Blob) => {
    setInFlight((n) => n + 1);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "segment.webm");
      const res = await transcribeAudioAction(formData);
      if (res.success && res.text?.trim()) {
        onSegmentRef.current(res.text.trim(), res);
      } else if (!res.success) {
        setError(res.error ?? "Transcription failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);

  // Start (or restart) a MediaRecorder that captures a single segment. On stop
  // it flushes to Whisper and, if still recording, immediately begins the next
  // segment so the gap across a pause is negligible.
  const beginSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      // Resume capture first so we don't drop the start of the next phrase.
      if (recordingRef.current) {
        beginSegment();
      } else {
        releaseMic();
      }
      if (blob.size > 0) void transcribeSegment(blob);
    };

    recorder.start();
    recorderRef.current = recorder;
  }, [releaseMic, transcribeSegment]);

  // Close the current segment; onstop handles transcription + restart/release.
  const endSegment = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    recorderRef.current = null;
  }, []);

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (e) => {
      let interim = "";
      let boundary = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) boundary = true;
        else interim += result[0].transcript;
      }
      onInterimRef.current?.(interim);
      // A finalized phrase = a segment boundary: cut the audio here so this
      // phrase is transcribed and processed while the user keeps talking.
      if (boundary) {
        onInterimRef.current?.("");
        endSegment();
      }
    };
    recognition.onerror = (e) => {
      // "no-speech"/"aborted" are routine; surface anything else.
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(`Speech recognition: ${e.error}`);
      }
    };
    recognition.onend = () => {
      // Chrome ends recognition on long silence even when continuous; revive it.
      if (recordingRef.current) {
        try {
          recognition.start();
        } catch {
          /* already starting — ignore */
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      /* already started — ignore */
    }
  }, [lang, endSegment]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recordingRef.current = true;
      setIsRecording(true);
      beginSegment();
      if (liveSupported) startRecognition();
    } catch (err) {
      recordingRef.current = false;
      setIsRecording(false);
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, [beginSegment, startRecognition, liveSupported]);

  const stop = useCallback(() => {
    recordingRef.current = false;
    setIsRecording(false);
    onInterimRef.current?.("");
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onend = null; // prevent the revive-on-end restart
      try {
        recognition.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    // Flush the final segment; its onstop releases the mic.
    endSegment();
  }, [endSegment]);

  // Tear down if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      recordingRef.current = false;
      recognitionRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return {
    isRecording,
    isTranscribing: inFlight > 0,
    liveSupported,
    error,
    start,
    stop,
  };
}
