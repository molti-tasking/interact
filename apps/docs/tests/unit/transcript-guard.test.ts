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

  it("keeps repeated sentences verbatim (they can be separate records)", () => {
    const result = assessTranscript(
      "One hoodie. One hoodie. And also a blue beanie.",
      6,
    );
    expect(result.ok).toBe(true);
    expect(result.text).toBe("One hoodie. One hoodie. And also a blue beanie.");
  });

  it("rejects empty transcripts", () => {
    expect(assessTranscript("   ", 2).ok).toBe(false);
    expect(assessTranscript(" ... ", 2).reason).toBe("empty");
  });

  describe("short repeated sentences", () => {
    it("ignores filler repeated many times", () => {
      const result = assessTranscript(
        "Okay. Okay. Okay. Okay. Add a size field to the form.",
        8,
      );
      expect(result.ok).toBe(true);
    });

    it("accepts the same short record dictated four times", () => {
      const result = assessTranscript(
        "One hoodie. One hoodie. One hoodie. One hoodie.",
        6,
      );
      expect(result.ok).toBe(true);
      expect(result.text).toBe("One hoodie. One hoodie. One hoodie. One hoodie.");
    });

    it("accepts a long batch recording with a repeated record among other speech", () => {
      const text = [
        "One blue hoodie in size M.",
        "Two black t-shirts, both used.",
        "One blue hoodie in size M.",
        "A red beanie that is like new.",
        "One blue hoodie in size M.",
        "Three pairs of socks, still in the package.",
        "One blue hoodie in size M.",
        "A green scarf with a small hole.",
        "Two pairs of jeans in size 32.",
        "A grey sweater, slightly worn.",
      ].join(" ");
      expect(assessTranscript(text, 60).ok).toBe(true);
    });
  });

  describe("stock hallucination phrases", () => {
    it.each([
      "Thank you.",
      "Thanks for watching!",
      "Thank you for watching.",
      "you",
      "Subtitles by the Amara.org community",
      "Untertitel im Auftrag des ZDF für funk, 2017",
      "Thank you. Thank you.",
    ])("rejects a transcript that is only %j", (text) => {
      const result = assessTranscript(text, 1.5);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("hallucination-phrase");
    });

    it("keeps the phrase inside real speech", () => {
      const result = assessTranscript(
        "Thank you. Now add a field for the delivery date.",
        5,
      );
      expect(result.ok).toBe(true);
    });
  });

  it("rejects an unpunctuated word loop", () => {
    const result = assessTranscript("thank you ".repeat(12), 10);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("repetition-loop");
  });

  it("uses the share of repeated text, not an absolute count", () => {
    const loop = "I am going to show you how to bake this cake. ".repeat(3);
    expect(assessTranscript(loop, 10).reason).toBe("repetition-loop");
  });
});
