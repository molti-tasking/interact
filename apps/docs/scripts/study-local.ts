/**
 * pnpm study:local — wave 1 of the Prolific study on this machine, for the
 * authors to click through themselves (docs/study/local-testing.md).
 *
 *   1. checks Docker and the local Supabase stack (starts it if it is the
 *      stack of supabase/config.toml and not running);
 *   2. applies every migration;
 *   3. seeds a local researcher account and one open briefs session with
 *      the arms full, assistant and the silent baseline (reused on the next
 *      run while the model settings stay the same);
 *   4. prints a study link per arm (fake PROLIFIC_PIDs) and the
 *      facilitator page;
 *   5. starts the app with .env.study-local — never .env.local, which
 *      points at the hosted database.
 *
 * Flags: --setup-only (no app), --fresh (a new session), --no-start (don't
 * start Supabase). It refuses any Supabase or database URL that is not a
 * loopback address.
 */

import { createClient } from "@supabase/supabase-js";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { BRIEF_KEYS } from "../src/lib/study/briefs";
import { runSettingsFromEnv, type StudyRunSettings } from "../src/lib/study/types";

const APP_DIR = path.resolve(__dirname, "..");
const ENV_FILE = path.resolve(process.env.STUDY_LOCAL_ENV_FILE ?? path.join(APP_DIR, ".env.study-local"));
const SUPABASE = path.join(APP_DIR, "node_modules/.bin/supabase");
const NEXT = path.join(APP_DIR, "node_modules/.bin/next");
const SESSION_NAME = "Local test · wave 1";
const ARMS = ["full", "assistant", "baseline"] as const;
const ARM_LABEL: Record<(typeof ARMS)[number], string> = {
  full: "full (Malleable Forms)",
  assistant: "assistant (chat)",
  baseline: "silent baseline",
};
/** Reserved for documentation (RFC 2606): the completion link goes nowhere real */
const COMPLETION_URL = "https://example.org/prolific-complete?cc=LOCALTEST";

const flags = new Set(process.argv.slice(2));

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function step(message: string) {
  console.log(`\n→ ${message}`);
}

/** KEY=VALUE lines; quotes stripped; comments and blank lines ignored. */
function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    env[m[1]] = value;
  }
  return env;
}

function isLoopback(value: string): boolean {
  try {
    const host = new URL(value.replace(/^postgres(ql)?:/, "http:")).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

async function apiUp(url: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key } });
    return res.ok;
  } catch {
    return false;
  }
}

