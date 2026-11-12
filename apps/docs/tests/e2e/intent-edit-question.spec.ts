import { expect, test } from "@playwright/test";
import { E2E_ADMIN, signIn } from "../auth";
import { sql } from "../db";
import { resetDatabase, setScenario } from "./helpers";

/**
 * 1E: editing the intent of a form that has fields doesn't change the form.
 * What the edit would change is offered as the question "Apply these
 * changes from your edit?", with its preview; the form changes only when
 * that answer is chosen.
 *
 * The form is seeded; the one model call (working out what the edit
 * changes) is a hand-written fixture (tests/fixtures/intent-edit-question).
 */

const textField = (id: string, name: string, label: string) => ({
  id,
  name,
  label,
  type: { kind: "text" },
  required: false,
  constraints: [],
  origin: "system",
  tags: [],
});
const at = new Date().toISOString();
const section = (content: string) => ({ content, updatedAt: at });

test.describe("Intent edits as a question (1E)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await resetDatabase();
    setScenario("intent-edit-question");
    await signIn(page, "", E2E_ADMIN);
  });

  test("an intent edit is offered as a previewed question, and applied only when chosen", async ({ page }) => {
    const [{ id: portfolioId }] = await sql<{ id: string }>(
      `INSERT INTO portfolios (title, intent, schema) VALUES ($1, $2, $3) RETURNING id`,
      [
        "Reading club sign-up",
        JSON.stringify({
          purpose: section("Sign-up for a neighbourhood reading club."),
          audience: section(""),
          exclusions: section(""),
          constraints: section(""),
        }),
        JSON.stringify({
          fields: [textField("f-name", "name", "Name"), textField("f-book", "favouriteBook", "Favourite book")],
          groups: [],
          version: 1,
        }),
      ],
    );

    await page.goto(`/portfolios/${portfolioId}`);
    // A form with fields shows its intent collapsed: open it
    const toggle = page.getByTestId("intent-toggle");
    const editor = page.locator('[data-testid="intent-editor"] textarea').first();
    await expect(toggle.or(editor)).toBeVisible({ timeout: 60_000 });
    if (await toggle.isVisible()) await toggle.click();
    await editor.click();
    await editor.fill("Sign-up for a neighbourhood reading club for pupils. Ask which school they go to.");
    await page.getByTestId("generate-form-btn").click();

    // The edit's changes come as a question; the form is unchanged so far
    const deck = page.getByTestId("card-deck-section");
    await expect(deck.getByText("Apply these changes from your edit?")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("form-field-school")).toHaveCount(0);

    const [{ id: questionId }] = await sql<{ id: string }>(
      `SELECT id FROM design_probes WHERE portfolio_id = $1 AND source = 'intent-edit'`,
      [portfolioId],
    );
    const apply = page.getByTestId("deck-option-applyEdit");
    const collapsed = page.locator(
      `button[data-testid="deck-card-${questionId}"][aria-expanded="false"]`,
    );
    await expect(async () => {
      if (await collapsed.isVisible()) await collapsed.click();
      await expect(apply).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    await expect(apply.getByTestId("option-diff")).toContainText("School");
    await expect(page.getByTestId("deck-option-keepForm")).toBeVisible();

    // Chosen from its preview: now the form changes, logged as an answer
    await apply.click();
    await expect(page.getByTestId("form-field-school")).toBeVisible({ timeout: 30_000 });
    const history = await sql<{ action: string; rationale: string }>(
      `SELECT action, rationale FROM provenance_log WHERE portfolio_id = $1 ORDER BY created_at`,
      [portfolioId],
    );
    expect(history.map((h) => h.action)).toEqual(["intent_updated", "design_probe_resolved"]);
    expect(history[1].rationale).toContain("Apply these changes from your edit?");
  });
});
