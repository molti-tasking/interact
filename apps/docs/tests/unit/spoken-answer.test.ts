import {
  matchSpokenAnswer,
  normalizeSpoken,
  type VoiceQuestion,
} from "@/lib/voice/spoken-answer";
import { describe, expect, it } from "vitest";

const question: VoiceQuestion = {
  id: "p1",
  text: "Include nutrition tracking?",
  options: [
    { value: "yesDaily", label: "Yes, daily log" },
    { value: "weekly", label: "Weekly summary" },
    { value: "no", label: "No, skip nutrition" },
  ],
  allowCustom: true,
};

describe("normalizeSpoken", () => {
  it("drops punctuation, case and filler", () => {
    expect(normalizeSpoken("Um, okay — the Second one, please.")).toBe("the second one");
    expect(normalizeSpoken("  Weekly summary!  ")).toBe("weekly summary");
  });
});

describe("matchSpokenAnswer", () => {
  it("matches an option label read out", () => {
    expect(matchSpokenAnswer("Weekly summary.", question)).toEqual({
      action: "option",
      value: "weekly",
    });
  });

  it("matches ordinals, including 'the last one'", () => {
    expect(matchSpokenAnswer("The first one", question)).toEqual({ action: "option", value: "yesDaily" });
    expect(matchSpokenAnswer("option 2", question)).toEqual({ action: "option", value: "weekly" });
    expect(matchSpokenAnswer("the last one", question)).toEqual({ action: "option", value: "no" });
    expect(matchSpokenAnswer("the fourth one", question)).toBeNull();
  });

  it("maps yes/no only when exactly one option starts with it", () => {
    expect(matchSpokenAnswer("Yeah.", question)).toEqual({ action: "option", value: "yesDaily" });
    expect(matchSpokenAnswer("Nope", question)).toEqual({ action: "option", value: "no" });
    const ambiguous: VoiceQuestion = {
      ...question,
      options: [
        { value: "a", label: "Yes, daily" },
        { value: "b", label: "Yes, weekly" },
      ],
    };
    expect(matchSpokenAnswer("yes", ambiguous)).toBeNull();
  });

  it("recognizes skipping", () => {
    expect(matchSpokenAnswer("Skip this one.", question)).toEqual({ action: "skip" });
    expect(matchSpokenAnswer("next question", question)).toEqual({ action: "skip" });
  });

  it("leaves anything else to the LLM", () => {
    expect(matchSpokenAnswer("I think a weekly summary would be enough", question)).toBeNull();
    expect(matchSpokenAnswer("hmm", question)).toBeNull();
    expect(matchSpokenAnswer("", question)).toBeNull();
  });
});
