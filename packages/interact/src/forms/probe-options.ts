/**
 * The answers of an elicitation question, as the creator sees them.
 *
 * Three properties are decided here and nowhere else, so they hold whatever
 * a model returned:
 *
 * - **One answer leaves the form unchanged.** Exactly one: it is added when
 *   missing, and a second answer that turns out to change nothing is
 *   dropped. (The free-text answer is not an option; the card always offers
 *   it, last.)
 * - **The display order is random and stored.** The answers are shuffled
 *   once, when the question is created; each keeps the position the model
 *   gave it (`modelPosition`), so position on screen is not confounded with
 *   the model's ordering and both can be analysed.
 * - **An answer is committed only after its preview was shown**
 *   (`answerGate`).
 */

import { applyProbeOption } from "./guards";
import type { DesignProbeOption, PortfolioSchema, ProbeOptionPreview } from "./types";

/** Value of the unchanged answer when it had to be added. */
export const UNCHANGED_VALUE = "keepAsIs";
export const UNCHANGED_LABEL = "Keep the form as it is";
const UNCHANGED_SUMMARY = "Keeps the form as it is";

function unchangedPreview(): ProbeOptionPreview {
  return {
    summary: UNCHANGED_SUMMARY,
    schemaPatch: {},
    scope: { added: [], updated: [], removed: [] },
  };
}

function patchIsEmpty(preview: ProbeOptionPreview): boolean {
  const { addFields, removeFieldKeys, updateFields, sections } = preview.schemaPatch;
  return (
    !addFields?.length &&
    !removeFieldKeys?.length &&
    !updateFields?.length &&
    !sections?.length
  );
}

/**
 * Does this answer leave the form as it is? True for the marked answer;
 * otherwise decided from its preview — against `schema` when given (a patch
 * can be non-empty and still change nothing), else by an empty patch. An
 * answer without a preview is not known to be unchanged.
 */
export function leavesFormUnchanged(
  option: DesignProbeOption,
  schema?: PortfolioSchema,
  opts: { validTargetIds?: Iterable<string> } = {},
): boolean {
  if (option.unchanged) return true;
  if (!option.preview) return false;
  if (patchIsEmpty(option.preview)) return true;
  return schema ? !applyProbeOption(schema, option.preview, opts).changed : false;
}

/**
 * Exactly one answer that leaves the form unchanged, marked `unchanged`.
 *
 * - none → one is appended ("Keep the form as it is", with an empty preview)
 * - several → the marked one stays (else the first); the others are dropped
 *
 * The order of the remaining answers is kept, so this is safe to run again
 * when previews arrive for a question that is already on screen.
 */
export function ensureUnchangedOption(
  options: readonly DesignProbeOption[],
  schema?: PortfolioSchema,
  opts: { validTargetIds?: Iterable<string> } = {},
): DesignProbeOption[] {
  const unchanged = options.filter((o) => leavesFormUnchanged(o, schema, opts));
  const keep = unchanged.find((o) => o.unchanged) ?? unchanged[0];

  if (!keep) {
    const taken = new Set(options.map((o) => o.value));
    let value = UNCHANGED_VALUE;
    for (let n = 2; taken.has(value); n++) value = `${UNCHANGED_VALUE}${n}`;
    return [
      ...options,
      {
        value,
        label: UNCHANGED_LABEL,
        preview: unchangedPreview(),
        unchanged: true,
        // Not one of the model's answers
        modelPosition: null,
      },
    ];
  }

  return options
    .filter((o) => o === keep || !unchanged.includes(o))
    .map((o) =>
      o === keep
        ? { ...o, unchanged: true, preview: o.preview ?? unchangedPreview() }
        : o,
    );
}

/** A random number in [0, 1), like `Math.random`. */
export type Random = () => number;

/**
 * A reproducible `Random` from a string (xmur3 seed → mulberry32). For
 * tests and recorded runs; the app shuffles with `Math.random` otherwise.
 */
export function seededRandom(seed: string): Random {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], random: Random): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * What every new question's answers go through before they are stored: one
 * unchanged answer, then a random display order (Fisher–Yates) in which each
 * answer remembers where the model had put it.
 *
 * Answers that already carry a `modelPosition` were ordered before: their
 * order is kept, so it is drawn once per question.
 */
export function prepareProbeOptions(
  options: readonly DesignProbeOption[],
  opts: {
    schema?: PortfolioSchema;
    validTargetIds?: Iterable<string>;
    random?: Random;
  } = {},
): DesignProbeOption[] {
  const ordered = options.some((o) => o.modelPosition !== undefined);
  // The model's positions are taken before the unchanged answer is added,
  // so an added one is recognisable (`modelPosition: null`)
  const positioned = ordered
    ? [...options]
    : options.map((o, i): DesignProbeOption => ({ ...o, modelPosition: i }));
  const complete = ensureUnchangedOption(positioned, opts.schema, opts);
  return ordered ? complete : shuffle(complete, opts.random ?? Math.random);
}

/**
 * Previews that arrived for a question already stored: merged onto its
 * answers by value. The stored order, the unchanged answer and its preview
 * stay; a second answer that turns out to change nothing is dropped.
 */
export function mergeOptionPreviews(
  stored: readonly DesignProbeOption[],
  previewed: readonly DesignProbeOption[],
  schema?: PortfolioSchema,
  opts: { validTargetIds?: Iterable<string> } = {},
): DesignProbeOption[] {
  const byValue = new Map(previewed.map((o) => [o.value, o.preview]));
  const merged = stored.map((o): DesignProbeOption => {
    if (o.unchanged) return { ...o, preview: o.preview ?? unchangedPreview() };
    const preview = byValue.get(o.value) ?? o.preview;
    return preview ? { ...o, preview } : { ...o };
  });
  return ensureUnchangedOption(merged, schema, opts);
}

// ---------------------------------------------------------------------------
// Consequences before commitment
// ---------------------------------------------------------------------------

export type AnswerGate =
  /** Its preview is on screen: the click commits it */
  | "apply"
  /** A preview exists but was not on screen at the click: show it first */
  | "show-preview"
  /** The preview is still being worked out: wait for it, then show it */
  | "await-preview"
  /** No preview and none coming: the answer can't be committed */
  | "unavailable";

/**
 * What choosing an answer may do. An answer is committed only when its
 * preview was on screen at the moment it was chosen; nothing here ever
 * returns "apply" for an answer without a preview.
 */
export function answerGate(state: {
  hasPreview: boolean;
  /** The preview (what the answer changes) was displayed when it was chosen */
  previewShown: boolean;
  previewStatus: "pending" | "ready" | "failed" | null;
}): AnswerGate {
  if (state.hasPreview) return state.previewShown ? "apply" : "show-preview";
  return state.previewStatus === "pending" || state.previewStatus === null
    ? "await-preview"
    : "unavailable";
}
