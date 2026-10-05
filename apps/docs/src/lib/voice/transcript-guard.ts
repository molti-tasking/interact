/**
 * Whisper hallucination guard.
 *
 * On near-silent or noisy clips, Whisper hallucinates text from its training
 * data — typically YouTube-caption boilerplate ("welcome to my channel",
 * "please subscribe and press the bell icon") looped many times over, or a
 * single stock phrase ("Thank you.", "Thanks for watching!", "Subtitles
 * by …") on a short clip. Three signals catch this:
 *
 * 1. The whole transcript is nothing but a known stock phrase.
 * 2. The same sentence (or word n-gram) looping through most of the text.
 * 3. Far more text than the clip's duration could physically contain.
 *
 * Legitimate repetition is common in dictation — "Okay. Okay.", or the same
 * record spoken twice ("One hoodie. One hoodie.") — so very short sentences
 * don't count towards loops, loops are judged by their *share* of the text
 * rather than an absolute count, and accepted text is returned verbatim
 * (repeated records must not be merged).
 */

export type TranscriptRejection =
  | "empty"
  | "hallucination-phrase"
  | "repetition-loop"
  | "length-implausible";

export interface TranscriptAssessment {
  ok: boolean;
  /** The trimmed transcript (never rewritten — repeats can be real records). */
  text: string;
  reason?: TranscriptRejection;
}

/** Fast conversational speech tops out around ~20 chars/sec; loops blow far past it. */
const MAX_CHARS_PER_SECOND = 30;

/** Sentences with at most this many words never count towards a loop. */
const SHORT_SENTENCE_WORDS = 2;

/** A loop needs at least this many copies of one sentence… */
const LOOP_MIN_COPIES = 3;
/** …and the copies beyond the first must make up this share of the text. */
const LOOP_MIN_SHARE = 0.5;

/**
 * Whisper's stock outputs for silence / noise, normalized (lowercase, no
 * punctuation). A transcript consisting only of these is rejected.
 */
const HALLUCINATION_PHRASES = new Set([
  "you",
  "thank you",
  "thank you very much",
  "thank you so much",
  "thanks",
  "thanks for watching",
  "thank you for watching",
  "thank you so much for watching",
  "thanks for watching and please subscribe",
  "please subscribe",
  "please like and subscribe",
  "like and subscribe",
  "subscribe to my channel",
  "see you in the next video",
  "see you next time",
  "bye",
  "bye bye",
  "the end",
  "music",
  "applause",
  "silence",
  "laughter",
  "vielen dank",
  "vielen dank fürs zuschauen",
  "danke fürs zuschauen",
  "tak for at se med",
  "merci",
  "merci d avoir regardé",
]);

/** Caption-credit boilerplate, matched against the normalized transcript. */
const HALLUCINATION_PATTERNS: RegExp[] = [
  /^(subtitles?|captions?|transcription|transcript)( are| were)? (by|from|provided by|created by)\b/,
  /^(subtitled|captioned|transcribed) by\b/,
  /^untertitel\b/,
  /^sous titres?\b/,
  /^undertekster\b/,
  /\bamara org\b/,
];

function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function wordCount(norm: string): number {
  return norm ? norm.split(" ").length : 0;
}

/** True when every sentence of the transcript is a known stock phrase. */
export function isHallucinationPhrase(text: string): boolean {
  const sentences = splitSentences(text)
    .map(normalizeSentence)
    .filter(Boolean);
  if (sentences.length === 0) return false;
  const whole = normalizeSentence(text);
  if (HALLUCINATION_PATTERNS.some((re) => re.test(whole))) return true;
  return sentences.every(
    (s) =>
      HALLUCINATION_PHRASES.has(s) ||
      HALLUCINATION_PATTERNS.some((re) => re.test(s)),
  );
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?。？！])\s+/);
}

/**
 * Sentence-level loop: one sentence (of ≥3 words) repeated so often that
 * its extra copies make up most of the transcript.
 */
function hasSentenceLoop(sentences: string[]): boolean {
  const counts = new Map<string, number>();
  let totalChars = 0;
  for (const sentence of sentences) {
    const norm = normalizeSentence(sentence);
    if (!norm) continue;
    totalChars += norm.length;
    if (wordCount(norm) <= SHORT_SENTENCE_WORDS) continue;
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  if (totalChars === 0) return false;
  for (const [norm, count] of counts) {
    if (count < LOOP_MIN_COPIES) continue;
    const repeatedChars = (count - 1) * norm.length;
    if (repeatedChars / totalChars >= LOOP_MIN_SHARE) return true;
  }
  return false;
}

/**
 * Word-level loop without sentence punctuation ("thank you thank you thank
 * you …"): one n-gram repeated back-to-back many times, covering most of a
 * long transcript.
 */
function hasNgramLoop(words: string[]): boolean {
  if (words.length < 16) return false;
  for (let n = 1; n <= 8; n++) {
    let i = 0;
    while (i + n <= words.length) {
      const gram = words.slice(i, i + n).join(" ");
      let repeats = 1;
      let j = i + n;
      while (j + n <= words.length && words.slice(j, j + n).join(" ") === gram) {
        repeats++;
        j += n;
      }
      if (repeats >= 5 && (repeats * n) / words.length >= 0.6) return true;
      i += repeats > 1 ? repeats * n : 1;
    }
  }
  return false;
}

export function assessTranscript(
  raw: string,
  durationInSeconds?: number,
): TranscriptAssessment {
  const text = raw.trim();
  if (!normalizeSentence(text)) return { ok: false, text: "", reason: "empty" };

  // Whisper's stock phrases on silence. Whole-transcript match only: the
  // same words inside real speech are kept.
  if (isHallucinationPhrase(text)) {
    return { ok: false, text, reason: "hallucination-phrase" };
  }

  const sentences = splitSentences(text);
  const words = normalizeSentence(text).split(" ");
  if (hasSentenceLoop(sentences) || hasNgramLoop(words)) {
    return { ok: false, text, reason: "repetition-loop" };
  }

  // More text than the clip could contain at any human speaking rate.
  if (
    durationInSeconds &&
    durationInSeconds > 0 &&
    text.length / durationInSeconds > MAX_CHARS_PER_SECOND
  ) {
    return { ok: false, text, reason: "length-implausible" };
  }

  return { ok: true, text };
}
