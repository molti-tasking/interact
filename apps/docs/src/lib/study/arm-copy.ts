/**
 * What a participant is told about their arm's tool before they use it:
 * on the intro page (untimed, before the first situation) and at the first
 * description. People who don't know that a draft comes right away tend to
 * write a long specification first; so every arm hears, in the same words,
 * that a rough description is enough and what happens after it.
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

/** "How the tool works", on the intro page: three steps per arm. */
export const HOW_IT_WORKS: Record<StudyArm, [string, string, string]> = {
  full: [
    "You tell the tool in a few words what form is needed. Rough is fine.",
    "The tool drafts a form from it right away.",
    "You improve the form: answer the tool’s questions about it, change your description, or edit the fields directly.",
  ],
  "no-probes": [
    "You tell the tool in a few words what form is needed. Rough is fine.",
    "The tool drafts a form from it right away.",
    "You improve the form: change your description, or edit the fields directly.",
  ],
  baseline: [
    "You tell the tool in a few words what form is needed. Rough is fine.",
    "The tool drafts a form from it right away.",
    "You improve the form: write what to change, or edit the fields directly.",
  ],
  assistant: [
    "You tell the assistant in a few words what form is needed. Rough is fine.",
    "The assistant answers right away and can build the form next to the chat.",
    "You improve the form: keep writing to the assistant, or edit the fields directly.",
  ],
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
