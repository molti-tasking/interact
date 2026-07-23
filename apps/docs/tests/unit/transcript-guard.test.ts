import { describe, expect, it } from "vitest";
import { assessTranscript } from "@/lib/voice/transcript-guard";

const CAKE_HALLUCINATION =
  "Hello everyone, welcome to my channel. Today I will show you how to make a simple and easy cake. " +
  "Please subscribe to the channel and press the bell icon to receive notifications when I upload a new video. ".repeat(
    8,
  );

describe("assessTranscript", () => {
  it("rejects the classic looping YouTube-caption hallucination", () => {
    const result = assessTranscript(CAKE_HALLUCINATION, 4);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("repetition-loop");
  });

  it("rejects text far longer than the clip duration allows", () => {
    const longText = Array.from(
      { length: 40 },
      (_, i) => `This is a completely distinct sentence number ${i}.`,
    ).join(" ");
    const result = assessTranscript(longText, 3);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("length-implausible");
  });

  it("accepts normal speech, including non-English", () => {
    const result = assessTranscript(
      "ich gehe gerade durch mein Lager und sortiere meine Kisten ein",
      5,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toContain("Lager");
  });

  it("accepts a naturally repeated sentence without flagging", () => {
    const result = assessTranscript(
      "Add a quantity field. Add a quantity field. And also a color field.",
      6,
    );
    expect(result.ok).toBe(true);
  });

  it("collapses consecutive duplicates in accepted text", () => {
    const result = assessTranscript(
      "Add a quantity field. Add a quantity field. And also a color field.",
      6,
    );
    expect(result.text).toBe("Add a quantity field. And also a color field.");
  });

  it("rejects empty transcripts", () => {
    expect(assessTranscript("   ", 2).ok).toBe(false);
  });
});
