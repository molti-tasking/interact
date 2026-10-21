import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { requireDesigner, UnauthorizedError } from "@/lib/auth";
import {
  checkRateLimit,
  guardLlmRequest,
  LlmGuardError,
  LlmUnauthorizedError,
} from "@/lib/llm-guard";

describe("guardLlmRequest", () => {
  it("rejects callers that aren't an admin or a workshop participant", async () => {
    vi.mocked(requireDesigner).mockRejectedValueOnce(
      new UnauthorizedError("This account has no access."),
    );
    await expect(guardLlmRequest()).rejects.toBeInstanceOf(
      LlmUnauthorizedError,
    );
  });

  it("rejects signed-out callers", async () => {
    vi.mocked(requireDesigner).mockRejectedValueOnce(new UnauthorizedError());
    await expect(guardLlmRequest()).rejects.toBeInstanceOf(
      LlmUnauthorizedError,
    );
  });

  it("lets admins through", async () => {
    await expect(guardLlmRequest("auth-guard-test")).resolves.toBeUndefined();
  });

  it("lets workshop participants through", async () => {
    vi.mocked(requireDesigner).mockResolvedValueOnce({
      userId: "participant-1",
      kind: "participant",
    });
    await expect(guardLlmRequest("auth-guard-test")).resolves.toBeUndefined();
  });
});

describe("checkRateLimit", () => {
  // A workshop room shares one NAT IP: the limit must be per user.
  it("keys the limit per user, not per IP", async () => {
    const max = Number(process.env.LLM_RATE_LIMIT_PER_MIN) || 60;
    for (let i = 0; i < max; i++) {
      await checkRateLimit("rate-limit-test", "user-a");
    }
    await expect(
      checkRateLimit("rate-limit-test", "user-a"),
    ).rejects.toBeInstanceOf(LlmGuardError);
    await expect(
      checkRateLimit("rate-limit-test", "user-b"),
    ).resolves.toBeUndefined();
  });
});

describe("server actions", () => {
  // Actions are callable by POSTing their id to any path, including the
  // public form — so each one must check auth itself.
  const dir = path.resolve(__dirname, "../../src/app/actions");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it.each(files)("%s guards every exported action", (file) => {
    const source = fs.readFileSync(path.join(dir, file), "utf-8");
    const chunks = source.split(/^export async function /m).slice(1);
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      const name = chunk.slice(0, chunk.indexOf("("));
      expect(chunk, `${name} must call guardLlmRequest()`).toContain(
        "guardLlmRequest(",
      );
    }
  });
});
