/**
 * Helpers for the intent-first "New portfolio" flow: the creator starts with
 * a sentence (lazy data space elicitation) and the title can be derived.
 */

export const MAX_TITLE_LENGTH = 60;

/** Example intents drawn from the paper's walkthrough scenarios. */
export const EXAMPLE_INTENTS: { label: string; text: string }[] = [
  {
    label: "Youth soccer registration",
    text: "I need a registration form for our youth soccer club's new season. Parents sign up their kids, and coaches need age groups, emergency contacts and medical notes before the first practice.",
  },
  {
    label: "Orthopedic patient record",
    text: "We need a shared patient record for our orthopedic clinic. Surgeons, physiotherapists and clinical staff document the injury, imaging, the planned procedure and rehabilitation progress.",
  },
  {
    label: "Sales rep application",
    text: "I need a job application form for a new outside sales representative at our paper and office supply wholesale business, capturing experience, territory knowledge and sales skills.",
  },
];

const LEAD_IN =
  /^(?:please\s+)?(?:i|we)(?:'d|\s+would)?\s+(?:need|want|like)\s+(?:to\s+(?:collect|create|build|make|design|set\s+up|have|capture|gather)\s+)?/i;
const ARTICLE = /^(?:a|an|the|some|our|my)\s+/i;

/**
 * Derive a short title from a free-text intent: first sentence, without a
 * conversational lead-in ("I need a …"), capitalised, ≤ `max` characters
 * (cut at a word boundary with an ellipsis).
 */
export function deriveTitleFromIntent(
  intent: string,
  max: number = MAX_TITLE_LENGTH,
): string {
  const firstLine =
    intent
      .split(/\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  let sentence = (firstLine.split(/(?<=[.!?])\s+/)[0] ?? "")
    .replace(/\s+/g, " ")
    .replace(/[.!?:;,\s]+$/, "")
    .trim();

  const withoutLeadIn = sentence.replace(LEAD_IN, "").replace(ARTICLE, "");
  if (withoutLeadIn.length >= 3) sentence = withoutLeadIn;

  if (!sentence) return "Untitled portfolio";
  sentence = sentence[0].toUpperCase() + sentence.slice(1);

  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:–—-]+$/, "")}…`;
}
