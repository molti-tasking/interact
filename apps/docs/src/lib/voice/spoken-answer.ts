/**
 * Spoken answers to the questions in the design probe deck (design probes
 * and conflict fixes).
 *
 * `matchSpokenAnswer` handles the unambiguous cases locally — an option's
 * label read out, "the second one", "yes", "skip" — so they apply without
 * waiting for the LLM; everything else is interpreted by
 * `interpretSpokenAnswerAction`.
 */

export interface VoiceQuestion {
  id: string;
  text: string;
  options: { value: string; label: string }[];
  /** Free-text answers are possible (design probes, not conflict fixes) */
  allowCustom: boolean;
}

export type SpokenAnswer =
  | { action: "option"; value: string }
  | { action: "custom"; text: string }
  | { action: "skip" };

const LEADING_FILLER = /^(?:(?:um+|uh+|erm|hmm+|okay|ok|so|well|alright|right)\s+)+/;
const TRAILING_FILLER = /(?:\s+(?:please|thanks|thank you))+$/;

/** Lowercase words without punctuation or filler ("Um, the first one, please." → "the first one"). */
export function normalizeSpoken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(LEADING_FILLER, "")
    .replace(TRAILING_FILLER, "")
    .trim();
}

const SKIP_PHRASES = new Set([
  "skip",
  "skip it",
  "skip this",
  "skip this one",
  "skip that",
  "skip the question",
  "skip this question",
  "next",
  "next one",
  "next question",
  "pass",
  "not relevant",
]);

const ORDINALS: Record<string, number> = {
  first: 0,
  one: 0,
  "1": 0,
  second: 1,
  two: 1,
  "2": 1,
  third: 2,
  three: 2,
  "3": 2,
  fourth: 3,
  four: 3,
  "4": 3,
};

const ORDINAL_PATTERN =
  /^(?:the |option |number |answer )?(first|second|third|fourth|last|one|two|three|four|[1-4])(?: one| option| answer)?$/;

const YES = new Set(["yes", "yeah", "yep", "sure", "yes please"]);
const NO = new Set(["no", "nope", "no thanks"]);

/**
 * The answer when what was said can only mean one thing, otherwise null
 * (left to the LLM). Never guesses: a label must match exactly, and yes/no
 * only counts when exactly one option starts with it.
 */
export function matchSpokenAnswer(
  utterance: string,
  question: VoiceQuestion,
): SpokenAnswer | null {
  const said = normalizeSpoken(utterance);
  if (!said) return null;

  const labels = question.options.map((o) => normalizeSpoken(o.label));
  const exact = labels.indexOf(said);
  if (exact !== -1) return { action: "option", value: question.options[exact].value };

  if (SKIP_PHRASES.has(said)) return { action: "skip" };

  const ordinal = said.match(ORDINAL_PATTERN)?.[1];
  if (ordinal) {
    const index = ordinal === "last" ? question.options.length - 1 : ORDINALS[ordinal];
    const option = question.options[index];
    if (option) return { action: "option", value: option.value };
  }

  const polarity = YES.has(said) ? "yes" : NO.has(said) ? "no" : null;
  if (polarity) {
    const matching = question.options.filter((_, i) =>
      labels[i].split(" ")[0] === polarity,
    );
    if (matching.length === 1) return { action: "option", value: matching[0].value };
  }

  return null;
}
