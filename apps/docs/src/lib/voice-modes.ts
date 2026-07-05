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
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return VOICE_MODES.some((m) => m.id === stored)
    ? (stored as VoiceInteractionMode)
    : DEFAULT_VOICE_MODE;
}

export function saveVoiceMode(mode: VoiceInteractionMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
}
