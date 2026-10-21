// @vitest-environment node
/**
 * Integration test for study mode access control (migration 011) against the
 * local Supabase stack (`npx supabase start`, anonymous sign-ins enabled in
 * supabase/config.toml). Skipped when the local API isn't reachable.
 *
 * Three anonymous participants and the e2e admin: participants may reach
 * only their own form (and its probes, history, responses), answer peer
 * forms only while the session is answering, and never change status or
 * ownership.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/supabase/database.types";
import { emptyPortfolioSchema, emptyStructuredIntent } from "@/lib/types";
import { E2E_ADMIN } from "../auth";

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
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function reachable(): Promise<boolean> {
  if (!isLocal) return false;
  try {
    const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: anonKey } });
    return res.ok;
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

interface Participant {
  client: Client;
  userId: string;
  participantId: string;
  portfolioId: string;
}

const RUN = Date.now().toString(36);

async function signInAnon(): Promise<{ client: Client; userId: string }> {
  const client = newClient();
  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw error;
  return { client, userId: data.user!.id };
}

async function join(code: string, name: string): Promise<Participant> {
  const { client, userId } = await signInAnon();
  const { data, error } = await client.rpc("join_study_session", {
    p_code: code,
    p_display_name: name,
    p_intent: emptyStructuredIntent() as unknown as Json,
    p_schema: emptyPortfolioSchema() as unknown as Json,
  });
  if (error) throw error;
  const row = data![0];
  return {
    client,
    userId,
    participantId: row.participant_id,
    portfolioId: row.portfolio_id,
  };
}

const field = {
  id: "f_hobby",
  name: "hobby",
  label: "Favourite hobby",
  type: { kind: "text" },
  required: false,
};

describe.runIf(available)("study mode RLS (local Supabase)", () => {
  let admin: Client;
  let sessionId: string;
  let code: string;
  let a: Participant;
  let b: Participant;
  let c: Participant;
  const anonUsers: string[] = [];

  async function advance(phase: string) {
    const { error } = await admin.rpc("advance_study_phase", {
      p_session_id: sessionId,
      p_phase: phase,
    });
    if (error) throw error;
  }

  beforeAll(async () => {
    const { ensureE2eAdmin } = await import("../e2e/global-setup");
    await ensureE2eAdmin();
    admin = newClient();
    const { error: signInError } = await admin.auth.signInWithPassword(E2E_ADMIN);
    if (signInError) throw signInError;

    const { data: session, error } = await admin.rpc("create_study_session", {
      p_name: `__rls_test_${RUN}__`,
    });
    if (error) throw error;
    sessionId = session.id;
    code = session.join_code;

    a = await join(code, `Alice ${RUN}`);
    b = await join(code, `Bob ${RUN}`);
    c = await join(code, `Cleo ${RUN}`);
    anonUsers.push(a.userId, b.userId, c.userId);
  }, 60_000);

  afterAll(async () => {
    if (!sessionId) return;
    const portfolios = await sql<{ portfolio_id: string }>(
      "SELECT portfolio_id FROM study_participants WHERE session_id = $1",
      [sessionId],
    );
    await sql("DELETE FROM study_snapshots WHERE session_id = $1", [sessionId]);
    await sql("DELETE FROM study_sessions WHERE id = $1", [sessionId]);
    await sql("DELETE FROM portfolios WHERE id = ANY($1::uuid[])", [
      portfolios.map((p) => p.portfolio_id),
    ]);
    await sql("DELETE FROM spaces WHERE name = $1", [`Study: __rls_test_${RUN}__`]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [anonUsers]);
  });

  it("join is idempotent per browser and names are unique per session", async () => {
    const again = await a.client.rpc("join_study_session", {
      p_code: code.toLowerCase(),
      p_display_name: `Alice ${RUN}`,
      p_intent: emptyStructuredIntent() as unknown as Json,
      p_schema: emptyPortfolioSchema() as unknown as Json,
    });
    expect(again.error).toBeNull();
    expect(again.data![0].portfolio_id).toBe(a.portfolioId);

    const intruder = await signInAnon();
    anonUsers.push(intruder.userId);
    const taken = await intruder.client.rpc("join_study_session", {
      p_code: code,
      p_display_name: `alice ${RUN}`,
      p_intent: emptyStructuredIntent() as unknown as Json,
      p_schema: emptyPortfolioSchema() as unknown as Json,
    });
    expect(taken.error?.message).toMatch(/already taken/);
  });

  it("participants see only their own form", async () => {
    const { data, error } = await a.client.from("portfolios").select("id, owner_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ id: a.portfolioId, owner_id: a.userId }]);
    const { data: isParticipant } = await a.client.rpc("is_study_participant");
    expect(isParticipant).toBe(true);
  });

  it("participants can rename their form but not someone else's", async () => {
    const own = await a.client
      .from("portfolios")
      .update({ title: "Alice's knitting circle" })
      .eq("id", a.portfolioId)
      .select("title");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ title: "Alice's knitting circle" }]);

    const other = await a.client
      .from("portfolios")
      .update({ title: "hijacked" })
      .eq("id", b.portfolioId)
      .select("title");
    expect(other.data).toEqual([]);
    const [row] = await sql<{ title: string }>(
      "SELECT title FROM portfolios WHERE id = $1",
      [b.portfolioId],
    );
    expect(row.title).not.toBe("hijacked");
  });

  it("participants can't publish, re-own, delete or create forms", async () => {
    const publish = await a.client
      .from("portfolios")
      .update({ status: "published" })
      .eq("id", a.portfolioId);
    expect(publish.error?.code).toBe("42501");

    const reown = await a.client
      .from("portfolios")
      .update({ owner_id: b.userId })
      .eq("id", a.portfolioId);
    expect(reown.error).not.toBeNull();

    // commit_portfolio_change accepts a status too — the trigger blocks it
    const [{ revision }] = await sql<{ revision: number }>(
      "SELECT revision FROM portfolios WHERE id = $1",
      [a.portfolioId],
    );
    const commitStatus = await a.client.rpc("commit_portfolio_change", {
      p_portfolio_id: a.portfolioId,
      p_expected_revision: revision,
      p_status: "published",
    });
    expect(commitStatus.error?.code).toBe("42501");

    await a.client.from("portfolios").delete().eq("id", a.portfolioId);
    const still = await sql("SELECT 1 FROM portfolios WHERE id = $1", [a.portfolioId]);
    expect(still).toHaveLength(1);

    const insert = await a.client.from("portfolios").insert({
      title: "second form",
      intent: emptyStructuredIntent() as unknown as Json,
      schema: emptyPortfolioSchema() as unknown as Json,
    });
    expect(insert.error).not.toBeNull();
  });

  it("commits to the own form work and are attributed to the participant", async () => {
    for (const p of [a, b, c]) {
      const [{ revision }] = await sql<{ revision: number }>(
        "SELECT revision FROM portfolios WHERE id = $1",
        [p.portfolioId],
      );
      const { data, error } = await p.client.rpc("commit_portfolio_change", {
        p_portfolio_id: p.portfolioId,
        p_expected_revision: revision,
        p_schema: { fields: [field], groups: [], version: 1 } as unknown as Json,
        p_provenance: {
          action: "field_added_from_prompt",
          layer: "configuration",
          actor: "Participant",
        } as unknown as Json,
      });
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
    const [log] = await sql<{ actor_user_id: string }>(
      "SELECT actor_user_id FROM provenance_log WHERE portfolio_id = $1",
      [a.portfolioId],
    );
    expect(log.actor_user_id).toBe(a.userId);
    const { data: history } = await a.client.from("provenance_log").select("portfolio_id");
    expect(history?.every((h) => h.portfolio_id === a.portfolioId)).toBe(true);

    const [{ revision: bRevision }] = await sql<{ revision: number }>(
      "SELECT revision FROM portfolios WHERE id = $1",
      [b.portfolioId],
    );
    const foreign = await a.client.rpc("commit_portfolio_change", {
      p_portfolio_id: b.portfolioId,
      p_expected_revision: bRevision,
      p_title: "hijacked",
    });
    expect(foreign.error).not.toBeNull();
  });

  it("design probes: own form only, and updates really apply", async () => {
    const own = await a.client
      .from("design_probes")
      .insert({ portfolio_id: a.portfolioId, text: "Indoor or outdoor?" })
      .select("id")
      .single();
    expect(own.error).toBeNull();

    const updated = await a.client
      .from("design_probes")
      .update({ status: "dismissed" })
      .eq("id", own.data!.id)
      .select("status");
    expect(updated.data).toEqual([{ status: "dismissed" }]);

    const foreign = await a.client
      .from("design_probes")
      .insert({ portfolio_id: b.portfolioId, text: "sneaky" });
    expect(foreign.error).not.toBeNull();
  });

  it("peer forms are closed before the answer phase", async () => {
    const form = await a.client.rpc("get_published_form", { p_id: b.portfolioId });
    expect(form.data).toEqual([]);
    const submit = await a.client.rpc("submit_response", {
      p_portfolio_id: b.portfolioId,
      p_data: { hobby: "too early" },
    });
    expect(submit.error).not.toBeNull();
  });

  it("answer phase: peers answer each form once, never their own", async () => {
    await advance("create");
    await advance("answer");

    const snapshots = await sql(
      "SELECT 1 FROM study_snapshots WHERE session_id = $1 AND label = 'end_of_create'",
      [sessionId],
    );
    expect(snapshots).toHaveLength(3);

    const form = await a.client.rpc("get_published_form", { p_id: b.portfolioId });
    expect(form.data).toHaveLength(1);

    const first = await a.client.rpc("submit_response", {
      p_portfolio_id: b.portfolioId,
      p_data: { hobby: "climbing" },
    });
    expect(first.error).toBeNull();
    const second = await a.client.rpc("submit_response", {
      p_portfolio_id: b.portfolioId,
      p_data: { hobby: "climbing again" },
    });
    expect(second.error?.message).toMatch(/already answered/);

    const ownForm = await a.client.rpc("submit_response", {
      p_portfolio_id: a.portfolioId,
      p_data: { hobby: "self" },
    });
    expect(ownForm.error).not.toBeNull();

    // Never on the public route: the form itself stays a draft
    const outsider = newClient();
    const publicForm = await outsider.rpc("get_published_form", { p_id: b.portfolioId });
    expect(publicForm.data ?? []).toEqual([]);

    const { data: gallery } = await a.client.rpc("get_study_forms", {
      p_session_id: sessionId,
    });
    expect(gallery?.map((g) => g.portfolio_id).sort()).toEqual(
      [b.portfolioId, c.portfolioId].sort(),
    );
    expect(gallery?.find((g) => g.portfolio_id === b.portfolioId)?.answered_by_me).toBe(true);
  });

  it("responses: owners see answers to their form, respondents their own", async () => {
    const forB = await b.client.from("responses").select("portfolio_id, respondent_id");
    expect(forB.data).toEqual([{ portfolio_id: b.portfolioId, respondent_id: a.userId }]);

    const byA = await a.client.from("responses").select("portfolio_id");
    expect(byA.data).toEqual([{ portfolio_id: b.portfolioId }]);

    const forC = await c.client.from("responses").select("id");
    expect(forC.data).toEqual([]);
  });

  it("review phase: a short grace window, then peer forms close", async () => {
    await advance("review");
    const late = await c.client.rpc("submit_response", {
      p_portfolio_id: b.portfolioId,
      p_data: { hobby: "just in time" },
    });
    expect(late.error).toBeNull();

    await sql(
      "UPDATE study_sessions SET phase_started_at = now() - interval '3 minutes' WHERE id = $1",
      [sessionId],
    );
    const tooLate = await c.client.rpc("submit_response", {
      p_portfolio_id: a.portfolioId,
      p_data: { hobby: "too late" },
    });
    expect(tooLate.error).not.toBeNull();
  });

  it("questionnaires and events are scoped to the participant", async () => {
    const own = await a.client.from("study_questionnaire_responses").insert({
      session_id: sessionId,
      participant_id: a.participantId,
      instrument: "final",
      answers: { sus_1: 4 },
    });
    expect(own.error).toBeNull();

    const forged = await a.client.from("study_questionnaire_responses").insert({
      session_id: sessionId,
      participant_id: b.participantId,
      instrument: "final",
      answers: { sus_1: 1 },
    });
    expect(forged.error).not.toBeNull();

    const peek = await b.client.from("study_questionnaire_responses").select("id");
    expect(peek.data).toEqual([]);

    const event = await a.client.from("study_events").insert({
      session_id: sessionId,
      participant_id: a.participantId,
      type: "probe_shown",
    });
    expect(event.error).toBeNull();
    const forgedEvent = await a.client.from("study_events").insert({
      session_id: sessionId,
      participant_id: b.participantId,
      type: "probe_shown",
    });
    expect(forgedEvent.error).not.toBeNull();
    const readEvents = await a.client.from("study_events").select("id");
    expect(readEvents.data).toEqual([]);
  });

  it("outsiders (signed in, not joined) get nothing", async () => {
    const outsider = await signInAnon();
    anonUsers.push(outsider.userId);
    const { data: forms } = await outsider.client.from("portfolios").select("id");
    expect(forms).toEqual([]);
    const { data: sessions } = await outsider.client.from("study_sessions").select("id");
    expect(sessions).toEqual([]);
    const { data: state } = await outsider.client.rpc("get_my_study_state", {
      p_session_id: sessionId,
    });
    expect(state).toBeNull();
    const { data: isParticipant } = await outsider.client.rpc("is_study_participant");
    expect(isParticipant).toBe(false);
    const roster = await outsider.client.rpc("get_study_roster", { p_session_id: sessionId });
    expect(roster.error).not.toBeNull();
    const advanceAttempt = await outsider.client.rpc("advance_study_phase", {
      p_session_id: sessionId,
      p_phase: "done",
    });
    expect(advanceAttempt.error).not.toBeNull();
  });

  it("the facilitator sees the whole roster", async () => {
    const { data: roster, error } = await admin.rpc("get_study_roster", {
      p_session_id: sessionId,
    });
    expect(error).toBeNull();
    const byName = new Map(roster!.map((r) => [r.display_name, r]));
    expect(byName.get(`Alice ${RUN}`)?.responses_given).toBe(1);
    expect(byName.get(`Bob ${RUN}`)?.responses_received).toBe(2);
    expect(byName.get(`Alice ${RUN}`)?.questionnaire_done).toBe(true);
  });

  it("a reassigned seat moves to the new browser", async () => {
    const { error } = await admin.rpc("reassign_study_seat", {
      p_participant_id: a.participantId,
    });
    expect(error).toBeNull();

    const fresh = await join(code, `Alice ${RUN}`);
    anonUsers.push(fresh.userId);
    expect(fresh.participantId).toBe(a.participantId);
    expect(fresh.portfolioId).toBe(a.portfolioId);

    const { data: mine } = await fresh.client.from("portfolios").select("id");
    expect(mine).toEqual([{ id: a.portfolioId }]);
    const { data: old } = await a.client.from("portfolios").select("id");
    expect(old).toEqual([]);
    // Answers given from the old browser stay "answered"
    const { data: gallery } = await fresh.client.rpc("get_study_forms", {
      p_session_id: sessionId,
    });
    expect(gallery?.find((g) => g.portfolio_id === b.portfolioId)?.answered_by_me).toBe(true);
  });
});
