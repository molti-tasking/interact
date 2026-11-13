// @vitest-environment node
/**
 * Integration test for the 2026-11-13 additions (migration 017) against a
 * local Supabase stack with this app's migrations:
 *
 * - balancing with three arms (full, assistant, silent baseline) — the
 *   assignment lives in SQL, so this is where it is tested;
 * - the post-task steps of new sessions, and the old steps of old ones;
 * - forcing an arm: ignored unless `study_local_mode` allows it.
 *
 * Runs only when a loopback stack is named explicitly (it never reads
 * .env.local, so it can't touch a stack by accident):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:<api> \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
 *   E2E_DB_URL=postgresql://postgres:postgres@127.0.0.1:<db>/postgres \
 *   vitest run study-assistant
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import { briefSteps } from "@/lib/study/types";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { TEST_DB_URL } from "../db";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const loopback = (value: string) => {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
};

async function reachable(): Promise<boolean> {
  if (!loopback(url) || !loopback(TEST_DB_URL.replace(/^postgres(ql)?:/, "http:"))) return false;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/study_steps`, {
      method: "POST",
      headers: { apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_settings: {}, p_tasks: 1 }),
    });
    // 401/403: the function exists (anon may not call it); 404: no migration 017
    return res.status !== 404;
  } catch {
    return false;
  }
}

const available = await reachable();

type Client = SupabaseClient<Database>;

const newClient = (): Client =>
  createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const RUN = Date.now().toString(36);
const RUN_SETTINGS = { model: "test-model", questionStrategy: "committee", committeeSize: 4 };

interface Seat {
  client: Client;
  sessionId: string;
  participantId: string;
}

describe.runIf(available)("assistant arm, post-task steps, forced arms (local Supabase)", () => {
  let admin: Client;
  let adminId = "";
  const users: string[] = [];
  const sessions: string[] = [];
  let localModeBefore: { forced_arms: boolean }[] = [];
  let n = 0;

  async function createSession(settings: Record<string, unknown>) {
    const created = await admin.rpc("create_study_session", {
      p_name: `__assistant_test_${RUN}_${sessions.length}__`,
      p_settings: { mode: "briefs", briefs: ["camp", "foster"], taskSeconds: 720, run: RUN_SETTINGS, ...settings } as Json,
    });
    if (created.error) throw created.error;
    sessions.push(created.data.id);
    const opened = await admin.rpc("advance_study_phase", {
      p_session_id: created.data.id,
      p_phase: "create",
    });
    if (opened.error) throw opened.error;
    return { id: created.data.id, code: created.data.join_code };
  }

  async function join(code: string): Promise<Seat> {
    const client = newClient();
    const { data: auth, error: authError } = await client.auth.signInAnonymously();
    if (authError) throw authError;
    users.push(auth.user!.id);
    const { data, error } = await client.rpc("join_study_session_external", {
      p_code: code,
      p_source: "prolific",
      p_external_id: `pid${RUN}x${n++}`,
      p_external_study_id: "study",
      p_external_session_id: "sess",
      p_intent: emptyStructuredIntent() as unknown as Json,
      p_schema: emptyPortfolioSchema() as unknown as Json,
    });
    if (error) throw error;
    return { client, sessionId: data![0].session_id, participantId: data![0].participant_id };
  }

  async function advance(seat: Seat, from: string): Promise<string> {
    const { data, error } = await seat.client.rpc("advance_my_study_step", {
      p_session_id: seat.sessionId,
      p_from: from,
    });
    if (error) throw error;
    return data;
  }

  const conditionOf = async (seat: Seat) =>
    (
      await sql<{ condition: string }>("SELECT condition FROM study_assignments WHERE participant_id = $1", [
        seat.participantId,
      ])
    )[0].condition;

  beforeAll(async () => {
    localModeBefore = await sql("SELECT forced_arms FROM study_local_mode");
    await sql("DELETE FROM study_local_mode");
    admin = newClient();
    const email = `assistant-admin-${RUN}@test.local`;
    const { data, error } = await admin.auth.signUp({ email, password: "assistant-admin-password" });
    if (error) throw error;
    adminId = data.user!.id;
    await sql("INSERT INTO app_admins (user_id) VALUES ($1)", [adminId]);
    if (!data.session) {
      const { error: signInError } = await admin.auth.signInWithPassword({
        email,
        password: "assistant-admin-password",
      });
      if (signInError) throw signInError;
    }
  }, 60_000);

  afterAll(async () => {
    await sql("DELETE FROM study_local_mode");
    for (const row of localModeBefore) {
      await sql("INSERT INTO study_local_mode (forced_arms) VALUES ($1)", [row.forced_arms]);
    }
    for (const id of sessions) {
      await sql(`DELETE FROM portfolios WHERE id IN (SELECT portfolio_id FROM study_tasks WHERE session_id = $1)`, [id]);
      await sql(`DELETE FROM spaces WHERE id = (SELECT space_id FROM study_sessions WHERE id = $1)`, [id]);
      await sql("DELETE FROM study_sessions WHERE id = $1", [id]);
    }
    await sql("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [[...users, adminId].filter(Boolean)]);
  });

  it("balances three arms × two orders, each factor from the first participants on", async () => {
    const { code } = await createSession({ conditions: ["full", "assistant", "baseline"], postTaskMeasures: true });
    const seats: Seat[] = [];
    for (let i = 0; i < 12; i++) seats.push(await join(code));
    // The first three get three different arms
    expect(new Set(await Promise.all(seats.slice(0, 3).map(conditionOf)))).toEqual(
      new Set(["full", "assistant", "baseline"]),
    );
    const cells = await sql<{ condition: string; task_order: number; n: string }>(
      `SELECT condition, task_order, count(*) AS n FROM study_assignments
       WHERE session_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [seats[0].sessionId],
    );
    expect(cells).toEqual(
      ["assistant", "baseline", "full"].flatMap((condition) =>
        [0, 1].map((task_order) => ({ condition, task_order, n: "2" })),
      ),
    );
  }, 120_000);

  it("walks a new session through ratings, recall and why after each task", async () => {
    const { code } = await createSession({ conditions: ["assistant"], postTaskMeasures: true });
    const seat = await join(code);
    const steps = briefSteps(2, true);
    let step = "consent";
    const seen = [step];
    while (step !== "done") {
      step = await advance(seat, step);
      seen.push(step);
    }
    expect(seen).toEqual(steps);
    // The form is kept when the task ends, before the measures start
    const snapshots = await sql<{ label: string }>(
      "SELECT label FROM study_snapshots WHERE participant_id = $1 ORDER BY created_at",
      [seat.participantId],
    );
    expect(snapshots.map((s) => s.label.split(":").slice(0, 2).join(":"))).toEqual(["task:1", "task:2"]);
    const entered = await sql<{ phase: string; from: string }>(
      `SELECT phase, payload->>'from' AS from FROM study_events
       WHERE participant_id = $1 AND type = 'step_entered' ORDER BY id`,
      [seat.participantId],
    );
    expect(entered.find((e) => e.phase === "ratings:1")?.from).toBe("task:1");
    expect(entered.find((e) => e.phase === "quiz:1")?.from).toBe("why:1");
  }, 60_000);

  it("keeps the old steps in a session without post-task measures", async () => {
    const { code } = await createSession({ conditions: ["full"] });
    const seat = await join(code);
    for (const from of ["consent", "intro", "brief:1"]) await advance(seat, from);
    expect(await advance(seat, "task:1")).toBe("quiz:1");
  }, 60_000);

  it("tells the app whether a participant's session runs with this deployment's model", async () => {
    const { code } = await createSession({ conditions: ["full"], postTaskMeasures: true });
    const seat = await join(code);
    const runsOn = async (model: string) => {
      const { data, error } = await seat.client.rpc("my_study_runs_on", { p_model: model });
      if (error) throw error;
      return data;
    };
    expect(await runsOn(RUN_SETTINGS.model)).toBe(true);
    expect(await runsOn(` ${RUN_SETTINGS.model} `)).toBe(true);
    expect(await runsOn("another-model")).toBe(false);
    // Somebody in no session (or only finished ones) is never refused
    const stranger = newClient();
    const { data: anon } = await stranger.auth.signInAnonymously();
    users.push(anon.user!.id);
    expect((await stranger.rpc("my_study_runs_on", { p_model: "another-model" })).data).toBe(true);
    await sql("UPDATE study_progress SET completed_at = now(), outcome = 'completed' WHERE participant_id = $1", [
      seat.participantId,
    ]);
    expect(await runsOn("another-model")).toBe(true);
  }, 60_000);

  describe("forcing an arm", () => {
    let code = "";
    beforeAll(async () => {
      ({ code } = await createSession({ conditions: ["full", "assistant"], postTaskMeasures: true }));
    }, 60_000);

    const force = (seat: Seat, arm: string) =>
      seat.client.rpc("force_my_study_arm", { p_session_id: seat.sessionId, p_arm: arm });

    it("changes nothing without the local mode (as on a deployment)", async () => {
      const seat = await join(code);
      const before = await conditionOf(seat);
      const other = before === "full" ? "assistant" : "full";
      const { data, error } = await force(seat, other);
      expect(error).toBeNull();
      expect(data).toBeNull();
      expect(await conditionOf(seat)).toBe(before);
    });

    it("participants can't switch the local mode on", async () => {
      const seat = await join(code);
      const { error } = await seat.client.from("study_local_mode" as never).insert({ forced_arms: true } as never);
      expect(error).not.toBeNull();
      expect(await sql("SELECT 1 FROM study_local_mode")).toEqual([]);
    });

    it("with the local mode: sets the arm on the consent step only", async () => {
      await sql("INSERT INTO study_local_mode (forced_arms) VALUES (true)");
      const seat = await join(code);
      expect((await force(seat, "baseline")).data).toBe("baseline");
      expect(await conditionOf(seat)).toBe("baseline");
      const events = await sql<{ payload: { arm: string } }>(
        "SELECT payload FROM study_events WHERE participant_id = $1 AND type = 'arm_forced'",
        [seat.participantId],
      );
      expect(events.map((e) => e.payload.arm)).toEqual(["baseline"]);

      expect((await force(seat, "nonsense")).error?.message).toMatch(/Unknown arm/);

      await advance(seat, "consent");
      expect((await force(seat, "assistant")).data).toBeNull();
      expect(await conditionOf(seat)).toBe("baseline");
      await sql("DELETE FROM study_local_mode");
    });
  });
});
