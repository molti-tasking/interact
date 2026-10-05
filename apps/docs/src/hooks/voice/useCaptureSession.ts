"use client";

import {
  getSpeechRecognition,
  startCaptureSession,
  type CaptureSession,
  type Segmentation,
} from "@/lib/voice/capture-session";
import {
  createOrderedDelivery,
  type OrderedDelivery,
} from "@/lib/voice/ordered-delivery";
import type { TranscribeAudioResponse } from "@/lib/voice/transcription";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export interface CaptureErrorInfo {
  /** Informational notice (discarded clip, fallback) rather than a failure. */
  soft: boolean;
}

export interface UseCaptureSessionOptions {
  /** How the recording is split; read when a recording starts. */
  segmentation: Segmentation;
  /** Transcripts, strictly in recording order. */
  onSegment: (text: string, meta: TranscribeAudioResponse) => void;
  onInterim?: (text: string) => void;
  /** Called for every error event (unlike `error`, which only holds the latest). */
  onError?: (message: string, info: CaptureErrorInfo) => void;
  lang?: string;
}

export interface UseCaptureSessionResult {
  isRecording: boolean;
  /** Waiting for microphone permission / device. */
  isStarting: boolean;
  /** Clips uploaded or awaiting their combined transcript. */
  isTranscribing: boolean;
  /** The browser recognizer is running for the current recording. */
  liveActive: boolean;
  /** Latest hard error; cleared when a transcript arrives or a new recording starts. */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
}

const noopSubscribe = () => () => {};

type Delivered = { text: string; meta: TranscribeAudioResponse };

/** Whether the browser has a speech recognizer (hydration-safe). */
export function useSpeechRecognitionSupported(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => getSpeechRecognition() !== null,
    () => false,
  );
}

function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access was blocked — allow it in the browser's site settings.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone is in use by another app or couldn't be opened.";
    default:
      return err instanceof Error ? err.message : "Microphone access denied";
  }
}

/**
 * Shared lifecycle for the voice capture hooks: microphone acquisition
 * (guarded against double starts and unmounts during the permission prompt),
 * one {@link startCaptureSession} per recording, ordered delivery across
 * sessions, and teardown on unmount (microphone released, pending results
 * dropped).
 */
export function useCaptureSession(
  options: UseCaptureSessionOptions,
): UseCaptureSessionResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [finishing, setFinishing] = useState(0);
  const [liveActive, setLiveActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Latest options without re-creating callbacks.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const sessionRef = useRef<CaptureSession | null>(null);
  const backgroundRef = useRef(new Set<CaptureSession>());
  const startingRef = useRef(false);
  const cancelStartRef = useRef(false);
  const mountedRef = useRef(false);

  // One ordering across sessions: a stopped session's last clip is delivered
  // before the first clip of a recording started right after it. Created on
  // first use (from an event handler, never during render).
  const deliveryRef = useRef<OrderedDelivery<Delivered> | null>(null);
  const getDelivery = useCallback(() => {
    deliveryRef.current ??= createOrderedDelivery<Delivered>(({ text, meta }) => {
      if (!mountedRef.current) return;
      setError(null);
      optionsRef.current.onSegment(text, meta);
    });
    return deliveryRef.current;
  }, []);

  const reportError = useCallback((message: string, info: CaptureErrorInfo) => {
    if (!mountedRef.current) return;
    if (!info.soft) setError(message);
    optionsRef.current.onError?.(message, info);
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || sessionRef.current) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      reportError("Recording isn't supported in this browser.", { soft: false });
      return;
    }

    startingRef.current = true;
    cancelStartRef.current = false;
    setIsStarting(true);
    setError(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      startingRef.current = false;
      setIsStarting(false);
      reportError(describeMicError(err), { soft: false });
      return;
    }
    startingRef.current = false;
    setIsStarting(false);

    // Unmounted or cancelled while the permission prompt was open: don't
    // leave an orphaned stream holding the microphone.
    if (!mountedRef.current || cancelStartRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const { segmentation, lang } = optionsRef.current;
    const delivery = getDelivery();
    const useRecognizer =
      segmentation === "recognizer" && getSpeechRecognition() !== null;

    let session: CaptureSession;
    try {
      session = startCaptureSession({
        stream,
        segmentation: useRecognizer
          ? "recognizer"
          : segmentation === "single"
            ? "single"
            : "pauses",
        lang,
        reserve: delivery.reserve,
        resolve: (seq, text, meta) => delivery.resolve(seq, { text, meta }),
        skip: delivery.skip,
        onInterim: (text) => {
          if (mountedRef.current) optionsRef.current.onInterim?.(text);
        },
        onError: reportError,
        onInFlightChange: (delta) => setInFlight((n) => n + delta),
        onLiveUnavailable: () => setLiveActive(false),
        onFinished: () => {
          backgroundRef.current.delete(session);
          setFinishing((n) => Math.max(0, n - 1));
        },
      });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      reportError(
        err instanceof Error
          ? `Couldn't start recording: ${err.message}`
          : "Couldn't start recording.",
        { soft: false },
      );
      return;
    }

    sessionRef.current = session;
    setIsRecording(true);
    setLiveActive(useRecognizer);
  }, [getDelivery, reportError]);

  const stop = useCallback(() => {
    // Stop pressed while the permission prompt is still open.
    if (startingRef.current) {
      cancelStartRef.current = true;
      return;
    }
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    // Let it finish in the background; a new recording can start right away.
    backgroundRef.current.add(session);
    setFinishing((n) => n + 1);
    setIsRecording(false);
    setLiveActive(false);
    optionsRef.current.onInterim?.("");
    session.stop();
  }, []);

  const toggle = useCallback(() => {
    if (sessionRef.current || startingRef.current) stop();
    else void start();
  }, [start, stop]);

  // Unmount: release the microphone and drop anything not yet delivered.
  useEffect(() => {
    mountedRef.current = true;
    const background = backgroundRef.current;
    return () => {
      mountedRef.current = false;
      cancelStartRef.current = true;
      sessionRef.current?.abort();
      sessionRef.current = null;
      background.forEach((s) => s.abort());
      background.clear();
    };
  }, []);

  return {
    isRecording,
    isStarting,
    isTranscribing: inFlight > 0 || finishing > 0,
    liveActive,
    error,
    start,
    stop,
    toggle,
  };
}
