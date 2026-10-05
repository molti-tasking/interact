/**
 * Voice interaction variants for record mode.
 *
 * Each variant is a different answer to "what happens to an utterance after
 * transcription?" — kept side by side so they can be compared in studies.
 */

export type VoiceInteractionMode = "append" | "smart" | "review";

export interface VoiceModeInfo {
  id: VoiceInteractionMode;
  label: string;
  description: string;
}

export const VOICE_MODES: VoiceModeInfo[] = [
  {
    id: "smart",
    label: "Smart",
    description:
      "Each utterance is classified into the right intent section (or applied as a direct form edit) and merged into coherent prose, so only the minimal pipeline runs.",
  },
  {
    id: "append",
    label: "Append",
    description:
      "The raw transcript is appended to the purpose and the full pipeline runs — the simplest baseline.",
  },
  {
    id: "review",
    label: "Review",
    description:
      "Transcripts wait in a review card where you can edit or discard them before they are applied via smart routing.",
  },
];

export const DEFAULT_VOICE_MODE: VoiceInteractionMode = "smart";

const STORAGE_KEY = "interact.voiceMode";

export function loadVoiceMode(): VoiceInteractionMode {
  if (typeof window === "undefined") return DEFAULT_VOICE_MODE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return VOICE_MODES.some((m) => m.id === stored)
      ? (stored as VoiceInteractionMode)
      : DEFAULT_VOICE_MODE;
  } catch {
    return DEFAULT_VOICE_MODE;
  }
}

export function saveVoiceMode(mode: VoiceInteractionMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — the choice just isn't remembered */
  }
}

// ---------------------------------------------------------------------------
// Capture modes — how speech is turned into phrases before Whisper
// ---------------------------------------------------------------------------

/**
 * "live" uses the browser's speech recognizer for captions and phrase
 * boundaries. Chrome/Edge (Google) and Safari (Apple) run it as a cloud
 * service, so the audio leaves this deployment. "private" detects phrases
 * locally from pauses; audio only goes to the self-hosted Whisper.
 */
export type CaptureMode = "live" | "private";

export interface CaptureModeInfo {
  id: CaptureMode;
  label: string;
  description: string;
  /** Shown whenever the mode is selected; null when nothing to disclose. */
  privacyNotice: string | null;
}

export const CAPTURE_MODES: CaptureModeInfo[] = [
  {
    id: "private",
    label: "Private",
    description:
      "Phrases are detected from your pauses and transcribed only by this deployment's own Whisper server. No live captions.",
    privacyNotice: null,
  },
  {
    id: "live",
    label: "Live captions",
    description:
      "Your browser's speech recognizer shows live captions and detects phrase ends; Whisper still produces the transcript that is applied.",
    privacyNotice:
      "Live captions use your browser's speech service: Chrome and Edge send the audio to Google, Safari to Apple. Choose Private to keep audio on this deployment.",
  },
];

/** Private by default — nothing leaves the deployment unless opted in. */
export const DEFAULT_CAPTURE_MODE: CaptureMode = "private";

const CAPTURE_STORAGE_KEY = "interact.captureMode";

export function loadCaptureMode(): CaptureMode {
  if (typeof window === "undefined") return DEFAULT_CAPTURE_MODE;
  try {
    const stored = window.localStorage.getItem(CAPTURE_STORAGE_KEY);
    return CAPTURE_MODES.some((m) => m.id === stored)
      ? (stored as CaptureMode)
      : DEFAULT_CAPTURE_MODE;
  } catch {
    return DEFAULT_CAPTURE_MODE;
  }
}

export function saveCaptureMode(mode: CaptureMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CAPTURE_STORAGE_KEY, mode);
  } catch {
    /* storage unavailable — the choice just isn't remembered */
  }
}
