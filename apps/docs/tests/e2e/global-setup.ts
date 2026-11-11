import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { E2E_ADMIN } from "../auth";
import { NotOurDatabaseError, sql, truncateAll } from "../db";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SCENARIO_FILE = path.join(FIXTURES_DIR, ".active-scenario");

export default async function globalSetup() {
  // 1. Clean stale .active-scenario file
  if (fs.existsSync(SCENARIO_FILE)) {
    fs.unlinkSync(SCENARIO_FILE);
  }

  // 2. Truncate all tables for a clean slate — only in this project's
  // own database (another project's stack may hold the default ports)
  try {
    await truncateAll();
  } catch (err) {
    if (err instanceof NotOurDatabaseError) throw err;
    console.warn("⚠️  Could not truncate tables:", (err as Error).message);
  }

  // 3. Ensure the e2e admin account exists (the workspace requires sign-in)
  try {
    await ensureE2eAdmin();
  } catch (err) {
    console.warn("⚠️  Could not create the e2e admin:", (err as Error).message);
  }
}

/**
 * Create `E2E_ADMIN` in local Supabase Auth and add it to `app_admins`.
 * Also used by the study RLS integration test.
 */
export async function ensureE2eAdmin() {
  let apiUrl = process.env.E2E_SUPABASE_URL;
  let serviceKey = process.env.E2E_SERVICE_ROLE_KEY;
  if (!apiUrl || !serviceKey) {
    // The stack of supabase/config.toml
    const statusEnv = execSync("npx supabase status -o env", {
      cwd: process.cwd(),
      stdio: "pipe",
    }).toString();
    const read = (key: string) =>
      statusEnv.match(new RegExp(`^${key}="?([^"\\n]+)"?$`, "m"))?.[1];
    apiUrl = read("API_URL");
    serviceKey = read("SERVICE_ROLE_KEY");
  }
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

  await sql(
    `INSERT INTO public.app_admins (user_id)
     SELECT id FROM auth.users WHERE email = $1
     ON CONFLICT DO NOTHING`,
    [E2E_ADMIN.email],
  );
}
