/**
 * What a participant is told about their arm's tool, kept to a minimum: one
 * line at the first description (people who don't know that a draft comes
 * right away tend to write a long specification first) and one coach mark
 * once the form is there.
 *
 * Matched across arms (tests/unit/study-arm-copy.test.ts): the same sentence
 * frames, only the arm's own controls differ. It says what is possible,
 * never how to go about it.
 */

export type StudyArm = "full" | "no-probes" | "baseline" | "assistant";

/** The arm a participant's workspace capabilities stand for. */
export function armOf(caps: {
  assistantChat: boolean;
  chatEdits: boolean;
  designProbes: boolean;
}): StudyArm {
  if (caps.assistantChat) return "assistant";
  if (caps.chatEdits) return "baseline";
  return caps.designProbes ? "full" : "no-probes";
}

/**
 * The one coach mark, when the form is there: the arm's ways to improve it,
 * in one sentence with the same ending in every arm.
 */
export const IMPROVE_THE_FORM: Record<StudyArm, string> = {
  full: "Answer the tool’s questions, change your description, or edit the form directly.",
  "no-probes": "Change your description, or edit the form directly.",
  baseline: "Write what to change, or edit the form directly.",
  assistant: "Write to the assistant, or edit the form directly.",
};

/**
 * At the first description: under the text box ("Describe the form"), or,
 * in the assistant arm, in the empty chat.
 */
export const FIRST_DESCRIPTION_HINT: Record<StudyArm, string> = {
  full: "Rough is fine: the tool drafts a form from it right away, and you improve it afterwards.",
  "no-probes":
    "Rough is fine: the tool drafts a form from it right away, and you improve it afterwards.",
  baseline:
    "Rough is fine: the tool drafts a form from it right away, and you improve it afterwards.",
  assistant:
    "Rough is fine: the assistant answers right away and can build the form next to this chat, and you improve it afterwards.",
};
