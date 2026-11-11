// @vitest-environment node
/**
 * Integration test for migration 015 against a local Supabase stack with
 * this app's migrations: the wave-2 handoff (a task that starts from a
 * finished wave-1 form, as a portfolio or as a bare form, balanced), and
 * the form version stamped on responses and history entries.
 *
 * Skipped when the API isn't reachable or isn't this app's schema. To run
 * on a stack of your own, see tests/README.md ("An isolated stack").
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { MyStudyState } from "@/lib/study/types";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Reachable, and the schema has this migration's function. */
async function reachable(): Promise<boolean> {
  if (!/127\.0\.0\.1|localhost/.test(url)) return false;
  try {
    const res = await fetch(`${url}/rest/v1/study_tasks?select=start_kind&limit=0`, {
      headers: { apikey: anonKey },
    });
    return res.ok || res.status === 401;
  } catch {
    return false;
  }
}

const available = await reachable();
type Client = SupabaseClient<Database>;
const newClient = (): Client =>
  createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const RUN = Date.now().toString(36);
const RUN_SETTINGS = { model: "test-model", questionStrategy: "committee", committeeSize: 4 };

const field = (name: string, label: string) => ({
  id: `f-${name}`,
  name,
  label,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});

describe.runIf(available)("wave 2 handoff and form versions (local Supabase)", () => {
  let admin: Client;
  let adminId: string;
  const sessions: string[] = [];
  const users: string[] = [];
  let n = 0;

  async function createSession(settings: Record<string, unknown>) {
    const created = await admin.rpc("create_study_session", {
      p_name: `__handoff_test_${RUN}_${sessions.length}__`,
      p_settings: { mode: "briefs", taskSeconds: 720, run: RUN_SETTINGS, ...settings } as Json,
    });
    if (created.error) throw created.error;
    sessions.push(created.data.id);
    const opened = await admin.rpc("advance_study_phase", {
      p_session_id: created.data.id,
      p_phase: "create",
    });
    if (opened.error) throw opened.error;
    return { id: created.data.id as string, code: created.data.join_code as string };
  }

  async function join(code: string) {
    const client = newClient();
    const { data: auth, error: authError } = await client.auth.signInAnonymously();
    if (authError) throw authError;
    users.push(auth.user!.id);
    const { data, error } = await client.rpc("join_study_session_external", {
      p_code: code,
      p_source: "prolific",
      p_external_id: `h${RUN}x${n++}`,
      p_external_study_id: "study",
      p_external_session_id: "sess",
      p_intent: emptyStructuredIntent() as unknown as Json,
      p_schema: emptyPortfolioSchema() as unknown as Json,
    });
    if (error) throw error;
    return { client, sessionId: data![0].session_id, participantId: data![0].participant_id };
  }

  async function finish(seat: Awaited<ReturnType<typeof join>>) {
    let step = "consent";
    for (let i = 0; i < 20 && step !== "done"; i++) {
      const { data, error } = await seat.client.rpc("advance_my_study_step", {
        p_session_id: seat.sessionId,
        p_from: step,
      });
      if (error) throw error;
      step = data;
    }
    expect(step).toBe("done");
  }

  const tasksOf = (participantId: string) =>
    sql<{ position: number; brief: string; portfolio_id: string; start_kind: string | null; source_portfolio_id: string | null }>(
      "SELECT position, brief, portfolio_id, start_kind, source_portfolio_id FROM study_tasks WHERE participant_id = $1 ORDER BY position",
      [participantId],
    );

  // Wave 1: two participants, each with a finished camp and foster form
  const wave1Forms: Record<string, string[]> = { camp: [], foster: [] };
  let wave1: { id: string; code: string };
  let wave2: { id: string; code: string };

  beforeAll(async () => {
    admin = newClient();
    const email = `handoff-admin-${RUN}@test.local`;
    const { data, error } = await admin.auth.signUp({ email, password: "handoff-admin-password" });
    if (error) throw error;
    adminId = data.user!.id;
    await sql("INSERT INTO app_admins (user_id) VALUES ($1)", [adminId]);
    if (!data.session) {
      const signIn = await admin.auth.signInWithPassword({ email, password: "handoff-admin-password" });
      if (signIn.error) throw signIn.error;
    }

    wave1 = await createSession({ briefs: ["camp", "foster"], conditions: ["full"] });
    for (let i = 0; i < 2; i++) {
      const seat = await join(wave1.code);
      for (const task of await tasksOf(seat.participantId)) {
        // What a participant leaves behind: a form, its intent, an
        // answered question and the trail of how it came about
        const schema = {
          fields: [field("name", "Name"), field(`extra${i}`, `Extra ${i}`)],
          groups: [],
          version: 1,
        };
        const intent = {
          ...emptyStructuredIntent(),
          purpose: { content: `Sign-up for the ${task.brief}, author ${i}`, updatedAt: "t" },
        };
        const committed = await seat.client.rpc("commit_portfolio_change", {
          p_portfolio_id: task.portfolio_id,
          p_expected_revision: 0,
          p_schema: schema as unknown as Json,
          p_intent: intent as unknown as Json,
          p_provenance: {
            action: "design_probe_resolved",
            layer: "dimensions",
            actor: `Participant ${i + 1}`,
            rationale: '"Ask for extras?" → "Yes"',
            diff: { added: [], removed: [], modified: [] },
          } as Json,
        });
        if (committed.error) throw committed.error;
        await sql(
          `INSERT INTO design_probes (portfolio_id, text, layer, source, options, selected_option, status, resolved_by)
           VALUES ($1, 'Ask for extras?', 'dimensions', 'committee', $2, 'yes', 'resolved', $3),
                  ($1, 'Still open?', 'dimensions', 'committee', $2, NULL, 'pending', NULL)`,
          [task.portfolio_id, JSON.stringify([{ value: "yes", label: "Yes" }]), `Participant ${i + 1}`],
        );
        wave1Forms[task.brief].push(task.portfolio_id);
      }
      await finish(seat);
    }

    wave2 = await createSession({
      briefs: ["camp-2", "foster-2"],
      conditions: ["full"],
      handoff: {
        sourceSessionId: wave1.id,
        sources: { "camp-2": wave1Forms.camp, "foster-2": wave1Forms.foster },
        starts: ["portfolio", "form"],
      },
    });
  }, 120_000);

  afterAll(async () => {
    if (!sessions.length) return;
    await sql(
      `DELETE FROM portfolios WHERE id IN (SELECT portfolio_id FROM study_tasks WHERE session_id = ANY($1::uuid[]))`,
      [sessions],
    );
    await sql(
      `DELETE FROM spaces WHERE id IN (SELECT space_id FROM study_sessions WHERE id = ANY($1::uuid[]))`,
      [sessions],
    );
    await sql("DELETE FROM study_sessions WHERE id = ANY($1::uuid[])", [sessions]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [[...users, adminId]]);
  });

  it("offers the finished wave-1 forms to start from", async () => {
    const { data, error } = await admin.rpc("get_study_handoff_candidates", {
      p_session_id: wave1.id,
    });
    expect(error).toBeNull();
    expect(data!.map((c) => c.portfolio_id).sort()).toEqual(
      [...wave1Forms.camp, ...wave1Forms.foster].sort(),
    );
    expect(data![0]).toMatchObject({ condition: "full", field_count: 2, decisions: 1 });
    // Not for participants
    const stranger = newClient();
    const { data: auth } = await stranger.auth.signInAnonymously();
    users.push(auth.user!.id);
    const denied = await stranger.rpc("get_study_handoff_candidates", { p_session_id: wave1.id });
    expect(denied.error?.message).toMatch(/researcher/);
  });

  it("balances the starting point, the order and the forms passed on", async () => {
    const seats = [];
    for (let i = 0; i < 8; i++) seats.push(await join(wave2.code));

    const cells = await sql<{ start_kind: string; task_order: number; n: string }>(
      `SELECT start_kind, task_order, count(*) AS n FROM study_assignments
       WHERE session_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      [wave2.id],
    );
    // 2 starting points × 2 orders, two participants each
    expect(cells).toEqual([
      { start_kind: "form", task_order: 0, n: "2" },
      { start_kind: "form", task_order: 1, n: "2" },
      { start_kind: "portfolio", task_order: 0, n: "2" },
      { start_kind: "portfolio", task_order: 1, n: "2" },
    ]);

    // Every source form is passed on equally often per starting point
    const uses = await sql<{ brief: string; start_kind: string; source_portfolio_id: string; n: string }>(
      `SELECT brief, start_kind, source_portfolio_id, count(*) AS n FROM study_tasks
       WHERE session_id = $1 GROUP BY 1, 2, 3`,
      [wave2.id],
    );
    expect(uses).toHaveLength(8); // 2 briefs × 2 starts × 2 sources
    expect(new Set(uses.map((u) => u.n))).toEqual(new Set(["2"]));

    // A participant's tasks share the starting point, and start from a form
    // built for the brief their situation continues
    for (const seat of seats) {
      const tasks = await tasksOf(seat.participantId);
      expect(new Set(tasks.map((t) => t.start_kind)).size).toBe(1);
      for (const task of tasks) {
        const from = task.brief === "camp-2" ? wave1Forms.camp : wave1Forms.foster;
        expect(from).toContain(task.source_portfolio_id);
      }
    }
  }, 120_000);

  it("hands over the portfolio: form, intent, decisions and trail — or the form alone", async () => {
    const tasks = await sql<{ portfolio_id: string; start_kind: string; source_portfolio_id: string; display_name: string }>(
      `SELECT t.portfolio_id, t.start_kind, t.source_portfolio_id, sp.display_name
       FROM study_tasks t JOIN study_participants sp ON sp.id = t.participant_id
       WHERE t.session_id = $1`,
      [wave2.id],
    );
    for (const kind of ["portfolio", "form"]) {
      const task = tasks.find((t) => t.start_kind === kind)!;
      const [form] = await sql<{ schema: { fields: unknown[] }; intent: { purpose: { content: string } } }>(
        "SELECT schema, intent FROM portfolios WHERE id = $1",
        [task.portfolio_id],
      );
      const [source] = await sql<{ schema: unknown; intent: unknown }>(
        "SELECT schema, intent FROM portfolios WHERE id = $1",
        [task.source_portfolio_id],
      );
      // The same fields either way
      expect(form.schema).toEqual(source.schema);

      const probes = await sql<{ status: string; resolved_by: string }>(
        "SELECT status, resolved_by FROM design_probes WHERE portfolio_id = $1",
        [task.portfolio_id],
      );
      const trail = await sql<{ action: string; actor: string; rationale: string }>(
        "SELECT action, actor, rationale FROM provenance_log WHERE portfolio_id = $1 ORDER BY created_at, action",
        [task.portfolio_id],
      );
      const derived = trail.filter((t) => t.action === "portfolio_derived");
      // No change without a decision: taking the form over is on record,
      // with the participant as the actor
      expect(derived).toHaveLength(1);
      expect(derived[0].actor).toBe(task.display_name);
      expect(derived[0].rationale).toBeTruthy();

      if (kind === "portfolio") {
        expect(form.intent).toEqual(source.intent);
        // Answered questions only, and not who answered them
        expect(probes).toEqual([{ status: "resolved", resolved_by: "Previous author" }]);
        expect(trail.filter((t) => t.action === "design_probe_resolved")).toEqual([
          { action: "design_probe_resolved", actor: "Previous author", rationale: '"Ask for extras?" → "Yes"' },
        ]);
      } else {
        expect(form.intent.purpose.content).toBe("");
        expect(probes).toEqual([]);
        expect(trail).toHaveLength(1);
      }
    }
  });

  it("tells the participant how the task starts, and nothing about the sources", async () => {
    const seat = await join(wave2.code);
    const { data } = await seat.client.rpc("get_my_study_state", { p_session_id: wave2.id });
    const state = data as unknown as MyStudyState;
    expect(state.tasks!.every((t) => t.start_kind === "portfolio" || t.start_kind === "form")).toBe(true);
    expect(state.session.settings).not.toHaveProperty("handoff");
    expect(state.session.settings).not.toHaveProperty("run");
    expect(JSON.stringify(state)).not.toContain(wave1Forms.camp[0]);
    // They can open the form they were handed, not the one it came from
    const own = await seat.client.from("portfolios").select("id").eq("id", state.tasks![0].portfolio_id!);
    expect(own.data).toHaveLength(1);
    const source = await seat.client.from("portfolios").select("id").in("id", wave1Forms.camp);
    expect(source.data).toEqual([]);
  });

  it("refuses to start wave 2 without forms for a situation", async () => {
    const empty = await createSession({
      briefs: ["camp-2", "foster-2"],
      conditions: ["full"],
      handoff: { sources: { "camp-2": wave1Forms.camp }, starts: ["portfolio", "form"] },
    });
    await expect(join(empty.code)).rejects.toMatchObject({
      message: expect.stringMatching(/no forms to start from/),
    });
  });

  it("stamps each response with the form version it answered, and each change with the version it made", async () => {
    const formId = wave1Forms.camp[0];
    const revision = async () =>
      (await sql<{ revision: number }>("SELECT revision FROM portfolios WHERE id = $1", [formId]))[0].revision;

    const before = await revision();
    await sql("INSERT INTO responses (portfolio_id, data) VALUES ($1, $2)", [formId, JSON.stringify({ name: "A" })]);

    // The wording of a field changes
    const { data: committed, error } = await admin.rpc("commit_portfolio_change", {
      p_portfolio_id: formId,
      p_expected_revision: before,
      p_schema: {
        fields: [field("name", "Your full name"), field("extra0", "Extra 0")],
        groups: [],
        version: 1,
      } as unknown as Json,
      p_provenance: {
        action: "field_modified",
        layer: "configuration",
        actor: "Researcher",
        rationale: 'Modified field "Name"',
        diff: {
          added: [],
          removed: [],
          modified: [{ fieldId: "f-name", before: { label: "Name" }, after: { label: "Your full name" } }],
        },
      } as Json,
    });
    expect(error).toBeNull();
    const after = (committed as { revision: number }[])[0].revision;
    expect(after).toBe(before + 1);

    await sql("INSERT INTO responses (portfolio_id, data) VALUES ($1, $2)", [formId, JSON.stringify({ name: "B" })]);

    const responses = await sql<{ name: string; schema_version: number }>(
      "SELECT data->>'name' AS name, schema_version FROM responses WHERE portfolio_id = $1 ORDER BY data->>'name'",
      [formId],
    );
    expect(responses).toEqual([
      { name: "A", schema_version: before },
      { name: "B", schema_version: after },
    ]);
    const [change] = await sql<{ revision: number }>(
      "SELECT revision FROM provenance_log WHERE portfolio_id = $1 AND action = 'field_modified'",
      [formId],
    );
    // The answer "A" was given before this change, "B" after it
    expect(change.revision).toBe(after);
  });
});
