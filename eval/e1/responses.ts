/**
 * Synthetic responses to a scenario's base form: 30 per scenario, from a
 * seeded generator, with values plausible for each field's type (no
 * participant data). Required fields are always answered; optional ones
 * three times in four. Stored keyed by field key, as the app stores them.
 */

import type { Field, PortfolioSchema } from "@/lib/types";
import { intBetween, pick, rng } from "../lib/random";

export const RESPONSES_PER_SCENARIO = 30;
const OPTIONAL_ANSWERED = 0.75;

const FIRST = ["Ada", "Ben", "Clara", "David", "Elif", "Farah", "Gustav", "Hana", "Ivo", "Jonas", "Kira", "Lars", "Mira", "Noah", "Olga", "Pia"];
const LAST = ["Andersen", "Berg", "Costa", "Dahl", "Eriksen", "Fischer", "Garcia", "Holm", "Ivanova", "Jensen", "Koch", "Larsen", "Meyer", "Nowak", "Olsen", "Petrov"];
const WORDS = ["weekly", "morning", "flexible", "evenings", "team", "season", "local", "regular", "standard", "first", "review", "follow-up"];

/** Domain answers for free-text fields, by what their label asks. */
const TEXT_BY_LABEL: [RegExp, readonly string[]][] = [
  [/diagnos/i, ["Osteoarthritis of the knee", "Hip fracture", "Rotator cuff tear", "ACL rupture", "Lumbar disc herniation"]],
  [/medication/i, ["Ibuprofen 400 mg", "Paracetamol 1 g", "None", "Metformin 500 mg", "Atorvastatin 20 mg"]],
  [/allerg/i, ["None known", "Penicillin", "Latex", "Peanuts", "None known"]],
  [/blood pressure/i, ["120/80", "135/85", "118/76", "142/90", "125/82"]],
  [/note/i, ["Stable, mobilising with crutches", "Pain controlled", "Wound clean and dry", "Review in two weeks"]],
  [/interest|why/i, ["I enjoy building long-term client relationships.", "I want to grow with a software company.", "Selling technical products is what I do best."]],
  [/resume|link|url|website/i, ["https://example.org/cv.pdf", "https://example.org/profile"]],
];

function textValue(field: Field, random: () => number, person: { first: string; last: string }): string {
  const label = `${field.label} ${field.name}`;
  if (/e-?mail/i.test(label)) return `${person.first}.${person.last}@example.org`.toLowerCase();
  if (/phone|mobile/i.test(label)) return `+45 ${intBetween(random, 20, 99)} ${intBetween(random, 10, 99)} ${intBetween(random, 10, 99)} ${intBetween(random, 10, 99)}`;
  if (/name/i.test(label)) return `${pick(random, FIRST)} ${person.last}`;
  for (const [pattern, answers] of TEXT_BY_LABEL) {
    if (pattern.test(label)) return pick(random, answers);
  }
  return `${pick(random, WORDS)} ${pick(random, WORDS)}`;
}

function isoDate(year: number, random: () => number): string {
  const month = intBetween(random, 1, 12);
  const day = intBetween(random, 1, 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateValue(field: Field, random: () => number, scenario: string): string {
  const label = `${field.label} ${field.name}`;
  if (/birth/i.test(label)) {
    // Players aged 9–14 in 2026; adults otherwise
    return scenario === "soccer"
      ? isoDate(intBetween(random, 2012, 2017), random)
      : isoDate(intBetween(random, 1946, 2006), random);
  }
  return isoDate(2026, random);
}

function numberValue(field: Field & { type: { kind: "number" } }, random: () => number): number {
  const label = `${field.label} ${field.name}`;
  if (/year/i.test(label)) return intBetween(random, 0, 15);
  if (/heart|pulse|bpm/i.test(label)) return intBetween(random, 55, 110);
  if (/temperature/i.test(label)) return Math.round((36 + random() * 3) * 10) / 10;
  const min = field.type.min ?? 0;
  const max = field.type.max ?? 100;
  return intBetween(random, min, max);
}

/** One plausible answer to `field`, or undefined when the field takes none here. */
function valueFor(field: Field, random: () => number, scenario: string, person: { first: string; last: string }): unknown {
  const t = field.type;
  switch (t.kind) {
    case "text":
      return textValue(field, random, person);
    case "number":
      return numberValue(field as Field & { type: typeof t }, random);
    case "date":
      return dateValue(field, random, scenario);
    case "boolean":
      return random() < 0.5;
    case "select": {
      if (t.options.length === 0) return undefined;
      if (!t.multiple) return pick(random, t.options).value;
      const chosen = t.options.filter(() => random() < 0.4);
      return (chosen.length ? chosen : [pick(random, t.options)]).map((o) => o.value);
    }
    case "scale":
      return intBetween(random, t.min, t.max);
    default:
      // file, reference, group: no stored value to make up
      return undefined;
  }
}

export interface SyntheticResponse {
  data: Record<string, unknown>;
}

export function generateResponses(
  scenario: string,
  schema: PortfolioSchema,
  count = RESPONSES_PER_SCENARIO,
): SyntheticResponse[] {
  const random = rng(`e1-responses:${scenario}`);
  const out: SyntheticResponse[] = [];
  for (let i = 0; i < count; i++) {
    const person = { first: pick(random, FIRST), last: pick(random, LAST) };
    const data: Record<string, unknown> = {};
    for (const field of schema.fields) {
      // Draw for every field, answered or not, so a change to one field's
      // rule doesn't shift the values of the others
      const answered = field.required || random() < OPTIONAL_ANSWERED;
      const value = valueFor(field, random, scenario, person);
      if (answered && value !== undefined) data[field.name] = value;
    }
    out.push({ data });
  }
  return out;
}
