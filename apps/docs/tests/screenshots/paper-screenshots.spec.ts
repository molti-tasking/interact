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
  RENTAL_PORTFOLIO_ID,
  rentalPortfolio,
  rentalDesignProbes,
  rentalProvenance,
  orthoBasePortfolio,
  orthoSurgeonPortfolio,
  orthoPatientPortfolio,
  orthoBaseFields,
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
  // Scenario 1: Construction Machine Rental (Section 5.1)
  // =========================================================================
  test("scenario 1 — construction machine rental", async ({ page }) => {
    await resetDatabase();

    await seedPortfolio(rentalPortfolio);
    await seedDesignProbes(RENTAL_PORTFOLIO_ID, rentalDesignProbes);

    // Screenshot 1a: Workspace with design probes
    await page.goto(`/portfolios/${RENTAL_PORTFOLIO_ID}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1500);
    await cropScreenshot(page, "scenario1-a-workspace.png");

    // Seed provenance for next screenshot
    await seedProvenance(RENTAL_PORTFOLIO_ID, rentalProvenance);

    // Screenshot 1b: Provenance timeline
    await page.goto(`/portfolios/${RENTAL_PORTFOLIO_ID}/provenance`);
    await page.locator("text=Provenance Timeline").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".space-y-3 .p-4").first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(500);
    await cropScreenshot(page, "scenario1-b-provenance.png");

    // Screenshot 1c: Derive page (Dwight's delivery sub-schema)
    await page.goto(`/portfolios/${RENTAL_PORTFOLIO_ID}/derive`);
    await page.locator("text=Derive a New Sub Schema").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#scenario").fill(
      "I just need the delivery info \u2014 machine identifier, delivery address, site access restrictions, and delivery time window.",
    );
    await page.waitForTimeout(500);
    await cropScreenshot(page, "scenario1-c-derive.png");
  });

  // =========================================================================
  // Scenario 2: Fitness Coaching (Section 5.2)
  // =========================================================================
  test("scenario 2 — fitness coaching", async ({ page }) => {
    await resetDatabase();
    setScenario("fitness-coaching");

    const portfolioId = await createPortfolio(page, "Fitness Coaching Client Intake");
    expect(portfolioId).toBeTruthy();

    const textarea = page.locator('[data-testid="intent-editor"] textarea').first();
    await textarea.click();
    await textarea.fill(
      "I want to collect patient intake information from new fitness coaching clients including their medical history, health conditions, fitness goals, and availability.",
    );
    await page.locator('[data-testid="generate-form-btn"]').click();

    await waitForFormFields(page);
    await waitForDesignProbes(page);
    await page.waitForTimeout(3000); // wait for FHIR standard probe

    // Screenshot 2a: Workspace with probes + FHIR standard
    await cropScreenshot(page, "scenario2-a-workspace.png");

    // Resolve both design probes
    await page.locator('[data-testid="deck-option-includeNutrition"]').click();
    await page.waitForTimeout(2000);
    await page.locator('[data-testid="deck-option-selfRated"]').click();
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
  // Scenario 3: Orthopedic Patient Records (Section 5.3)
  // =========================================================================
  test("scenario 3 — orthopedic patient records", async ({ page }) => {
    await resetDatabase();

    await seedPortfolio(orthoBasePortfolio);
    await seedProvenance(orthoBasePortfolio.id, [
      { layer: "intent", action: "intent_updated", actor: "creator", rationale: "Sections changed: purpose, audience" },
      { layer: "configuration", action: "schema_generated", actor: "system", rationale: "Generated 15 fields from intent", diff: { added: orthoBaseFields.map(f => ({ name: f.name })), removed: [], modified: [] } },
    ]);

    // Screenshot 3a: Base schema workspace
    await page.goto(`/portfolios/${orthoBasePortfolio.id}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    await cropScreenshot(page, "scenario3-a-base.png");

    // Seed derived portfolios
    await seedPortfolio(orthoSurgeonPortfolio);
    await seedPortfolio(orthoPatientPortfolio);

    // Screenshot 3b: Surgeon super-schema (19 fields, "Derived" badge)
    await page.goto(`/portfolios/${orthoSurgeonPortfolio.id}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    await cropScreenshot(page, "scenario3-b-surgeon.png");

    // Screenshot 3c: Patient portal sub-schema (8 fields, "Derived" badge)
    await page.goto(`/portfolios/${orthoPatientPortfolio.id}`);
    await page.locator('[data-testid="form-renderer"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1000);
    await cropScreenshot(page, "scenario3-c-patient.png");
  });
});
