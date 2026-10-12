import { describe, expect, it } from "vitest";
import {
  resolveTemperature,
  supportsCustomTemperature,
} from "@/lib/llm-temperature";

describe("supportsCustomTemperature", () => {
  it.each([
    "anthropic/claude-sonnet-5",
    "claude-opus-5-5",
    "claude-haiku-5-5",
    "claude-fable-5-1",
    "openai/o3",
    "o4-mini",
    "openai/gpt-5",
  ])("%s only accepts the default temperature", (id) => {
    expect(supportsCustomTemperature(id)).toBe(false);
  });

  it.each([
    "anthropic/claude-sonnet-4-5",
    "claude-3-7-sonnet",
    "natai/glm-max",
    "gpt-4o",
    "default",
    "openai/gpt-4.1",
  ])("%s accepts a custom temperature", (id) => {
    expect(supportsCustomTemperature(id)).toBe(true);
  });
});

describe("resolveTemperature", () => {
  it("keeps the requested value for models that support it", () => {
    expect(resolveTemperature("natai/glm-max", 0.3, undefined)).toBe(0.3);
  });

  it("drops it for fixed-temperature models", () => {
    expect(resolveTemperature("anthropic/claude-sonnet-5", 0.3, undefined)).toBeUndefined();
  });

  it("LLM_TEMPERATURE=off never sends one", () => {
    expect(resolveTemperature("natai/glm-max", 0.3, "off")).toBeUndefined();
  });

  it("LLM_TEMPERATURE=<number> overrides every call", () => {
    expect(resolveTemperature("anthropic/claude-sonnet-5", 0.3, "1")).toBe(1);
  });

  it("auto and unparseable values fall back to detection", () => {
    expect(resolveTemperature("natai/glm-max", 0.2, "auto")).toBe(0.2);
    expect(resolveTemperature("natai/glm-max", 0.2, "warm")).toBe(0.2);
  });

  it("leaves an unset temperature unset", () => {
    expect(resolveTemperature("natai/glm-max", undefined, undefined)).toBeUndefined();
  });
});
