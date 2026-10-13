/**
 * Pure helpers for keeping the design probe deck small and current.
 *
 * Answers, field edits and intent refinements change the form, so open
 * probes go stale: they ask about something already decided, duplicate a
 * follow-up, or no longer fit the purpose. A curation pass has the LLM
 * review every open probe (keep/drop + priority) and propose new ones;
 * `planProbeCuration` turns that review into a bounded deck.
 */

import type { Field, PortfolioSchema, ProbePriority } from "../types";
import { hashSection } from "./structured-intent";

/** Open design probes the deck aims for; curation retires the rest. */
export const MAX_OPEN_PROBES = 6;

export interface ProbeReview {
  keep: boolean;
  priority: ProbePriority;
}

export interface CurationPlan<T> {
  /** Ids of open probes to retire */
  drop: string[];
  /** New priorities of kept probes whose priority changed */
  priorities: Record<string, ProbePriority>;
  /** New probes to add */
  add: T[];
}

type Candidate<T> =
  | { kind: "open"; id: string; priority: ProbePriority; was: ProbePriority; order: number }
  | { kind: "new"; probe: T; priority: ProbePriority; order: number };

/**
 * Decide the deck after a review. Kept and new probes compete for `maxOpen`
 * slots by priority — kept ones win ties, so the deck doesn't churn — and
 * kept probes that don't fit are dropped too. Open probes the review
 * skipped are kept as they were. `open` must be in deck order (most
 * important first).
 */
export function planProbeCuration<T extends { priority: ProbePriority }>(
  open: readonly { id: string; priority: ProbePriority }[],
  reviews: ReadonlyMap<string, ProbeReview>,
  added: readonly T[],
  maxOpen: number,
): CurationPlan<T> {
  const drop: string[] = [];
  const priorities: Record<string, ProbePriority> = {};
  const candidates: Candidate<T>[] = [];

  open.forEach((probe, order) => {
    const review = reviews.get(probe.id);
    if (review && !review.keep) {
      drop.push(probe.id);
      return;
    }
    candidates.push({
      kind: "open",
      id: probe.id,
      priority: review?.priority ?? probe.priority,
      was: probe.priority,
      order,
    });
  });
  added.forEach((probe, i) =>
    candidates.push({
      kind: "new",
      probe,
      priority: probe.priority,
      order: open.length + i,
    }),
  );

  candidates.sort((a, b) => a.priority - b.priority || a.order - b.order);

  const add: T[] = [];
  candidates.forEach((candidate, rank) => {
    const fits = rank < maxOpen;
    if (candidate.kind === "new") {
      if (fits) add.push(candidate.probe);
    } else if (!fits) {
      drop.push(candidate.id);
    } else if (candidate.priority !== candidate.was) {
      priorities[candidate.id] = candidate.priority;
    }
  });

  return { drop, priorities, add };
}

function fieldFingerprint(f: Field): unknown[] {
  return [
    f.name,
    f.label,
    f.type.kind,
    f.required,
    f.type.kind === "select" ? f.type.options.map((o) => o.label) : null,
  ];
}

/**
 * Changes when the form changes in a way open probes could depend on
 * (fields, labels, kinds, options, required) — not on help text or ids.
 */
export function schemaFingerprint(schema: PortfolioSchema): string {
  return hashSection(JSON.stringify(schema.fields.map(fieldFingerprint)));
}
