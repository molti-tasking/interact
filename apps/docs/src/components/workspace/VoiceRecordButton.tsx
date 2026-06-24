"use client";

import { Button } from "@/components/ui/button";
import {
  mapTranscriptToSchemaAction,
  applyVoiceSchemaPatch,
  transcribeAudioAction,
} from "@/app/actions/voice-actions";
import type { Portfolio, PortfolioSchema } from "@/lib/types";
import type { DesignProbeRaw } from "@/app/actions/design-probe-actions";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface VoiceRecordButtonProps {
  portfolio: Portfolio;
  currentSchema: PortfolioSchema;
  userId: string;
  onSchemaPatched: (newSchema: PortfolioSchema) => void;
  onClarifications: (probes: DesignProbeRaw[], sessionId: string) => void;
}

type RecordingState = "idle" | "recording" | "transcribing" | "mapping";

/**
 * Voice capture button.  Sits next to the form renderer (`[data-testid="form-renderer"]`).
 *
 * Flow:
 *  1. User presses the button → MediaRecorder starts.
 *  2. User presses again → recording stops, audio blob sent to `transcribeAudioAction`.
 *  3. Transcript sent to `mapTranscriptToSchemaAction` → schemaPatch + clarifications.
 *  4. Schema patch applied immediately; clarifications surface in the design-probe deck.
 */
export function VoiceRecordButton({
  portfolio,
  currentSchema,
  userId,
  onSchemaPatched,
  onClarifications,
}: VoiceRecordButtonProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied");
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "audio/mp4";

    const recorder = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, { type: mimeType });
      setState("transcribing");

      // Convert to base64 for server action transport (browser-compatible)
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);

      const transcribeResult = await transcribeAudioAction(base64, mimeType);
      if (!transcribeResult.success || !transcribeResult.transcript) {
        setError(transcribeResult.error ?? "Transcription failed");
        setState("idle");
        return;
      }

      const rawTranscript = transcribeResult.transcript;
      setTranscript(rawTranscript);
      setState("mapping");

      const sessionId = `vs-${crypto.randomUUID()}`;
      const mapResult = await mapTranscriptToSchemaAction(
        rawTranscript,
        currentSchema,
        sessionId,
        userId,
        // DetectedStandard (with full constraint lists) is not available client-side;
        // the action falls back gracefully when this is undefined.
        undefined,
      );

      if (!mapResult.success || !mapResult.result) {
        setError(mapResult.error ?? "Mapping failed");
        setState("idle");
        return;
      }

      const { schemaPatch, clarifications } = mapResult.result;

      // Apply schema patch if there are structural changes
      const hasStructuralChanges =
        (schemaPatch.addFields?.length ?? 0) > 0 ||
        (schemaPatch.updateFields?.length ?? 0) > 0 ||
        (schemaPatch.removeFieldKeys?.length ?? 0) > 0;

      if (hasStructuralChanges) {
        const newSchema = applyVoiceSchemaPatch(currentSchema, schemaPatch);
        onSchemaPatched(newSchema);
      }

      // Surface clarifications through the design-probe deck
      if (clarifications.length > 0) {
        onClarifications(clarifications, sessionId);
      }

      setState("idle");
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setState("recording");
  }, [currentSchema, portfolio, userId, onSchemaPatched, onClarifications]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  const handleClick = () => {
    if (state === "recording") {
      stopRecording();
    } else if (state === "idle") {
      startRecording();
    }
  };

  const isProcessing = state === "transcribing" || state === "mapping";

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant={state === "recording" ? "destructive" : "outline"}
        size="sm"
        data-testid="voice-record-btn"
        onClick={handleClick}
        disabled={isProcessing}
        className="gap-1.5 text-xs"
        aria-label={
          state === "recording"
            ? "Stop recording"
            : isProcessing
              ? "Processing voice…"
              : "Record voice input"
        }
      >
        {isProcessing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "recording" ? (
          <MicOff className="h-3.5 w-3.5" />
        ) : (
          <Mic className="h-3.5 w-3.5" />
        )}
        {state === "recording"
          ? "Stop"
          : state === "transcribing"
            ? "Transcribing…"
            : state === "mapping"
              ? "Mapping…"
              : "Voice"}
      </Button>

      {transcript && (
        <p className="text-[10px] text-muted-foreground leading-tight max-w-[14rem] line-clamp-3">
          "{transcript}"
        </p>
      )}

      {error && (
        <p className="text-[10px] text-destructive">{error}</p>
      )}
    </div>
  );
}
