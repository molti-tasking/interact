import { APICallError, RetryError } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";

const recordFixture = vi.hoisted(() => vi.fn());
const loadFixture = vi.hoisted(() => vi.fn());

vi.mock("@/lib/testing/fixture-recorder", () => ({ recordFixture }));
vi.mock("@/lib/testing/fixture-loader", () => ({ loadFixture }));

import { isTransientLlmError } from "@/lib/model";
import { telemetry } from "@/lib/telemetry";
import { fixtureGuard } from "@/lib/testing/fixture-guard";

afterEach(() => {
  vi.unstubAllEnvs();
  recordFixture.mockReset();
  loadFixture.mockReset();
});

describe("fixtureGuard", () => {
  it("always calls the real function in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("USE_FIXTURES", "true");
    vi.stubEnv("RECORD_FIXTURES", "true");
    const real = vi.fn().mockResolvedValue("real");
    await expect(fixtureGuard("action", {}, real)).resolves.toBe("real");
    expect(loadFixture).not.toHaveBeenCalled();
    expect(recordFixture).not.toHaveBeenCalled();
  });

  it("replays fixtures outside production", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("USE_FIXTURES", "true");
    loadFixture.mockReturnValue("fixture");
    const real = vi.fn();
    await expect(fixtureGuard("action", {}, real)).resolves.toBe("fixture");
    expect(real).not.toHaveBeenCalled();
  });

  it("returns the real result when recording fails (e.g. read-only FS)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RECORD_FIXTURES", "true");
    recordFixture.mockImplementation(() => {
      throw Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      fixtureGuard("action", {}, async () => "real"),
    ).resolves.toBe("real");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("telemetry", () => {
  it("records prompts/outputs outside production by default", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(telemetry("x")).toEqual({
      isEnabled: true,
      functionId: "x",
      recordInputs: true,
      recordOutputs: true,
    });
  });

  it("does not record prompts/outputs in production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(telemetry("x")).toMatchObject({
      recordInputs: false,
      recordOutputs: false,
    });
  });

  it("TELEMETRY_RECORD_IO overrides the default", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TELEMETRY_RECORD_IO", "true");
    expect(telemetry("x").recordInputs).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TELEMETRY_RECORD_IO", "false");
    expect(telemetry("x").recordOutputs).toBe(false);
  });
});

describe("isTransientLlmError", () => {
  const apiError = (statusCode: number) =>
    new APICallError({
      message: String(statusCode),
      url: "http://llm",
      requestBodyValues: {},
      statusCode,
    });

  it.each([408, 429, 500, 503])("retries HTTP %i", (status) => {
    expect(isTransientLlmError(apiError(status))).toBe(true);
  });

  it.each([400, 401, 404, 422])("does not retry HTTP %i", (status) => {
    expect(isTransientLlmError(apiError(status))).toBe(false);
  });

  it("retries timeouts and network failures", () => {
    expect(isTransientLlmError(new DOMException("timeout", "TimeoutError"))).toBe(true);
    expect(
      isTransientLlmError(
        Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ECONNRESET" },
        }),
      ),
    ).toBe(true);
  });

  it("unwraps the SDK's RetryError", () => {
    const wrapped = new RetryError({
      message: "failed",
      reason: "maxRetriesExceeded",
      errors: [apiError(503)],
    });
    expect(isTransientLlmError(wrapped)).toBe(true);
  });

  it("does not retry validation or guard errors", () => {
    expect(isTransientLlmError(new Error("Intent is too long"))).toBe(false);
    expect(isTransientLlmError("nope")).toBe(false);
  });
});
