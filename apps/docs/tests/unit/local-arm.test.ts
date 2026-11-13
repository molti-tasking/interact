// @vitest-environment node
/**
 * `arm=<condition>` on a study link picks the arm — on the authors' machine
 * only. In production it is ignored, whatever else is set. (The database
 * has a gate of its own: `force_my_study_arm` does nothing without
 * `study_local_mode`; see study-local-arm.integration.test.ts.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { armFromLink, forcedArmAllowed } from "@/lib/study/local-arm";

describe("forcedArmAllowed", () => {
  it("is never allowed in production", () => {
    expect(forcedArmAllowed({ NODE_ENV: "production", STUDY_LOCAL: "1" })).toBe(false);
    expect(forcedArmAllowed({ NODE_ENV: "production", STUDY_LOCAL: " 1 " })).toBe(false);
    expect(forcedArmAllowed({ NODE_ENV: "production" })).toBe(false);
  });

  it("needs STUDY_LOCAL=1 outside production too", () => {
    expect(forcedArmAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(forcedArmAllowed({ NODE_ENV: "development", STUDY_LOCAL: "0" })).toBe(false);
    expect(forcedArmAllowed({ NODE_ENV: "development", STUDY_LOCAL: "true" })).toBe(false);
    expect(forcedArmAllowed({ NODE_ENV: "development", STUDY_LOCAL: "1" })).toBe(true);
    expect(forcedArmAllowed({ NODE_ENV: "test", STUDY_LOCAL: "1" })).toBe(true);
  });
});

describe("armFromLink", () => {
  it("accepts the condition ids only", () => {
    expect(armFromLink("assistant")).toBe("assistant");
    expect(armFromLink(" Baseline ")).toBe("baseline");
    expect(armFromLink("no-probes")).toBe("no-probes");
    expect(armFromLink("full")).toBe("full");
    expect(armFromLink("chatgpt")).toBeNull();
    expect(armFromLink("")).toBeNull();
    expect(armFromLink(null)).toBeNull();
  });
});

describe("GET /api/study/local-arm", () => {
  afterEach(() => vi.unstubAllEnvs());

  const ask = async () => {
    const { GET } = await import("@/app/api/study/local-arm/route");
    return (await (await GET()).json()) as { allowed: boolean };
  };

  it("says no in production even with STUDY_LOCAL=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("STUDY_LOCAL", "1");
    expect(await ask()).toEqual({ allowed: false });
  });

  it("says yes on a local machine with STUDY_LOCAL=1", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STUDY_LOCAL", "1");
    expect(await ask()).toEqual({ allowed: true });
  });

  it("says no on a local machine without STUDY_LOCAL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STUDY_LOCAL", "");
    expect(await ask()).toEqual({ allowed: false });
  });
});
