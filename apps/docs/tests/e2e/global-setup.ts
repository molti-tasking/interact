import { execSync } from "child_process";
import fs from "fs";
import path from "path";

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
      "TRUNCATE responses, provenance_log, portfolios CASCADE",
    );
    await client.end();
  } catch (err) {
    console.warn("⚠️  Could not truncate tables:", (err as Error).message);
  }
}
