import { describe, expect, it, vi } from "vitest";
import { llmErrorMessage } from "@/lib/model";

describe("llmErrorMessage", () => {
  it("turns a gateway budget error into a plain sentence and logs it loudly", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const message = llmErrorMessage(
      new Error("ExceededBudget: User=685a over budget. Spend=10.01, Budget=10.0"),
    );
    expect(message).toMatch(/usage limit/);
    expect(message).not.toMatch(/685a/);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[LLM BUDGET]"), expect.any(String));
    spy.mockRestore();
  });

  it("names timeouts and keeps other messages", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(llmErrorMessage(timeout)).toMatch(/too long/);
    expect(llmErrorMessage(new Error("No structured output"))).toBe("No structured output");
    expect(llmErrorMessage(undefined)).toBe("Unknown error");
  });
});

describe("llmErrorMessage with SDK retries", () => {
  it("looks at the last attempt's error", async () => {
    const { RetryError } = await import("ai");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new RetryError({
      message: "Failed after 3 attempts",
      reason: "maxRetriesExceeded",
      errors: [new Error("ExceededBudget: over budget")],
    });
    expect(llmErrorMessage(err)).toMatch(/usage limit/);
    spy.mockRestore();
  });
});
