"use client";

import { Button } from "@/components/ui/button";
import { useVoiceCapture } from "@/hooks/voice/useVoiceCapture";
import { cn } from "@/lib/utils";
import { Loader2, Mic, Square } from "lucide-react";

interface MicButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Toggle-to-record mic button. Click to start, click to stop; on stop the clip
 * is transcribed and the resulting text is handed to `onTranscript`.
 */
export function MicButton({
  onTranscript,
  disabled,
  className,
}: MicButtonProps) {
  const { isRecording, isTranscribing, error, start, stop } =
    useVoiceCapture(onTranscript);

  return (
    <Button
      type="button"
      variant={isRecording ? "destructiveSoft" : "ghost"}
      size="icon-sm"
      disabled={disabled || isTranscribing}
      onClick={() => (isRecording ? stop() : start())}
      title={
        error ? error : isRecording ? "Stop recording" : "Dictate intent"
      }
      aria-label={isRecording ? "Stop recording" : "Dictate intent"}
      aria-pressed={isRecording}
      className={cn(isRecording && "animate-pulse", className)}
    >
      {isTranscribing ? (
        <Loader2 className="animate-spin" />
      ) : isRecording ? (
        <Square />
      ) : (
        <Mic />
      )}
    </Button>
  );
}
