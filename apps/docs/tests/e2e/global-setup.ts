import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { E2E_ADMIN } from "../auth";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SCENARIO_FILE = path.join(FIXTURES_DIR, ".active-scenario");

export default async function globalSetup() {
  // 1. Verify local Supabase is running
  try {
    execSync("npx supabase status", {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  } catch {
    console.warn(
      "\n⚠️  Local Supabase is not running. Tests that touch the DB will fail.\n" +
        "   Start it with: cd apps/docs && npx supabase start\n",
    );
  }

  // 2. Clean stale .active-scenario file
  if (fs.existsSync(SCENARIO_FILE)) {
    fs.unlinkSync(SCENARIO_FILE);
  }

  // 3. Truncate all tables for a clean slate
  try {
    const { Client } = await import("pg");
    const client = new Client({
      connectionString:
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });
    await client.connect();
    await client.query(
      "TRUNCATE design_probes, responses, provenance_log, portfolios CASCADE",
    );
    await client.end();
  } catch (err) {
    console.warn("⚠️  Could not truncate tables:", (err as Error).message);
  }

  // 4. Ensure the e2e admin account exists (the workspace requires sign-in)
  try {
    await ensureE2eAdmin();
  } catch (err) {
    console.warn("⚠️  Could not create the e2e admin:", (err as Error).message);
  }
}

/** Create `E2E_ADMIN` in local Supabase Auth and add it to `app_admins`. */
async function ensureE2eAdmin() {
  const statusEnv = execSync("npx supabase status -o env", {
    cwd: process.cwd(),
    stdio: "pipe",
  }).toString();
  const read = (key: string) =>
    statusEnv.match(new RegExp(`^${key}="?([^"\\n]+)"?$`, "m"))?.[1];
  const apiUrl = read("API_URL");
  const serviceKey = read("SERVICE_ROLE_KEY");
  if (!apiUrl || !serviceKey) throw new Error("API_URL/SERVICE_ROLE_KEY not found");

  const res = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...E2E_ADMIN, email_confirm: true }),
  });
  // 422 = already exists
  if (!res.ok && res.status !== 422) {
    throw new Error(`Auth admin API: ${res.status} ${await res.text()}`);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await client.connect();
  await client.query(
    `INSERT INTO public.app_admins (user_id)
     SELECT id FROM auth.users WHERE email = $1
     ON CONFLICT DO NOTHING`,
    [E2E_ADMIN.email],
  );
  await client.end();
}
