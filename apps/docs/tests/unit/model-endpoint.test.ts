import { describe, expect, it } from "vitest";
import { fastModel, model } from "@/lib/model";

// LiteLLM's emulation of OpenAI's Responses API breaks on Claude's thinking
// output ("Invalid JSON response"), so the app must use Chat Completions.
describe("LLM endpoint", () => {
  it.each([
    ["model", model],
    ["fastModel", fastModel],
  ])("%s uses the Chat Completions API", (_name, m) => {
    expect((m as { provider: string }).provider).toBe("openai.chat");
  });
});
