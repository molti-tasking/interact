import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SCENARIO_FILE = path.join(FIXTURES_DIR, ".active-scenario");
const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * Set the active fixture scenario.
 * Includes a timestamp nonce so the loader detects "new test" even for the same scenario.
 */
export function setScenario(scenario: string): void {
  fs.writeFileSync(SCENARIO_FILE, `${scenario}:${Date.now()}`, "utf-8");
}

/**
 * Truncate all tables between tests for isolation.
 */
export async function resetDatabase(): Promise<void> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  await client.query(
    "TRUNCATE design_probes, responses, provenance_log, portfolios CASCADE",
  );
  await client.end();
}

/**
 * Create a new portfolio through the UI.
 * Returns the portfolio ID from the URL after redirect.
 */
export async function createPortfolio(
  page: Page,
  title: string,
): Promise<string> {
  await page.goto("/portfolios/new");
  await page.locator("#title").fill(title);
  await page.locator('[data-testid="create-portfolio-btn"]').click();
  // Wait for redirect to /portfolios/[id]
  await page.waitForURL(/\/portfolios\/[a-f0-9-]+$/);
  const url = page.url();
  const id = url.split("/portfolios/")[1];
  return id;
}

/**
 * Wait for the form preview to show fields.
 */
export async function waitForFormFields(page: Page): Promise<void> {
  await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 30000 });
  await page.locator('[data-testid^="form-field-"]').first().waitFor({ state: "visible", timeout: 30000 });
}

/**
 * Wait for design probe cards to appear.
 */
export async function waitForDesignProbes(page: Page): Promise<void> {
  await page.locator('[data-testid="card-deck-section"]').waitFor({ state: "visible", timeout: 30000 });
}

/**
 * Click a design probe option by its value.
 */
export async function resolveDesignProbe(
  page: Page,
  optionValue: string,
): Promise<void> {
  await page.locator(`[data-testid="design-probe-option-${optionValue}"]`).click();
}

/**
 * Get the current field count from the workspace page.
 */
export async function getFieldCount(page: Page): Promise<number> {
  const text = await page.locator('[data-testid="field-count"]').textContent();
  const match = text?.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}