/** The API port supabase/config.toml would start a stack on. */
function configApiPort(): string | null {
  try {
    const toml = fs.readFileSync(path.join(APP_DIR, "supabase/config.toml"), "utf-8");
    return toml.match(/\[api\][\s\S]*?\nport\s*=\s*(\d+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

const sameRun = (a: StudyRunSettings, b: StudyRunSettings) =>
  a.model === b.model &&
  a.fastModel === b.fastModel &&
  a.questionStrategy === b.questionStrategy &&
  a.committeeSize === b.committeeSize;

async function main() {
  // ---------------------------------------------------------------- env --
  if (path.basename(ENV_FILE) === ".env.local") {
    fail(".env.local points at the hosted database; this script never reads it.");
  }
  if (!fs.existsSync(ENV_FILE)) {
    fail(
      `No ${path.relative(process.cwd(), ENV_FILE)}. Create it from the example:\n` +
        `  cp apps/docs/.env.study-local.example apps/docs/.env.study-local`,
    );
  }
  const env = parseEnvFile(fs.readFileSync(ENV_FILE, "utf-8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const dbUrl = env.STUDY_LOCAL_DB_URL ?? "";
  if (!url || !anonKey || !dbUrl) {
    fail(`${path.basename(ENV_FILE)} needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and STUDY_LOCAL_DB_URL.`);
  }
  if (!isLoopback(url)) fail(`NEXT_PUBLIC_SUPABASE_URL is not a loopback address (${url}). Local databases only.`);
  if (!isLoopback(dbUrl)) fail("STUDY_LOCAL_DB_URL is not a loopback address. Local databases only.");
  const mock = (env.STUDY_MOCK_LLM ?? "1").trim() !== "0";
  const port = Number(env.STUDY_LOCAL_PORT ?? 3000);
  const base = `http://localhost:${port}`;

  // ------------------------------------------------------ Docker, stack --
  step("Docker");
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    fail("Docker isn't running. Start Docker Desktop and run this again.");
  }
  console.log("  running");

  step(`Supabase at ${url}`);
  if (!(await apiUp(url, anonKey))) {
    const ours = configApiPort() === new URL(url).port;
    if (flags.has("--no-start") || !ours) {
      fail(
        ours
          ? "The local Supabase isn't running. Start it: (cd apps/docs && npx supabase start)"
          : `Nothing answers at ${url}, and it isn't the stack of apps/docs/supabase/config.toml, so it isn't started from here.`,
      );
    }
    console.log("  not running — starting the stack of apps/docs/supabase/config.toml (takes a minute)");
    const started = spawnSync(SUPABASE, ["start", "--workdir", APP_DIR], { stdio: "inherit" });
    if (started.status !== 0 || !(await apiUp(url, anonKey))) {
      fail("Supabase didn't start. If another project's stack holds the ports, stop it or use other ports (docs/study/local-testing.md).");
    }
  }
  console.log("  reachable");

  const db = new Client({ connectionString: dbUrl });
  await db.connect().catch((err: Error) => fail(`Can't connect to ${dbUrl.replace(/\/\/[^@]*@/, "//")}: ${err.message}`));
  const own = await db.query<{ found: boolean }>(
    `SELECT to_regclass('public.portfolios') IS NOT NULL AND to_regclass('public.study_tasks') IS NOT NULL AS found`,
  );
  if (!own.rows[0]?.found) {
    await db.end();
    fail("That database doesn't have this app's tables — it is probably another project's stack. Nothing was changed.");
  }

  // --------------------------------------------------------- migrations --
  step("Migrations");
  const migrated = spawnSync(
    SUPABASE,
    ["migration", "up", "--workdir", APP_DIR, `--remote=${dbUrl}`, "--yes"],
    { encoding: "utf-8" },
  );
  if (migrated.status !== 0) {
    await db.end();
    fail(`Applying the migrations failed:\n${migrated.stderr || migrated.stdout}`);
  }
  const applied = (() => {
    try {
      return (JSON.parse(migrated.stdout.trim().split("\n").pop() ?? "{}") as { applied?: string[] }).applied ?? [];
    } catch {
      return [];
    }
  })();
  console.log(applied.length ? applied.map((f) => `  applied ${path.basename(f)}`).join("\n") : "  up to date");

  // --------------------------------------------------------------- seed --
  step("Seed");
  // Study links may pick their arm here (and only where this row exists)
  await db.query(
    `INSERT INTO study_local_mode (id, forced_arms) VALUES (true, true)
     ON CONFLICT (id) DO UPDATE SET forced_arms = true, updated_at = now()`,
  );

  const email = env.STUDY_LOCAL_ADMIN_EMAIL || "researcher@study.local";
  const password = env.STUDY_LOCAL_ADMIN_PASSWORD || "study-local-password";
  const admin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let signedIn = await admin.auth.signInWithPassword({ email, password });
  if (signedIn.error) {
    const created = await admin.auth.signUp({ email, password });
    if (created.error) fail(`Couldn't create the local researcher ${email}: ${created.error.message}`);
    signedIn = await admin.auth.signInWithPassword({ email, password });
    if (signedIn.error) fail(`Couldn't sign in as ${email}: ${signedIn.error.message}`);
  }
  await db.query("INSERT INTO app_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [signedIn.data.user!.id]);
  console.log(`  researcher ${email}`);

  const runEnv = { ...env, LLM_MODEL_NAME: env.LLM_MODEL_NAME || (mock ? "mock-fixtures" : "") };
  const current = runSettingsFromEnv(runEnv);
  if (!current.run) {
    await db.end();
    fail(`Set ${current.missing.join(", ")} in ${path.basename(ENV_FILE)}.`);
  }

  const existing = flags.has("--fresh")
    ? []
    : (
        await db.query<{ id: string; join_code: string; settings: { run?: StudyRunSettings } }>(
          `SELECT id, join_code, settings FROM study_sessions
           WHERE name = $1 AND phase = 'create'
             AND settings->>'mode' = 'briefs' AND settings->>'postTaskMeasures' = 'true'
           ORDER BY created_at DESC LIMIT 1`,
          [SESSION_NAME],
        )
      ).rows.filter((s) => s.settings.run && sameRun(s.settings.run, current.run));

  let session: { id: string; join_code: string };
  if (existing[0]) {
    session = existing[0];
    console.log(`  session ${session.join_code} (reused; --fresh for a new one)`);
  } else {
    const created = await admin.rpc("create_study_session", {
      p_name: SESSION_NAME,
      p_settings: {
        mode: "briefs",
        briefs: BRIEF_KEYS,
        conditions: [...ARMS],
        taskSeconds: Math.round(Number(env.STUDY_LOCAL_TASK_MINUTES || 12) * 60),
        postTaskMeasures: true,
        contact: { name: "The research team", email: "research@study.local", institution: "" },
      },
    });
    if (created.error) fail(`Couldn't create the session: ${created.error.message}`);
    session = created.data as { id: string; join_code: string };
    const secret = await admin
      .from("study_session_secrets")
      .upsert({ session_id: session.id, completion_url: COMPLETION_URL });
    if (secret.error) fail(`Couldn't set the completion URL: ${secret.error.message}`);
    // What it runs with, as the session page's "Open the study" records it
    const settings = (await db.query<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM study_sessions WHERE id = $1",
      [session.id],
    )).rows[0].settings;
    const recorded = await admin
      .from("study_sessions")
      .update({ settings: { ...settings, run: current.run } })
      .eq("id", session.id);
    if (recorded.error) fail(`Couldn't record the run settings: ${recorded.error.message}`);
    const opened = await admin.rpc("advance_study_phase", { p_session_id: session.id, p_phase: "create" });
    if (opened.error) fail(`Couldn't open the session: ${opened.error.message}`);
    console.log(`  session ${session.join_code} (new, open)`);
  }
  await db.end();

  // -------------------------------------------------------------- links --
  const stamp = Date.now().toString(36);
  const link = (pid: string, arm?: string) =>
    `${base}/join?code=${session.join_code}&PROLIFIC_PID=${pid}&STUDY_ID=local&SESSION_ID=${pid}` +
    (arm ? `&arm=${arm}` : "");
  console.log(`
────────────────────────────────────────────────────────────────────────────
 Wave 1, local — ${mock ? "MOCK model (STUDY_MOCK_LLM=1): no cost; answers don't follow what you type" : `REAL model ${current.run.model}: calls cost money`}

 Participant links — open each in a private window (one arm at a time per
 browser; a new link in the same browser starts a new participant):
${ARMS.map((arm) => `   ${ARM_LABEL[arm].padEnd(24)} ${link(`local-${arm}-${stamp}`, arm)}`).join("\n")}
   ${"balanced (as on Prolific)".padEnd(24)} ${link(`local-any-${stamp}`)}

 Facilitator page (progress, exports):
   ${base}/studies/${session.id}
   sign in at ${base}/login as ${email} / ${password}

 The completion link points at example.org: the end of the study.
────────────────────────────────────────────────────────────────────────────`);

  if (flags.has("--setup-only")) return;

  // ---------------------------------------------------------------- app --
  step(`Starting the app on ${base} (Ctrl+C to stop)`);
  const child = spawn(NEXT, ["dev", "-p", String(port)], {
    cwd: APP_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
      // "test": Next reads .env.test, never .env.local; values set here win
      NODE_ENV: "test",
      STUDY_LOCAL: "1",
      LLM_MODEL_NAME: runEnv.LLM_MODEL_NAME,
      ...(mock
        ? { USE_FIXTURES: "true", FIXTURE_SCENARIO: "study-local", RECORD_FIXTURES: "" }
        : { USE_FIXTURES: "", FIXTURE_SCENARIO: "", RECORD_FIXTURES: "" }),
    },
  });
  const stop = () => child.kill("SIGINT");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (require.main === module) {
  main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
