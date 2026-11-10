/**
 * The briefs of the panel study, as far as a participant's browser may know
 * them: a key, a neutral label and the quiz foils. The situation texts and
 * the requirement lists are in `briefs.server.ts` and never reach a
 * participant as text (the brief is shown as an image).
 */

export interface BriefMeta {
  key: string;
  /** What the organisation is, for headings ("a form for …") */
  label: string;
  /**
   * Quiz foils: things a form like this could plausibly ask but that the
   * situation gives no reason for. Shown next to the participant's own
   * questions in "Does your form ask for this?".
   */
  foils: string[];
  /**
   * Wave 2: this brief continues another one — the participant takes over
   * a form built for that one and adapts it.
   */
  variantOf?: string;
}

export const BRIEFS: Record<string, BriefMeta> = {
  camp: {
    key: "camp",
    label: "the football club",
    foils: [
      "The child's school",
      "The child's shoe size",
      "How the family heard about the camp",
      "The parent's occupation",
      "The child's favourite football team",
    ],
  },
  foster: {
    key: "foster",
    label: "the cat rescue",
    foils: [
      "The applicant's date of birth",
      "The applicant's occupation",
      "The applicant's favourite cat breed",
      "How the applicant heard about the rescue",
      "The applicant's social media profile",
    ],
  },
};

// Wave 2 (handoff): the same organisations a year on
BRIEFS["camp-2"] = {
  key: "camp-2",
  label: "the football club",
  foils: BRIEFS.camp.foils,
  variantOf: "camp",
};
BRIEFS["foster-2"] = {
  key: "foster-2",
  label: "the animal rescue",
  foils: BRIEFS.foster.foils,
  variantOf: "foster",
};

/** Briefs a participant starts from nothing (wave 1) */
export const BRIEF_KEYS = Object.keys(BRIEFS).filter((key) => !BRIEFS[key].variantOf);
/** Briefs that continue a wave-1 brief (wave 2) */
export const VARIANT_BRIEF_KEYS = Object.keys(BRIEFS).filter((key) => !!BRIEFS[key].variantOf);

export function briefImageUrl(key: string): string {
  return `/api/study/brief/${encodeURIComponent(key)}`;
}
