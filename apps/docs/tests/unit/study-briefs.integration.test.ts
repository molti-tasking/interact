// @vitest-environment node
/**
 * Integration test for self-paced briefs sessions (migration 014) against a
 * local Supabase stack with this app's migrations. Skipped when the API
 * isn't reachable or isn't this app's schema (another project's stack on
 * the same ports).
 *
 * To run against a stack on other ports:
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api> \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
 *   SUPABASE_TEST_DB_URL=postgresql://postgres:postgres@127.0.0.1:<db>/postgres \
 *   pnpm test study-briefs
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import { briefSteps, type MyStudyState } from "@/lib/study/types";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";

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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const isLocal = /127\.0\.0\.1|localhost/.test(url);
const DB_URL =
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Reachable, and the schema has this migration's tables. */
async function reachable(): Promise<boolean> {
  if (!isLocal) return false;
  try {
    const res = await fetch(`${url}/rest/v1/study_tasks?limit=0`, {
      headers: { apikey: anonKey },
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

const available = await reachable();

type Client = SupabaseClient<Database>;

function newClient(): Client {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const RUN = Date.now().toString(36);

interface Seat {
  client: Client;
  userId: string;
  pid: string;
  sessionId: string;
  participantId: string;
}

describe.runIf(available)("briefs sessions (local Supabase)", () => {
  let admin: Client;
  let adminId: string;
  let sessionId: string;
  let code: string;
  const users: string[] = [];
  let n = 0;

  async function join(pid = `pid${RUN}x${n++}`, client?: Client): Promise<Seat> {
    const c = client ?? newClient();
    let userId = "";
    if (!client) {
      const { data, error } = await c.auth.signInAnonymously();
      if (error) throw error;
      userId = data.user!.id;
      users.push(userId);
    }
    const { data, error } = await c.rpc("join_study_session_external", {
      p_code: code,
      p_source: "prolific",
      p_external_id: pid,
      p_external_study_id: "study",
      p_external_session_id: "sess",
      p_intent: emptyStructuredIntent() as unknown as Json,
      p_schema: emptyPortfolioSchema() as unknown as Json,
    });
    if (error) throw error;
    const row = data![0];
    return { client: c, userId, pid, sessionId: row.session_id, participantId: row.participant_id };
  }

  async function state(seat: Seat): Promise<MyStudyState> {
    const { data, error } = await seat.client.rpc("get_my_study_state", {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return data as unknown as MyStudyState;
  }

  async function advance(seat: Seat, from: string, reason?: string): Promise<string> {
    const { data, error } = await seat.client.rpc("advance_my_study_step", {
      p_session_id: sessionId,
      p_from: from,
      p_reason: reason,
    });
    if (error) throw error;
    return data;
  }

  async function setPhase(phase: string) {
    const { error } = await admin.rpc("advance_study_phase", {
      p_session_id: sessionId,
      p_phase: phase,
    });
    if (error) throw error;
  }

  const cells = () =>
    sql<{ condition: string; task_order: number; n: string }>(
      `SELECT condition, task_order, count(*) AS n FROM study_assignments
       WHERE session_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [sessionId],
    );

  beforeAll(async () => {
    admin = newClient();
    const email = `briefs-admin-${RUN}@test.local`;
    const { data, error } = await admin.auth.signUp({ email, password: "briefs-admin-password" });
    if (error) throw error;
    adminId = data.user!.id;
    await sql("INSERT INTO app_admins (user_id) VALUES ($1)", [adminId]);
    if (!data.session) {
      const { error: signInError } = await admin.auth.signInWithPassword({
        email,
        password: "briefs-admin-password",
      });
      if (signInError) throw signInError;
    }

    const created = await admin.rpc("create_study_session", {
      p_name: `__briefs_test_${RUN}__`,
      p_settings: {
        mode: "briefs",
        briefs: ["camp", "foster"],
        conditions: ["full", "baseline"],
        taskSeconds: 720,
      },
    });
    if (created.error) throw created.error;
    sessionId = created.data.id;
    code = created.data.join_code;
    await admin
      .from("study_session_secrets")
      .upsert({ session_id: sessionId, completion_url: "https://example.org/complete?cc=TEST" });
  }, 60_000);

  afterAll(async () => {
    if (!sessionId) return;
    await sql(
      `DELETE FROM portfolios WHERE id IN (SELECT portfolio_id FROM study_tasks WHERE session_id = $1)`,
      [sessionId],
    );
    await sql(
      `DELETE FROM spaces WHERE id = (SELECT space_id FROM study_sessions WHERE id = $1)`,
      [sessionId],
    );
    await sql("DELETE FROM study_sessions WHERE id = $1", [sessionId]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [[...users, adminId]]);
  });

  it("lets nobody in before the study is open", async () => {
    await expect(join()).rejects.toMatchObject({ message: expect.stringMatching(/not open/) });
    await setPhase("create");
  });

  it("fills condition × order evenly", async () => {
    for (let i = 0; i < 8; i++) await join();
    expect(await cells()).toEqual([
      { condition: "baseline", task_order: 0, n: "2" },
      { condition: "baseline", task_order: 1, n: "2" },
      { condition: "full", task_order: 0, n: "2" },
      { condition: "full", task_order: 1, n: "2" },
    ]);
  });

  it("gives each participant one form per brief, in their order", async () => {
    const seat = await join();
    const s = await state(seat);
    expect(s.progress?.step).toBe("consent");
    expect(s.tasks).toHaveLength(2);
    const [{ task_order }] = await sql<{ task_order: number }>(
      "SELECT task_order FROM study_assignments WHERE participant_id = $1",
      [seat.participantId],
    );
    expect(s.tasks!.map((t) => t.brief)).toEqual(
      task_order === 0 ? ["camp", "foster"] : ["foster", "camp"],
    );
    // Their own forms, and nobody else's
    const { data: forms } = await seat.client.from("portfolios").select("id");
    expect(forms!.map((f) => f.id).sort()).toEqual(
      s.tasks!.map((t) => t.portfolio_id!).sort(),
    );
    // The step tables are not readable directly
    const { data: tasks } = await seat.client.from("study_tasks").select("id");
    const { data: progress } = await seat.client.from("study_progress").select("step");
    expect(tasks).toEqual([]);
    expect(progress).toEqual([]);
  });

  it("walks the steps once each, timing tasks and snapshotting forms", async () => {
    const seat = await join();
    const steps = briefSteps(2);

    // A stale screen (wrong `from`) doesn't move anything
    expect(await advance(seat, "intro")).toBe("consent");

    expect((await state(seat)).completion_url ?? null).toBeNull();
    for (let i = 0; i < steps.length - 1; i++) {
      expect(await advance(seat, steps[i], steps[i] === "task:2" ? "timeout" : undefined)).toBe(
        steps[i + 1],
      );
      // A double click stays where it is
      expect(await advance(seat, steps[i])).toBe(steps[i + 1]);
      if (steps[i + 1] === "task:1") {
        const s = await state(seat);
        expect(s.tasks![0].started_at).not.toBeNull();
        expect(s.tasks![0].finished_at).toBeNull();
        expect(s.participant.portfolio_id).toBe(s.tasks![0].portfolio_id);
      }
      if (steps[i + 1] === "brief:2") {
        const s = await state(seat);
        expect(s.participant.portfolio_id).toBe(s.tasks![1].portfolio_id);
        expect(s.completion_url ?? null).toBeNull();
      }
    }

    const done = await state(seat);
    expect(done.progress).toMatchObject({ step: "done", outcome: "completed" });
    expect(done.completion_url).toBe("https://example.org/complete?cc=TEST");

    const tasks = await sql<{ position: number; finished_by: string; finished_at: string | null }>(
      "SELECT position, finished_by, finished_at FROM study_tasks WHERE participant_id = $1 ORDER BY position",
      [seat.participantId],
    );
    expect(tasks.map((t) => t.finished_by)).toEqual(["participant", "timeout"]);
    expect(tasks.every((t) => t.finished_at)).toBe(true);

    const snapshots = await sql<{ label: string }>(
      "SELECT label FROM study_snapshots WHERE participant_id = $1 ORDER BY created_at",
      [seat.participantId],
    );
    expect(snapshots.map((s) => s.label)).toEqual(
      done.tasks!.map((t) => `task:${t.position}:${t.brief}`),
    );
    const [{ consented_at }] = await sql<{ consented_at: string | null }>(
      "SELECT consented_at FROM study_progress WHERE participant_id = $1",
      [seat.participantId],
    );
    expect(consented_at).not.toBeNull();

    // Finished: no more AI calls on the study's budget
    const { data: canUseLlm } = await seat.client.rpc("is_study_participant");
    expect(canUseLlm).toBe(false);
  });

  it("closes the seat without a completion link when consent is declined", async () => {
    const seat = await join();
    const { error } = await seat.client.rpc("decline_my_study", { p_session_id: sessionId });
    expect(error).toBeNull();
    const s = await state(seat);
    expect(s.progress?.outcome).toBe("declined");
    expect(s.completion_url ?? null).toBeNull();
    expect(await advance(seat, "consent")).toBe("consent");
    const { data: canUseLlm } = await seat.client.rpc("is_study_participant");
    expect(canUseLlm).toBe(false);
  });

  it("returns the same seat for the same panel id", async () => {
    const seat = await join();
    const again = await join(seat.pid, seat.client);
    expect(again.participantId).toBe(seat.participantId);
  });

  it("refills the cell of an abandoned seat", async () => {
    // Level the cells first, so the next join would start a new round
    for (let guard = 0; guard < 8; guard++) {
      const counts = (await cells()).map((c) => Number(c.n));
      if (counts.length === 4 && new Set(counts).size === 1) break;
      await join();
    }
    const [victim] = await sql<{ participant_id: string; condition: string; task_order: number }>(
      `SELECT a.participant_id, a.condition, a.task_order
       FROM study_assignments a
       JOIN study_progress pr ON pr.participant_id = a.participant_id
       WHERE a.session_id = $1 AND pr.completed_at IS NULL
         AND a.condition = 'baseline' AND a.task_order = 1
       LIMIT 1`,
      [sessionId],
    );
    await sql(
      "UPDATE study_participants SET last_seen_at = now() - interval '1 hour' WHERE id = $1",
      [victim.participant_id],
    );
    const next = await join();
    const [assigned] = await sql<{ condition: string; task_order: number }>(
      "SELECT condition, task_order FROM study_assignments WHERE participant_id = $1",
      [next.participantId],
    );
    expect(assigned).toEqual({ condition: "baseline", task_order: 1 });
  });

  it("stops everyone who hasn't finished when the study is closed", async () => {
    const seat = await join();
    await advance(seat, "consent");
    await setPhase("done");
    await expect(advance(seat, "intro")).rejects.toMatchObject({
      message: expect.stringMatching(/ended/),
    });
    await expect(join()).rejects.toMatchObject({ message: expect.stringMatching(/ended/) });
  });
});
