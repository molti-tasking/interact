/**
 * No change without a decision.
 *
 * The form (its fields, sections and accepted standards) changes only as the
 * consequence of something the creator did, and that change is recorded with
 * who decided and why. Every write of a form states what triggered it
 * (`CommitTrigger`); `checkCommit` refuses a write that would change the
 * form without a creator's action or without an actor and rationale.
 *
 * Background work — curating the open questions, detecting conflicts,
 * findings from responses, keeping the intent text in step — declares
 * "background". It may write the intent text or nothing; it can never write
 * the form.
 */

import type { PortfolioSchema } from "./types";

/** Things a creator does that may change the form. */
export const CREATOR_TRIGGERS = [
  /** Answered an elicitation question, accepted a standard, chose a fix */
  "answer",
  /** Wrote or edited the intent (the first description included) */
  "intent-edit",
  /** Edited the form directly: a field, a section, a response column */
  "field-edit",
  /** Asked for a change in words: typed or spoken */
  "request",
  /** Undid a change or restored an earlier state */
  "undo",
  /** Derived a form from another one */
  "derive",
] as const;

export type CreatorTrigger = (typeof CREATOR_TRIGGERS)[number];
export type CommitTrigger = CreatorTrigger | "background";

export function isCreatorTrigger(trigger: unknown): trigger is CreatorTrigger {
  return (CREATOR_TRIGGERS as readonly unknown[]).includes(trigger);
}

/** Actors that are not a person. */
const NON_CREATOR_ACTORS = new Set(["", "system", "ai", "llm", "model"]);

/**
 * The part of a schema that is the form: what respondents are asked and
 * how. `version` is a counter; `dashboard` and `columnActions` belong to
 * the response view and `assist` switches respondent help on — none of them
 * is a question, a section or an accepted standard.
 */
export function formContent(schema: PortfolioSchema): unknown {
  const { version, dashboard, assist, columnActions, ...form } = schema;
  void version;
  void dashboard;
  void assist;
  void columnActions;
  return form;
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

/** Would writing `next` change the form? */
export function formChanged(current: PortfolioSchema, next: PortfolioSchema): boolean {
  return stable(formContent(current)) !== stable(formContent(next));
}

export interface CommitCheck {
  trigger: CommitTrigger | undefined;
  /** The write would change the form (`formChanged`) */
  formChanged: boolean;
  provenance?: { actor?: string | null; rationale?: string | null } | null;
}

export type CommitVerdict = { ok: true } | { ok: false; reason: string };

/**
 * May this write go through? A write that leaves the form as it is always
 * may. One that changes it needs a creator's action as its trigger, and a
 * provenance entry naming a person and giving a rationale.
 */
export function checkCommit(check: CommitCheck): CommitVerdict {
  if (!check.formChanged) return { ok: true };
  if (!isCreatorTrigger(check.trigger)) {
    return {
      ok: false,
      reason: `a form change needs a creator's action, not "${check.trigger ?? "nothing"}"`,
    };
  }
  const actor = check.provenance?.actor?.trim() ?? "";
  if (!check.provenance || NON_CREATOR_ACTORS.has(actor.toLowerCase())) {
    return { ok: false, reason: "a form change must be recorded with the person who decided it" };
  }
  if (!check.provenance.rationale?.trim()) {
    return { ok: false, reason: "a form change must be recorded with its rationale" };
  }
  return { ok: true };
}

export class UndecidedChangeError extends Error {
  constructor(reason: string) {
    super(`Refused to change the form: ${reason}.`);
    this.name = "UndecidedChangeError";
  }
}
