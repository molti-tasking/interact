/**
 * Integration test for optimistic-concurrency commits against the local
 * Supabase stack (`npx supabase start` + migrations ≥ 007). Skipped when the
 * local API isn't reachable.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

async function reachable(): Promise<boolean> {
  if (!isLocal) return false;
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const available = await reachable();

describe.runIf(available)("commitPortfolioChange (local Supabase)", () => {
  let portfolioId: string;

  beforeAll(async () => {
    const { createClient } = await import("@/lib/supabase/client");
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
  });

  it("lands concurrent changes from the same snapshot without losing either", async () => {
    const { commitPortfolioChange } = await import("@/lib/engine/commit");
    const { addField } = await import("@/lib/engine/schema-ops");

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
          schema: addField(current.schema, mk(name)),
          provenance: {
            layer: "configuration",
            action: "test_add",
            actor: "test",
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

  it("refuses an undo once something else changed the portfolio", async () => {
    const { commitPortfolioChange, revertCommit } = await import(
      "@/lib/engine/commit"
    );
    const first = await commitPortfolioChange(portfolioId, (c) => ({
      title: "renamed once",
      schema: { ...c.schema, version: c.schema.version + 1 },
    }));
    await commitPortfolioChange(portfolioId, (c) => ({
      schema: { ...c.schema, version: c.schema.version + 1 },
    }));
    expect(await revertCommit(first!, "test", "rename")).toBeNull();
  });
});
