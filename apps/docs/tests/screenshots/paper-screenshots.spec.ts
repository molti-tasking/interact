/**
 * Paper screenshot automation for the UIST'26 Malleable Forms paper.
 *
 * Generates 9 screenshots (3 per scenario) that illustrate the system
 * walkthroughs described in Section 5 of the paper.
 *
 * Run:  pnpm screenshots
 * Copy: pnpm screenshots:paper
 */

import { test, expect } from "@playwright/test";
import {
  createPortfolio,
  resetDatabase,
  setScenario,
  waitForFormFields,
  waitForDesignProbes,
} from "../e2e/helpers";
import fs from "fs";
import {
  SCREENSHOT_DIR,
  cropScreenshot,
  seedPortfolio,
  seedDesignProbes,
  seedProvenance,
} from "./helpers";
import {
  ORDER_PORTFOLIO_ID,
  orderPortfolio,
  orderDesignProbes,
  orderProvenance,
  orderDwightPortfolio,
  qbrBasePortfolio,
  qbrBaseFields,
  qbrSalesPortfolio,
  qbrCorporatePortfolio,
} from "./scenarios";

test.use({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});

test.describe("Paper Screenshots", () => {
  test.setTimeout(240_000);

  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  // =========================================================================
  // Scenario 1: Paper Wholesaler Order Form (Episode 1)
  // =========================================================================
  test("scenario 1 — paper wholesaler order form", async ({ page }) => {
    await resetDatabase();

    await seedPortfolio(orderPortfolio);
    await seedDesignProbes(ORDER_PORTFOLIO_ID, orderDesignProbes);

    // Screenshot 1a: Workspace with GS1 standard detection probe
    await page.goto(`/portfolios/${ORDER_PORTFOLIO_ID}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1500);
    await cropScreenshot(page, "scenario1-a-workspace.png");

    // Seed provenance for next screenshot
    await seedProvenance(ORDER_PORTFOLIO_ID, orderProvenance);

    // Screenshot 1b: Provenance timeline showing multi-role edits
    await page.goto(`/portfolios/${ORDER_PORTFOLIO_ID}/provenance`);
    await page.locator("text=Provenance Timeline").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".space-y-3 .p-4").first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);
    await cropScreenshot(page, "scenario1-b-provenance.png");

    // Screenshot 1c: Derive page (Dwight's quick order capture sub-schema)
    await page.goto(`/portfolios/${ORDER_PORTFOLIO_ID}/derive`);
    await page.locator("text=Derive a New Sub Schema").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#scenario").fill(
      "I just need a quick order capture for client visits — client name, product selection, quantity, and delivery date.",
    );
    await page.waitForTimeout(500);
    await cropScreenshot(page, "scenario1-c-derive.png");
  });

  // =========================================================================
  // Scenario 2: Sales Rep Hiring (Episode 2)
  // =========================================================================
  test("scenario 2 — sales rep hiring", async ({ page }) => {
    await resetDatabase();
    setScenario("sales-rep-hiring");

    const portfolioId = await createPortfolio(page, "Job Application — Sales Representative");
    expect(portfolioId).toBeTruthy();

    const textarea = page.locator('[data-testid="intent-editor"] textarea').first();
    await textarea.click();
    await textarea.fill(
      "I need a job application form for a new sales representative. We want to capture applicant details, experience, and skills relevant to outside sales in our paper and office supply wholesale business.",
    );
    await page.locator('[data-testid="generate-form-btn"]').click();

    await waitForFormFields(page);
    await waitForDesignProbes(page);
    await page.waitForTimeout(3000); // wait for Schema.org/JobPosting standard probe

    // Screenshot 2a: Workspace with probes + Schema.org/JobPosting standard
    await cropScreenshot(page, "scenario2-a-workspace.png");

    // Resolve design probes
    await page.locator('[data-testid^="deck-option-"]').first().click();
    await page.waitForTimeout(2000);
    await page.locator('[data-testid^="deck-option-"]').first().click();
    await page.waitForTimeout(2000);

    // Screenshot 2b: Workspace after probes resolved
    await cropScreenshot(page, "scenario2-b-resolved.png");

    // Screenshot 2c: Published form
    await page.goto(`/forms/${portfolioId}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);
    await cropScreenshot(page, "scenario2-c-published.png");
  });

  // =========================================================================
  // Scenario 3: Quarterly Business Review (Episode 3)
  // =========================================================================
  test("scenario 3 — quarterly business review", async ({ page }) => {
    await resetDatabase();

    await seedPortfolio(qbrBasePortfolio);
    await seedProvenance(qbrBasePortfolio.id, [
      { layer: "intent", action: "intent_updated", actor: "Michael (Regional Manager)", rationale: "Sections changed: purpose, audience" },
      { layer: "configuration", action: "schema_generated", actor: "system", rationale: "Generated 7 fields from intent: client data, revenue, delivery, inventory, expenses, activity logs", diff: { added: qbrBaseFields.map(f => ({ name: f.name })), removed: [], modified: [] } },
    ]);

    // Screenshot 3a: Base QBR schema workspace
    await page.goto(`/portfolios/${qbrBasePortfolio.id}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    await cropScreenshot(page, "scenario3-a-base.png");

    // Seed derived portfolios
    await seedPortfolio(qbrSalesPortfolio);
    await seedPortfolio(qbrCorporatePortfolio);

    // Screenshot 3b: Dwight's sales performance view (mixed derivation)
    await page.goto(`/portfolios/${qbrSalesPortfolio.id}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    await cropScreenshot(page, "scenario3-b-sales.png");

    // Screenshot 3c: Jan's corporate oversight view (super derivation)
    await page.goto(`/portfolios/${qbrCorporatePortfolio.id}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    await cropScreenshot(page, "scenario3-c-corporate.png");
  });
});
