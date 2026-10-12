import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { requireOwner, UnauthorizedError } from "@/lib/auth";
import { guardLlmRequest, LlmUnauthorizedError } from "@/lib/llm-guard";

describe("guardLlmRequest", () => {
  it("rejects callers that aren't a signed-in admin", async () => {
    vi.mocked(requireOwner).mockRejectedValueOnce(
      new UnauthorizedError("This account has no access."),
    );
    await expect(guardLlmRequest()).rejects.toBeInstanceOf(
      LlmUnauthorizedError,
    );
  });

  it("lets admins through", async () => {
    await expect(guardLlmRequest("auth-guard-test")).resolves.toBeUndefined();
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
