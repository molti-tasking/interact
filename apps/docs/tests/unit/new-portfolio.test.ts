import { describe, expect, it } from "vitest";
import {
  deriveTitleFromIntent,
  EXAMPLE_INTENTS,
  MAX_TITLE_LENGTH,
} from "@/lib/new-portfolio";

describe("deriveTitleFromIntent", () => {
  it("uses the first sentence without the conversational lead-in", () => {
    expect(
      deriveTitleFromIntent(
        "I need a registration form for our soccer club. Parents sign up kids.",
      ),
    ).toBe("Registration form for our soccer club");
  });

  it("handles 'we would like to collect' phrasing", () => {
    expect(deriveTitleFromIntent("We would like to collect feedback after workshops!")).toBe(
      "Feedback after workshops",
    );
  });

  it("keeps the sentence when there is no lead-in", () => {
    expect(deriveTitleFromIntent("Patient intake for the orthopedic clinic")).toBe(
      "Patient intake for the orthopedic clinic",
    );
  });

  it("uses the first non-empty line", () => {
    expect(deriveTitleFromIntent("\n\n  quarterly business review\nmore details")).toBe(
      "Quarterly business review",
    );
  });

  it("truncates at a word boundary with an ellipsis", () => {
    const title = deriveTitleFromIntent(
      "A very long description of an elaborate multi-step onboarding questionnaire for new employees across departments",
    );
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.endsWith("…")).toBe(true);
    expect(title).not.toMatch(/\s…$/);
  });

  it("returns a placeholder for empty input", () => {
    expect(deriveTitleFromIntent("   ")).toBe("Untitled portfolio");
  });

  it("derives reasonable titles for all example prompts", () => {
    for (const example of EXAMPLE_INTENTS) {
      const title = deriveTitleFromIntent(example.text);
      expect(title.length).toBeGreaterThan(5);
      expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
      expect(title[0]).toBe(title[0].toUpperCase());
    }
  });
});
