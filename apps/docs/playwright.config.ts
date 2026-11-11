import { defineConfig, devices } from "@playwright/test";

/**
 * Browser suites: e2e (recorded fixtures, no live model), the paper's
 * screenshots, and the demo recording.
 *
 * They run against the Supabase stack of supabase/config.toml by default.
 * To use a stack of your own on other ports (see tests/README.md, "An
 * isolated stack"), set:
 *
 *   E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY, E2E_SERVICE_ROLE_KEY, E2E_DB_URL
 *   E2E_PORT  port of the app under test (default 3000)
 *
 * RECORD_FIXTURES=true records instead of replaying: the app then calls the
 * live model with the settings of .env.local.
 */
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;
const recording = process.env.RECORD_FIXTURES === "true";

const supabase: Record<string, string> = {};
if (process.env.E2E_SUPABASE_URL) supabase.NEXT_PUBLIC_SUPABASE_URL = process.env.E2E_SUPABASE_URL;
if (process.env.E2E_SUPABASE_ANON_KEY) {
  supabase.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY;
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testDir: "./tests/e2e",
    },
    {
      name: "screenshots",
      // The paper's figures: 2x, so they stay sharp in print
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      },
      testDir: "./tests/screenshots",
    },
    {
      // The scripted demo recording (pnpm demo:record): not part of a test run
      name: "demo",
      use: { ...devices["Desktop Chrome"] },
      testDir: "./tests/demo",
    },
  ],
  webServer: {
    command: `npx next dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Replay runs as "test" (Next then ignores .env.local: no model
      // settings, no keys). A recording needs .env.local for the model.
      ...(recording ? { RECORD_FIXTURES: "true" } : { USE_FIXTURES: "true", NODE_ENV: "test" }),
      // Reproducible answer order (a study never sets this)
      NEXT_PUBLIC_OPTION_ORDER_SEED: "fixtures",
      // A briefs session only opens with these set explicitly. Replay calls
      // no model; a recording uses the real one from .env.local.
      ...(recording ? {} : { LLM_MODEL_NAME: "recorded-fixtures" }),
      PROBE_STRATEGY: "committee",
      PROBE_COMMITTEE_SIZE: "4",
      ...supabase,
    },
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
});
