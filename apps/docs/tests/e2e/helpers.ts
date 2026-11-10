import { expect, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { truncateAll } from "../db";

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SCENARIO_FILE = path.join(FIXTURES_DIR, ".active-scenario");

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
  await truncateAll();
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
 * Wait for elicitation question cards to appear.
 */
export async function waitForDesignProbes(page: Page): Promise<void> {
  await page.locator('[data-testid="card-deck-section"]').waitFor({ state: "visible", timeout: 30000 });
}

/**
 * An answer that would change the form, with its preview ready — opening
 * other questions until one shows such an answer (the question on top may
 * be a standard to accept or skip, which has none).
 */
export async function changingAnswer(page: Page, timeout = 60_000): Promise<Locator> {
  const deck = page.getByTestId("card-deck-section");
  const tile = deck
    .locator('[data-testid^="deck-option-"][data-preview="ready"]')
    .filter({ has: page.getByTestId("option-diff") })
    .first();
  await expect(async () => {
    const collapsed = deck.locator('button[data-testid^="deck-card-"][aria-expanded="false"]');
    for (let i = 0; i < (await collapsed.count()) && !(await tile.isVisible()); i++) {
      await collapsed.nth(i).click();
      await page.waitForTimeout(200);
    }
    expect(await tile.isVisible()).toBe(true);
  }).toPass({ timeout });
  return tile;
}

/**
 * Get the current field count from the workspace page.
 */
export async function getFieldCount(page: Page): Promise<number> {
  const text = await page.locator('[data-testid="field-count"]').textContent();
  const match = text?.match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}
