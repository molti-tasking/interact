/**
 * Integration test for optimistic-concurrency commits against the local
 * Supabase stack (`npx supabase start` + migrations ≥ 007). Skipped when the
 * local API isn't reachable or isn't this project's (tests/README.md, "An
 * isolated stack").
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../db";

function loadEnvLocal() {
  const file = path.resolve(__dirname, "../../.env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const m = line.match(/^\s*(NEXT_PUBLIC_SUPABASE_[A-Z_]+)\s*=\s*"?([^"\n]*)"?/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);

/**
 * Reachable, and this project's schema: Supabase's default ports may be
 * held by another project's stack, which these tests must leave alone.
 */
async function reachable(): Promise<boolean> {
  if (!isLocal) return false;
  try {
    const res = await fetch(`${url}/rest/v1/design_probes?limit=0`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

const available = await reachable();

describe.runIf(available)("commitPortfolioChange (local Supabase)", () => {
  let portfolioId: string;
  let adminId: string;

  beforeAll(async () => {
    const { createClient } = await import("@/lib/supabase/client");
    // The workspace is for signed-in admins since migration 010: sign in as
    // one (the browser client keeps the session for the calls below)
    const email = `commit-admin-${Date.now().toString(36)}@test.local`;
    const password = "commit-admin-password";
    const signUp = await createClient().auth.signUp({ email, password });
    if (signUp.error) throw signUp.error;
    adminId = signUp.data.user!.id;
    await sql("INSERT INTO app_admins (user_id) VALUES ($1)", [adminId]);
    if (!signUp.data.session) {
      const signIn = await createClient().auth.signInWithPassword({ email, password });
      if (signIn.error) throw signIn.error;
    }

    const { data, error } = await createClient()
      .from("portfolios")
      .insert({
        title: "__commit_integration_test__",
        intent: {
          purpose: { content: "p", updatedAt: "t" },
          audience: { content: "", updatedAt: "t" },
          exclusions: { content: "", updatedAt: "t" },
          constraints: { content: "", updatedAt: "t" },
        },
        schema: { fields: [], groups: [], version: 1 },
      })
      .select()
      .single();
    if (error) throw error;
    portfolioId = data.id;
  });

  afterAll(async () => {
    if (!portfolioId) return;
    const { createClient } = await import("@/lib/supabase/client");
    await createClient().from("portfolios").delete().eq("id", portfolioId);
    await sql("DELETE FROM auth.users WHERE id = $1", [adminId]);
  });

  it("lands concurrent changes from the same snapshot without losing either", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    const { addField } = await import("interact/forms/schema-ops");

    const mk = (id: string) => ({
      id,
      name: id,
      label: id,
      type: { kind: "text" as const },
      required: false,
      constraints: [],
      origin: "system" as const,
      tags: [],
    });

    const results = await Promise.all(
      ["first", "second", "third"].map((name) =>
        commitPortfolioChange(portfolioId, (current) => ({
          trigger: "field-edit",
          schema: addField(current.schema, mk(name)),
          provenance: {
            layer: "configuration",
            action: "test_add",
            actor: "test",
            rationale: `Added ${name}`,
          },
        })),
      ),
    );

    const final = results
      .map((r) => r!.portfolio)
      .sort((a, b) => b.revision - a.revision)[0];
    expect(final.schema.fields.map((f) => f.name).sort()).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(final.field_count).toBe(3);

    // One provenance row per commit, written atomically with the change
    const { createClient } = await import("@/lib/supabase/client");
    const { data } = await createClient()
      .from("provenance_log")
      .select("action, prev_schema")
      .eq("portfolio_id", portfolioId);
    expect(data).toHaveLength(3);
  });

  it("aborts without writing when the change function returns null", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    const result = await commitPortfolioChange(portfolioId, () => null);
    expect(result).toBeNull();
  });

  it("stores the out-of-sync flag without a revision or a history entry (migration 016)", async () => {
    const { createClient } = await import("@/lib/supabase/client");
    const { QueryClient } = await import("@tanstack/react-query");
    const { writeIntentSync } = await import("@/hooks/query/portfolios");
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    const read = async () =>
      (await createClient().from("portfolios").select("revision, intent_sync").eq("id", portfolioId).single()).data!;
    const entries = async () =>
      (await createClient().from("provenance_log").select("id").eq("portfolio_id", portfolioId)).data!.length;

    const before = await read();
    const logged = await entries();
    const flag = {
      state: "failed" as const,
      since: "2026-11-12T10:00:00.000Z",
      edits: [{ text: 'Made field "first" required', at: "2026-11-12T10:00:00.000Z", decision: false }],
      attempts: 1,
      reason: "budget" as const,
      message: "The AI service has reached its usage limit.",
    };
    await writeIntentSync(new QueryClient(), portfolioId, flag);

    const flagged = await read();
    expect(flagged.intent_sync).toEqual(flag);
    expect(flagged.revision).toBe(before.revision);
    expect(await entries()).toBe(logged);

    // A commit carries the flag along, and clearing it is again no change
    const commit = await commitPortfolioChange(portfolioId, () => null);
    expect(commit).toBeNull();
    await writeIntentSync(new QueryClient(), portfolioId, null);
    const cleared = await read();
    expect(cleared.intent_sync).toBeNull();
    expect(cleared.revision).toBe(before.revision);
    expect(await entries()).toBe(logged);
  });

  it("refuses an undo once something else changed the portfolio", async () => {
    const { commitPortfolioChange, revertCommit } = await import(
      "@/lib/engine/commit"
    );
    const first = await commitPortfolioChange(portfolioId, (c) => ({
      trigger: "field-edit",
      title: "renamed once",
      schema: { ...c.schema, version: c.schema.version + 1 },
    }));
    await commitPortfolioChange(portfolioId, (c) => ({
      trigger: "field-edit",
      schema: { ...c.schema, version: c.schema.version + 1 },
    }));
    expect(await revertCommit(first!, "test", "rename")).toBeNull();
  });
});
