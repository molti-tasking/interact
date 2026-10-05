"use client";

import { Button } from "@/components/ui/button";
import { useVoiceCapture } from "@/hooks/voice/useVoiceCapture";
import { cn } from "@/lib/utils";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";

interface MicButtonProps {
  onTranscript: (text: string) => void;
  /**
   * Prevents *starting* a recording. A recording in progress can always be
   * stopped, whatever this says.
   */
  disabled?: boolean;
  className?: string;
  /** Accessible name; stays the same while recording (state is `aria-pressed`). */
  label?: string;
}

/**
 * Toggle-to-record mic button. Click to start, click to stop; on stop the clip
 * is transcribed (self-hosted Whisper) and the text handed to `onTranscript`.
 * Errors are shown as toasts; the microphone is released on stop and unmount.
 */
export function MicButton({
  onTranscript,
  disabled,
  className,
  label = "Dictate intent",
}: MicButtonProps) {
  const { isRecording, isStarting, isTranscribing, error, toggle } =
    useVoiceCapture(onTranscript, {
      onError: (message, { soft }) => {
        if (!soft) toast.error(message, { id: "mic-button-error" });
      },
    });

  const active = isRecording || isStarting;
  // Never block stopping: only starting a new recording can be disabled.
  const isDisabled = !active && (disabled || isTranscribing);

  return (
    <Button
      type="button"
      variant={active ? "destructiveSoft" : "ghost"}
      size="icon-sm"
      disabled={isDisabled}
      onClick={toggle}
      title={
        error
          ? error
          : isStarting
            ? "Waiting for microphone… (click to cancel)"
            : isRecording
              ? "Stop recording"
              : isTranscribing
                ? "Transcribing…"
                : label
      }
      aria-label={label}
      aria-pressed={active}
      aria-busy={isTranscribing || undefined}
      className={cn(isRecording && "motion-safe:animate-pulse", className)}
    >
      {isTranscribing && !active ? (
        <Loader2 className="motion-safe:animate-spin" />
      ) : active ? (
        <Square />
      ) : (
        <Mic />
      )}
    </Button>
  );
}
