import { expect, test } from "@playwright/test";
import { E2E_ADMIN, signIn } from "../auth";
import {
  changingAnswer,
  createPortfolio,
  getFieldCount,
  resetDatabase,
  setScenario,
  waitForFormFields,
} from "./helpers";

/**
 * The designer's workspace, start to finish: a form from one description,
 * elicitation questions with previewed answers, a typed answer, and asking
 * an answered question again.
 *
 * Model calls are replayed from tests/fixtures/designer-workspace. To record
 * them again with the live model:
 *   RECORD_FIXTURES=true playwright test designer-workspace
 *   → tests/fixtures/_recording-session/designer-workspace/
 */

const RECORDING = process.env.RECORD_FIXTURES === "true";
const AI = RECORDING ? 240_000 : 60_000;
const OWN_ANSWER = "Only ask whether they have an injury we should know about";

test.describe("Designer workspace", () => {
  test.setTimeout(RECORDING ? 900_000 : 240_000);

  test.beforeEach(async ({ page }) => {
    await resetDatabase();
    setScenario("designer-workspace");
    await signIn(page, "", E2E_ADMIN);
  });

  test("describe, generate, answer elicitation questions with previews", async ({ page }) => {
    const portfolioId = await createPortfolio(page, "Fitness Coaching Client Intake");
    expect(portfolioId).toBeTruthy();
    await expect(page.locator('[data-testid="reflective-conversation-pane"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-pane"]')).toBeVisible();

    // The intent, then the first form
    const textarea = page.locator('[data-testid="intent-editor"] textarea').first();
    await textarea.click();
    await textarea.fill(
      "I want to collect intake information from new fitness coaching clients including their health history, fitness goals, and availability.",
    );
    await page.locator('[data-testid="generate-form-btn"]').click();
    await waitForFormFields(page);
    const initial = await getFieldCount(page);
    expect(initial).toBeGreaterThan(0);

    // Elicitation questions: answers with previews, one that keeps the form,
    // the free-text answer, nothing marked or selected
    const deck = page.getByTestId("card-deck-section");
    await expect(deck.getByRole("heading", { name: /Elicitation questions/ })).toBeVisible();
    // (A detected standard may be on top: a question to accept or skip it)
    const first = await changingAnswer(page, AI);
    await expect(deck.getByText("No form change")).toHaveCount(1);
    await expect(deck.getByTestId("own-answer-open")).toBeVisible();
    await expect(deck.locator("[data-armed]")).toHaveCount(0);
    expect(await deck.locator('[data-testid^="deck-card-"]').count()).toBeGreaterThanOrEqual(2);

    // 1. A suggested answer: previewed on the form while hovered, then applied
    await first.hover();
    await expect(page.getByTestId("field-annotation").first()).toBeVisible();
    await expect(page.getByTestId("probe-preview-notice")).toBeVisible();
    // Nothing is committed by looking
    expect(await getFieldCount(page)).toBe(initial);
    await first.click();
    await expect(page.getByText(/^Applied: /).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => getFieldCount(page), { timeout: 20_000 }).not.toBe(initial);
    const afterFirst = await getFieldCount(page);

    // 2. A typed answer: its preview first, then applied by choosing it
    await expect(deck.getByTestId("own-answer-open")).toBeVisible({ timeout: 20_000 });
    await deck.getByTestId("own-answer-open").click();
    await page.getByTestId("own-answer-input").fill(OWN_ANSWER);
    await page.getByTestId("own-answer-preview").click();
    const own = deck.getByTestId("deck-option-own");
    await expect(own).toBeVisible({ timeout: AI });
    await expect(own).toHaveAttribute("data-armed", "preview");
    await expect(own).toContainText("Choose it again to apply");
    // Still not applied
    expect(await getFieldCount(page)).toBe(afterFirst);
    await own.click();
    await expect(page.getByText(`Applied: "${OWN_ANSWER}"`).first()).toBeVisible({ timeout: 30_000 });

    // 3. The answers are on record, and an answered question can be asked again
    await deck.getByText(/2 answered/).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Answered questions (2)" })).toBeVisible();
    await expect(dialog.getByText(OWN_ANSWER)).toBeVisible();
    const fieldsBefore = await getFieldCount(page);
    await dialog.getByRole("button", { name: "Ask again" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(deck.getByText(/1 answered/)).toBeVisible();
    // Asking again changes nothing by itself
    expect(await getFieldCount(page)).toBe(fieldsBefore);

    // The history names who decided, and why, for every change to the form
    await page.goto(`/portfolios/${portfolioId}/provenance`);
    await expect(page.getByTestId("provenance-entry").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Answered an elicitation question").first()).toBeVisible();
    await expect(page.getByText("Generated the form from the intent")).toBeVisible();
  });
});
