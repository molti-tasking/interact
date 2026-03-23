import { expect, test } from "@playwright/test";
import {
  createPortfolio,
  getFieldCount,
  resetDatabase,
  resolveOpinion,
  setScenario,
  waitForFormFields,
  waitForOpinions,
} from "./helpers";

test.describe("Fitness Coaching Scenario", () => {
  // Increase timeout — the flow involves multiple server action round-trips
  test.setTimeout(120_000);

  test.beforeEach(async () => {
    await resetDatabase();
    setScenario("fitness-coaching");
  });

  test("full flow: create portfolio, generate form, resolve opinions", async ({
    page,
  }) => {
    // Step 1: Create portfolio
    const portfolioId = await createPortfolio(
      page,
      "Fitness Coaching Client Intake",
    );
    expect(portfolioId).toBeTruthy();

    // We should be on the workspace page
    await expect(page.locator('[data-testid="conversation-pane"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-pane"]')).toBeVisible();

    // Step 2: Enter intent and generate form
    // The intent editor is a markdown editor — we need to type into it
    const intentEditor = page.locator('[data-testid="intent-editor"]');
    await intentEditor.waitFor({ state: "visible" });

    // The markdown editor uses a textarea inside, let's click and type
    const textarea = intentEditor.locator("textarea").first();
    await textarea.click();
    await textarea.fill(
      "I want to collect intake information from new fitness coaching clients including their health history, fitness goals, and availability.",
    );

    // Click Generate Form
    await page.locator('[data-testid="generate-form-btn"]').click();

    // Step 3: Wait for form fields to appear in preview
    await waitForFormFields(page);

    // Verify initial schema has fields (7 from the fixture)
    const initialFieldCount = await getFieldCount(page);
    expect(initialFieldCount).toBeGreaterThan(0);

    // Step 4: Wait for opinion cards to appear
    await waitForOpinions(page);

    // Verify opinion cards rendered
    await expect(page.locator('[data-testid="opinion-card-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="opinion-card-1"]')).toBeVisible();

    // Step 5: Resolve opinion 1 — include nutrition
    await resolveOpinion(page, "includeNutrition");

    // Wait for the opinion card to no longer be pending (it gets resolved)
    // The field count should increase after schema update
    await page.waitForTimeout(2000); // Allow time for mutation + re-render

    const afterOpinion1 = await getFieldCount(page);
    expect(afterOpinion1).toBeGreaterThanOrEqual(initialFieldCount);

    // Step 6: Resolve opinion 2 — self-rated experience level
    // Need to wait for the second opinion to still be visible/pending
    await resolveOpinion(page, "selfRated");
    await page.waitForTimeout(2000);

    const afterOpinion2 = await getFieldCount(page);
    expect(afterOpinion2).toBeGreaterThanOrEqual(afterOpinion1);
  });
});
