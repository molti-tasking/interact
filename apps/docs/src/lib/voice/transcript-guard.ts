/**
 * Whisper hallucination guard.
 *
 * On near-silent or noisy clips, Whisper hallucinates text from its training
 * data — typically YouTube-caption boilerplate ("welcome to my channel",
 * "please subscribe and press the bell icon") looped many times over. Two
 * signals catch this reliably without any blocklist:
 *
 * 1. The same sentence repeated over and over (Whisper's looping failure).
 * 2. Far more text than the clip's duration could physically contain.
 */

export interface TranscriptAssessment {
  ok: boolean;
  /** Cleaned text: consecutive duplicate sentences collapsed. */
  text: string;
  reason?: "empty" | "repetition-loop" | "length-implausible";
}

/** Fast conversational speech tops out around ~20 chars/sec; loops blow far past it. */
const MAX_CHARS_PER_SECOND = 30;

function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function assessTranscript(
  raw: string,
  durationInSeconds?: number,
): TranscriptAssessment {
  const text = raw.trim();
  if (!text) return { ok: false, text: "", reason: "empty" };

  const sentences = text.split(/(?<=[.!?])\s+/);

  // Collapse consecutive duplicates and count global repetition
  const collapsed: string[] = [];
  const counts = new Map<string, number>();
  let consecutiveDupes = 0;

  for (const sentence of sentences) {
    const norm = normalizeSentence(sentence);
    if (!norm) continue;
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
    const prev = collapsed[collapsed.length - 1];
    if (prev !== undefined && normalizeSentence(prev) === norm) {
      consecutiveDupes++;
      continue;
    }
    collapsed.push(sentence);
  }

  const cleaned = collapsed.join(" ");
  const maxGlobalCount = Math.max(0, ...counts.values());
  const dupeRatio = sentences.length > 0 ? consecutiveDupes / sentences.length : 0;

  // A sentence looping through most of the transcript is a hallucination.
  // (Repeating something twice is normal speech; a wall of copies is not.)
  if ((consecutiveDupes >= 3 && dupeRatio > 0.4) || maxGlobalCount >= 4) {
    return { ok: false, text: cleaned, reason: "repetition-loop" };
  }

  // More text than the clip could contain at any human speaking rate.
  if (
    durationInSeconds &&
    durationInSeconds > 0 &&
    cleaned.length / durationInSeconds > MAX_CHARS_PER_SECOND
  ) {
    return { ok: false, text: cleaned, reason: "length-implausible" };
  }

  return { ok: true, text: cleaned };
}
