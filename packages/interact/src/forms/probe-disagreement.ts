/**
 * Choosing design probes by disagreement.
 *
 * Instead of asking a model "which questions should we ask?", several
 * complete designs of the form are drafted independently from the same
 * description (a committee). Where the drafts agree with the current form,
 * there is nothing to decide. Where they differ — half of them add a field,
 * some drop one, they split on whether it is required — the description
 * leaves the decision open, and that is what a probe should ask about.
 *
 * This file is the deterministic part:
 * 1. `findDisagreements` aligns the drafts with the current form and turns
 *    every difference into an atomic change (`DisagreementOp`) with its
 *    vote count and vote entropy (highest when the committee splits evenly).
 * 2. A model then only words the questions: it groups ops into probes whose
 *    options are sets of op refs (`composeProbes` validates that).
 * 3. `opsPatch` builds each option's schema patch from the drafts' own field
 *    definitions — so an answer's preview exists the moment the probe does,
 *    without a further LLM call.
 *
 * (Selecting what to ask by committee disagreement is query-by-committee
 * from active learning, applied to schema design.)
 */

import type {
  DesignProbeOption,
  Field,
  PortfolioSchema,
  ProbeOptionPreview,
  ProbePriority,
} from "./types";
import {
  applySchemaPatch,
  patchFieldFromField,
  type PatchField,
  type PatchFieldUpdate,
  type SchemaPatch,
} from "./schema-patch";

/** One independently drafted design of the whole form. */
export interface CandidateDesign {
  fields: PatchField[];
}

export type DisagreementKind = "add" | "remove" | "required" | "options";

export interface DisagreementOp {
  /** Short ref for prompts: a1, r1, q1 (required), o1 (options) */
  ref: string;
  kind: DisagreementKind;
  /** Field key the op is about (the representative draft's key for adds) */
  key: string;
  label: string;
  /** Drafts in favour of the change */
  votes: number;
  /** Drafts that had a say (all of them for add/remove) */
  voters: number;
  /** Binary vote entropy in bits: 1 = evenly split, 0 = unanimous */
  entropy: number;
  /** What the change does, for prompts and previews */
  summary: string;
  patch: SchemaPatch;
}

