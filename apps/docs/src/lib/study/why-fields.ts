/**
 * "Why does your form ask this?" — which fields of a participant's final
 * form the question is asked about, after each task.
 *
 * - Wave 1: two fields the system created and one the participant created
 *   (`origin: "creator"`, e.g. "Add field"); when one kind runs short, the
 *   other fills in.
 * - Wave 2: fields inherited from the form the participant took over
 *   first, then the rest as in wave 1.
 *
 * Deterministic per `seed` (participant and task), so a reload asks about
 * the same fields. The origin is stored with the answer for the analysis
 * and never shown.
 */

export type WhyOrigin = "system" | "participant" | "inherited";

export interface WhyItem {
  fieldId: string;
  label: string;
  origin: WhyOrigin;
}

export const WHY_ITEM_COUNT = 3;

interface FieldLike {
  id: string;
  label: string;
  origin?: string;
}

export function chooseWhyFields(
  fields: readonly FieldLike[],
  opts: {
    seed: string;
    shuffle: <T>(items: readonly T[], seed: string) => T[];
    /** Wave 2: ids of the fields the taken-over form already had */
    inherited?: readonly string[];
    count?: number;
  },
): WhyItem[] {
  const count = opts.count ?? WHY_ITEM_COUNT;
  const inherited = new Set(opts.inherited ?? []);
  const items = fields
    .filter((f) => f.label.trim())
    .map(
      (f): WhyItem => ({
        fieldId: f.id,
        label: f.label.trim(),
        origin: inherited.has(f.id) ? "inherited" : f.origin === "creator" ? "participant" : "system",
      }),
    );
  const of = (origin: WhyOrigin) =>
    opts.shuffle(
      items.filter((item) => item.origin === origin),
      `${opts.seed}:${origin}`,
    );
  const fromInherited = of("inherited");
  const fromSystem = of("system");
  const fromParticipant = of("participant");

  const chosen: WhyItem[] = [];
  const take = (pool: WhyItem[], n: number) => {
    while (n-- > 0 && pool.length > 0 && chosen.length < count) chosen.push(pool.shift()!);
  };
  take(fromInherited, count);
  // Two of the system's and one of the participant's, then whatever is left
  const missing = count - chosen.length;
  const own = Math.min(fromParticipant.length, Math.max(0, missing - 2), 1);
  take(fromSystem, missing - own);
  take(fromParticipant, count);
  take(fromSystem, count);
  // Not always the participant's own field last
  return opts.shuffle(chosen, `${opts.seed}:order`);
}
