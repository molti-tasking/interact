/**
 * The database the browser-driven suites (e2e, screenshots, video) and the
 * integration tests work on. They TRUNCATE tables, so they only ever touch a
 * database that carries this project's schema:
 *
 *   E2E_DB_URL            postgres connection string
 *                         (default: the local stack of supabase/config.toml)
 *   E2E_SUPABASE_URL      API URL of the same stack
 *   E2E_SUPABASE_ANON_KEY its anon key
 *   E2E_SERVICE_ROLE_KEY  its service-role key (to create the test admin)
 *
 * The default ports (54321/54322) are Supabase's defaults: another
 * project's stack may be listening there. `connectOwnDatabase` refuses a
 * database that doesn't look like this project's before anything is
 * deleted. To run on a stack of your own on other ports, see
 * tests/README.md ("An isolated stack").
 */
import { Client } from "pg";

export const TEST_DB_URL =
  process.env.E2E_DB_URL ??
  process.env.SUPABASE_TEST_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/** Tables only this project has, from its first migration to its latest. */
const OWN_TABLES = [
  "portfolios",
  "provenance_log",
  "design_probes",
  "study_sessions",
  "study_progress",
  "study_tasks",
];

export class NotOurDatabaseError extends Error {
  constructor(missing: string[]) {
    super(
      `The database at ${TEST_DB_URL.replace(/\/\/[^@]*@/, "//")} is not this project's ` +
        `(missing: ${missing.join(", ")}). Nothing was changed. Start this project's ` +
        `stack, or point E2E_DB_URL at it (tests/README.md, "An isolated stack").`,
    );
    this.name = "NotOurDatabaseError";
  }
}

/** A connection to the test database, after checking it is this project's. */
export async function connectOwnDatabase(): Promise<Client> {
  const client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ name: string; found: boolean }>(
      `SELECT t.name, to_regclass('public.' || t.name) IS NOT NULL AS found
       FROM unnest($1::text[]) AS t(name)`,
      [OWN_TABLES],
    );
    const missing = rows.filter((r) => !r.found).map((r) => r.name);
    if (missing.length) throw new NotOurDatabaseError(missing);
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

/** Run one statement on the test database (checked first). */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = await connectOwnDatabase();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Empty the tables the suites write to. CASCADE also clears the study tables. */
export async function truncateAll(): Promise<void> {
  await sql("TRUNCATE design_probes, responses, provenance_log, portfolios, study_sessions CASCADE");
}