// ---------------------------------------------------------------------------
// Aligning fields across drafts
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "your", "you", "do", "does", "is", "are", "what",
  "which", "how", "to", "for", "and", "or", "in", "on", "please", "any",
  "have", "has", "would", "field", "info", "information", "details",
]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Content words of a key or label: camelCase split, lowercased, stemmed. */
export function fieldTokens(text: string): Set<string> {
  const words = text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(stem);
  return new Set(words);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

interface Signature {
  key: string;
  keyTokens: Set<string>;
  labelTokens: Set<string>;
}

function signature(key: string, label: string): Signature {
  return { key, keyTokens: fieldTokens(key), labelTokens: fieldTokens(label) };
}

/** Two fields that ask for the same thing under different names. */
const SAME_FIELD = 0.6;

function similarity(a: Signature, b: Signature): number {
  if (a.key.toLowerCase() === b.key.toLowerCase()) return 1;
  return Math.max(
    jaccard(a.keyTokens, b.keyTokens),
    jaccard(a.labelTokens, b.labelTokens),
  );
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

/** Binary entropy (bits) of `votes` out of `voters`. */
export function voteEntropy(votes: number, voters: number): number {
  if (voters <= 0 || votes <= 0 || votes >= voters) return 0;
  const p = votes / voters;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
}

function optionLabels(field: Pick<PatchField, "validation">): string[] {
  const options = field.validation?.options;
  if (!Array.isArray(options)) return [];
  return options.map((o) =>
    typeof o === "string"
      ? o
      : String((o as { label?: unknown; value?: unknown })?.label ?? (o as { value?: unknown })?.value ?? ""),
  );
}

const optionSignature = (labels: string[]) =>
  labels.map((l) => l.trim().toLowerCase()).filter(Boolean).sort().join("|");

function list(labels: string[], max = 4): string {
  const shown = labels.slice(0, max).join(", ");
  return labels.length > max ? `${shown}, …` : shown;
}

function describeNewField(f: PatchField): string {
  const kind =
    f.type === "select"
      ? `choice: ${list(optionLabels(f))}`
      : f.type === "scale"
        ? "rating"
        : f.type === "string"
          ? "text"
          : f.type;
  return `add "${f.label}" (${kind}${f.required ? ", required" : ""})`;
}

/** The draft definition most others resemble: majority type, then most options. */
function representative(members: PatchField[]): PatchField {
  const byType = new Map<string, PatchField[]>();
  for (const m of members) byType.set(m.type, [...(byType.get(m.type) ?? []), m]);
  const majority = [...byType.values()].sort((a, b) => b.length - a.length)[0];
  const requiredVotes = majority.filter((m) => m.required).length;
  const best = [...majority].sort(
    (a, b) => optionLabels(b).length - optionLabels(a).length,
  )[0];
  return { ...best, required: requiredVotes * 2 > majority.length };
}

/**
 * Every way the drafts differ from the current form, as atomic changes,
 * most contested first. Locked fields are never proposed for change.
 */
export function findDisagreements(
  current: PortfolioSchema,
  candidates: readonly CandidateDesign[],
): DisagreementOp[] {
  const total = candidates.length;
  if (total === 0) return [];

  const existing = current.fields.map((field) => ({
    field,
    sig: signature(field.name, field.label),
    /** The matching field of each draft that kept it */
    kept: [] as PatchField[],
  }));
  const clusters: { sig: Signature; members: PatchField[]; drafts: Set<number> }[] = [];

  candidates.forEach((candidate, draft) => {
    const matchedExisting = new Set<number>();
    for (const f of candidate.fields) {
      if (!f.key?.trim() || !f.label?.trim()) continue;
      const sig = signature(f.key, f.label);

      // A field of the current form (each matched at most once per draft)
      let best = -1;
      let bestScore = SAME_FIELD;
      existing.forEach((e, i) => {
        if (matchedExisting.has(i)) return;
        const score = similarity(sig, e.sig);
        if (score >= bestScore && (score > bestScore || best < 0)) {
          best = i;
          bestScore = score;
        }
      });
      if (best >= 0) {
        matchedExisting.add(best);
        existing[best].kept.push(f);
        continue;
      }

      // A field other drafts proposed too (one per draft and cluster)
      let cluster: (typeof clusters)[number] | undefined;
      let clusterScore = SAME_FIELD;
      for (const c of clusters) {
        if (c.drafts.has(draft)) continue;
        const score = similarity(sig, c.sig);
        if (score >= clusterScore && (score > clusterScore || !cluster)) {
          cluster = c;
          clusterScore = score;
        }
      }
      if (cluster) {
        cluster.members.push(f);
        cluster.drafts.add(draft);
      } else {
        clusters.push({ sig, members: [f], drafts: new Set([draft]) });
      }
    }
  });

  const ops: DisagreementOp[] = [];
  const counter: Record<string, number> = {};
  const push = (
    prefix: string,
    op: Omit<DisagreementOp, "ref" | "entropy">,
  ) => {
    counter[prefix] = (counter[prefix] ?? 0) + 1;
    ops.push({
      ...op,
      ref: `${prefix}${counter[prefix]}`,
      entropy: voteEntropy(op.votes, op.voters),
    });
  };

  // Fields the form doesn't have yet
  const takenKeys = new Set(current.fields.map((f) => f.name));
  for (const cluster of clusters) {
    const field = representative(cluster.members);
    if (takenKeys.has(field.key)) continue;
    takenKeys.add(field.key);
    push("a", {
      kind: "add",
      key: field.key,
      label: field.label,
      votes: cluster.drafts.size,
      voters: total,
      summary: describeNewField(field),
      patch: { addFields: [field] },
    });
  }

  // Fields the form has: dropped, or changed, by some drafts
  for (const { field, kept } of existing) {
    if (field.locked) continue;

    const dropped = total - kept.length;
    if (dropped > 0) {
      push("r", {
        kind: "remove",
        key: field.name,
        label: field.label,
        votes: dropped,
        voters: total,
        summary: `remove "${field.label}"`,
        patch: { removeFieldKeys: [field.name] },
      });
    }
    if (kept.length === 0) continue;

    const flipped = kept.filter((k) => k.required !== field.required).length;
    if (flipped > 0) {
      push("q", {
        kind: "required",
        key: field.name,
        label: field.label,
        votes: flipped,
        voters: kept.length,
        summary: `make "${field.label}" ${field.required ? "optional" : "required"}`,
        patch: { updateFields: [{ key: field.name, required: !field.required }] },
      });
    }

    if (field.type.kind === "select") {
      const now = optionSignature(field.type.options.map((o) => o.label));
      const proposals = new Map<string, { labels: string[]; votes: number }>();
      for (const k of kept) {
        if (k.type !== "select") continue;
        const labels = optionLabels(k).filter((l) => l.trim());
        const sig = optionSignature(labels);
        if (labels.length < 2 || sig === now) continue;
        const entry = proposals.get(sig) ?? { labels, votes: 0 };
        entry.votes++;
        proposals.set(sig, entry);
      }
      const changed = [...proposals.values()].reduce((a, p) => a + p.votes, 0);
      const top = [...proposals.values()].sort((a, b) => b.votes - a.votes)[0];
      if (top) {
        const update: PatchFieldUpdate = {
          key: field.name,
          validation: { options: top.labels.map((label) => ({ label, value: label })) },
        };
        push("o", {
          kind: "options",
          key: field.name,
          label: field.label,
          votes: changed,
          voters: kept.length,
          summary: `change the options of "${field.label}" to: ${list(top.labels, 6)}`,
          patch: { updateFields: [update] },
        });
      }
    }
  }

  return rankDisagreements(ops);
}

const KIND_ORDER: Record<DisagreementKind, number> = {
  add: 0,
  remove: 1,
  options: 2,
  required: 3,
};

/**
 * Most contested first (vote entropy), then the changes more drafts want,
 * then by how much of the form the change touches.
 */
export function rankDisagreements(ops: readonly DisagreementOp[]): DisagreementOp[] {
  return [...ops].sort(
    (a, b) =>
      b.entropy - a.entropy ||
      b.votes / b.voters - a.votes / a.voters ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  );
}

/** One line per op for the wording prompt. */
export function describeOps(ops: readonly DisagreementOp[]): string {
  return ops
    .map((op) => `- ${op.ref}: ${op.summary} — ${op.votes} of ${op.voters} drafts`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// From ops to probes
// ---------------------------------------------------------------------------

/** The patch for choosing a set of ops together. */
export function opsPatch(ops: readonly DisagreementOp[]): SchemaPatch {
  const patch: Required<Pick<SchemaPatch, "addFields" | "removeFieldKeys" | "updateFields">> = {
    addFields: [],
    removeFieldKeys: [],
    updateFields: [],
  };
  for (const op of ops) {
    patch.addFields.push(...(op.patch.addFields ?? []));
    patch.removeFieldKeys.push(...(op.patch.removeFieldKeys ?? []));
    for (const update of op.patch.updateFields ?? []) {
      // Two changes to the same field (options + required) become one update
      const same = patch.updateFields.findIndex((u) => u.key === update.key);
      if (same >= 0) patch.updateFields[same] = { ...patch.updateFields[same], ...update };
      else patch.updateFields.push(update);
    }
  }
  // A field can't be removed and changed by the same answer
  const removed = new Set(patch.removeFieldKeys);
  patch.updateFields = patch.updateFields.filter((u) => !removed.has(u.key));
  return patch;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function previewFor(
  schema: PortfolioSchema,
  ops: readonly DisagreementOp[],
): ProbeOptionPreview {
  if (ops.length === 0) {
    return {
      summary: "No form change",
      schemaPatch: {},
      scope: { added: [], updated: [], removed: [] },
    };
  }
  const schemaPatch = opsPatch(ops);
  const { applied } = applySchemaPatch(schema, schemaPatch);
  const adds = ops.filter((o) => o.kind === "add").map((o) => `"${o.label}"`);
  const rest = ops.filter((o) => o.kind !== "add").map((o) => o.summary);
  const parts = [adds.length ? `add ${list(adds, 3)}` : "", ...rest].filter(Boolean);
  return {
    summary: capitalize(parts.join("; ")),
    schemaPatch,
    scope: { added: applied.added, updated: applied.updated, removed: applied.removed },
  };
}

/** A probe as the wording model returns it: options are sets of op refs. */
export interface ComposedProbe {
  text: string;
  explanation?: string | null;
  options: { value: string; label: string; ops: string[] }[];
}

export interface DisagreementProbe {
  text: string;
  explanation?: string;
  priority: ProbePriority;
  options: (DesignProbeOption & { preview: ProbeOptionPreview })[];
  /** Highest vote entropy among the ops the probe decides */
  entropy: number;
  /** The ops it decides, for logging */
  ops: { ref: string; kind: DisagreementKind; key: string; votes: number; voters: number }[];
}

/**
 * Turn worded questions into probes with ready previews. Validates what the
 * model returned against the ops instead of trusting it:
 * - options naming an unknown op are dropped; an op belongs to one probe only;
 * - two options with the same set of ops collapse into one;
 * - every probe gets an option that leaves the form as it is;
 * - probes left with fewer than two options, or deciding nothing, are dropped.
 * Probes come back most contested first, at most `max`.
 */
export function composeProbes(
  schema: PortfolioSchema,
  ops: readonly DisagreementOp[],
  composed: readonly ComposedProbe[],
  max: number,
): DisagreementProbe[] {
  const byRef = new Map(ops.map((op) => [op.ref, op]));
  const claimed = new Set<string>();
  const probes: DisagreementProbe[] = [];

  for (const item of composed) {
    const text = item.text?.trim();
    if (!text) continue;

    const options: DisagreementProbe["options"] = [];
    const seenSets = new Set<string>();
    const seenValues = new Set<string>();
    const used = new Map<string, DisagreementOp>();

    for (const option of item.options ?? []) {
      const label = option.label?.trim();
      const refs = [...new Set((option.ops ?? []).map((r) => r.trim()))];
      if (!label || refs.some((r) => !byRef.has(r) || claimed.has(r))) continue;
      const setKey = [...refs].sort().join(",");
      if (seenSets.has(setKey)) continue;
      seenSets.add(setKey);

      let value = option.value?.trim() || `option${options.length + 1}`;
      while (seenValues.has(value)) value = `${value}${options.length + 1}`;
      seenValues.add(value);

      const chosen = refs.map((r) => byRef.get(r)!);
      for (const op of chosen) used.set(op.ref, op);
      options.push({ value, label, preview: previewFor(schema, chosen) });
    }

    if (used.size === 0) continue;
    if (!seenSets.has("")) {
      options.push({ value: "keepAsIs", label: "Keep as is", preview: previewFor(schema, []) });
    }
    if (options.length < 2) continue;

    for (const ref of used.keys()) claimed.add(ref);
    const decided = [...used.values()];
    const entropy = Math.max(...decided.map((o) => o.entropy));
    const structural = decided.some((o) => o.kind === "add" || o.kind === "remove");
    probes.push({
      text,
      explanation: item.explanation?.trim() || undefined,
      // An even split over what the form collects is the most consequential
      // open decision; wording-level differences are polish
      priority: !structural ? 3 : entropy >= 0.9 || decided.length > 1 ? 1 : 2,
      options: options.slice(0, 4),
      entropy,
      ops: decided.map(({ ref, kind, key, votes, voters }) => ({ ref, kind, key, votes, voters })),
    });
  }

  return probes
    .sort((a, b) => b.entropy - a.entropy || a.priority - b.priority)
    .slice(0, max);
}

/**
 * A draft that keeps the form as it is — what the committee is compared
 * against, and a fallback member when a draft call fails.
 */
export function currentAsCandidate(schema: PortfolioSchema): CandidateDesign {
  return { fields: schema.fields.map((f: Field) => patchFieldFromField(f)) };
}
