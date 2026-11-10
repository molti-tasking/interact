/**
 * The paper's screenshots, from seeded data (no model, no fixtures to
 * record): `pnpm screenshots` writes them at 2x into `paper-figures/` at
 * the repository root.
 *
 *   teaser-*   the parts of the teaser figure
 *   s1-*       scenario 1, youth soccer registration
 *   s2-*       scenario 2, hiring a sales representative
 *   s3-*       scenario 3, orthopedic patient records
 *
 * Every screenshot is checked to be anonymous before it is written: no
 * repository link, no account or persona name in the shell, no project or
 * lab name (`ANONYMIZE`, `IDENTIFYING` in helpers.ts).
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { E2E_ADMIN, signIn } from "../auth";
import { resetDatabase, setScenario } from "../e2e/helpers";
import { ANONYMIZE, FIGURE_DIR, IDENTIFYING, seed, visibleText } from "./helpers";
import {
  HIRING_FEEDBACK,
  HIRING_ID,
  ORTHO_ID,
  ORTHO_PHYSIO_ID,
  ORTHO_SURGEON_ID,
  PHYSIO_SCENARIO,
  SOCCER_ID,
  SOCCER_ONE_LINE,
  hiring,
  hiringHistory,
  hiringQuestions,
  ortho,
  orthoHistory,
  orthoPhysio,
  orthoSurgeon,
  soccer,
  soccerHistory,
  soccerPublished,
  soccerQuestions,
} from "./paper-scenarios";

/** Every figure the paper needs; the last test checks that all were written. */
const FIGURES = [
  "teaser-1-workspace",
  "teaser-2-question-preview",
  "teaser-3-intent-diff",
  "teaser-4-field-sheet",
  "teaser-5-decision-trail",
  "teaser-6-published-form",
  "teaser-7-derivation",
  "s1-1-one-line-intent",
  "s1-2-intent-diff",
  "s1-3-answered-questions",
  "s1-4-evolved-workspace",
  "s2-1-generate-questions",
  "s2-2-answered-questions",
  "s2-3-evolved-workspace",
  "s2-4-field-industry-background",
  "s3-1-base",
  "s3-2-surgeon",
  "s3-3-physiotherapist",
  "s3-4-derived-views-of-base",
  "s3-5-derived-from-base",
] as const;
type Figure = (typeof FIGURES)[number];

const VIEWPORT = { width: 1440, height: 900 };
/** Height of the one figure that shows a previewed field at the end of the form */
const TALL = 1240;

test.use({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "light" });

/** Write one figure: the page, or one element of it. */
async function figure(page: Page, name: Figure, target?: Locator) {
  // Nothing identifying on screen
  expect(await visibleText(page), name).not.toMatch(IDENTIFYING);
  await expect(page.locator('a[href*="github.com"]:visible')).toHaveCount(0);
  // The old term is gone from everything a reader of the figure can see
  expect(await visibleText(page), name).not.toMatch(/\bprobes?\b/i);
  const file = path.join(FIGURE_DIR, `${name}.png`);
  if (target) await target.screenshot({ path: file });
  else await page.screenshot({ path: file });
}

async function openWorkspace(page: Page, id: string) {
  await page.goto(`/portfolios/${id}`);
  await expect(page.getByTestId("form-renderer")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid^="form-field-"]').first()).toBeVisible();
  await page.mouse.move(700, 880); // off any answer: no preview on the form
}

const deck = (page: Page) => page.getByTestId("card-deck-section");

async function waitForDeck(page: Page) {
  await expect(deck(page).locator('[data-testid^="deck-option-"]').first()).toBeVisible({
    timeout: 30_000,
  });
}

async function showIntentDiff(page: Page) {
  const toggle = page.getByTestId("intent-toggle").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.getByRole("button", { name: /last change/ }).click();
  await expect(page.getByRole("button", { name: "Hide last change" })).toBeVisible();
}

async function openAnswered(page: Page) {
  await deck(page).getByText(/\d answered/).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Answered questions/ })).toBeVisible();
  return dialog;
}

test.describe.configure({ mode: "serial" });

test.describe("Paper figures", () => {
  test.setTimeout(240_000);

  test.beforeAll(() => {
    // Only the figures: the folder also holds the demo recording (video/)
    fs.mkdirSync(FIGURE_DIR, { recursive: true });
    for (const file of fs.readdirSync(FIGURE_DIR)) {
      if (file.endsWith(".png")) fs.rmSync(path.join(FIGURE_DIR, file));
    }
  });

  test.beforeEach(async ({ page, context }) => {
    await resetDatabase();
    // No model is called; background checks replay "nothing to do"
    setScenario("study-briefs");
    await context.addInitScript(ANONYMIZE);
    await signIn(page, "", E2E_ADMIN);
  });

  // =========================================================================
  // Scenario 1 and the teaser — youth soccer registration
  // =========================================================================
  test("scenario 1 and teaser: youth soccer registration", async ({ page }) => {
    // -- One line is where it starts ------------------------------------
    await page.goto("/portfolios/new");
    await page.locator("#intent").fill(SOCCER_ONE_LINE);
    await page.locator("#intent").blur();
    await figure(page, "s1-1-one-line-intent");

    // -- The portfolio after three answers ------------------------------
    await seed({
      portfolios: [soccer],
      questions: { [SOCCER_ID]: soccerQuestions },
      history: { [SOCCER_ID]: soccerHistory },
    });
    await openWorkspace(page, SOCCER_ID);
    await waitForDeck(page);
    await figure(page, "teaser-1-workspace");
    await figure(page, "s1-4-evolved-workspace");

    // One question, one of its answers previewed on the form. The answers
    // are in their stored random order; none is marked.
    const answer = deck(page).getByTestId("deck-option-youthSizes");
    await expect(answer).toHaveAttribute("data-preview", "ready");
    await expect(deck(page).locator("[data-armed]")).toHaveCount(0);
    // Taller for this one, so the field the answer would add is in view
    await page.setViewportSize({ width: VIEWPORT.width, height: TALL });
    await answer.hover();
    await expect(page.getByTestId("field-annotation").first()).toBeVisible();
    await expect(page.getByTestId("field-annotation").first()).toBeInViewport();
    await figure(page, "teaser-2-question-preview");
    await page.mouse.move(700, 880);
    await page.setViewportSize(VIEWPORT);

    // The intent, with what the last answer changed in it
    await showIntentDiff(page);
    const intentPane = page.getByTestId("reflective-conversation-pane");
    await figure(page, "teaser-3-intent-diff", intentPane);
    await figure(page, "s1-2-intent-diff");
    await page.getByRole("button", { name: "Hide last change" }).click();

    // Three answered questions — one of them "keep the form as it is"
    const answered = await openAnswered(page);
    await expect(answered.getByText("Keep the form as it is").first()).toBeVisible();
    await figure(page, "s1-3-answered-questions", answered);
    await page.keyboard.press("Escape");

    // A field's side sheet
    await page.getByTestId("form-field-medicalConditions").click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await figure(page, "teaser-4-field-sheet");
    await page.keyboard.press("Escape");

    // The decision trail
    await page.goto(`/portfolios/${SOCCER_ID}/provenance`);
    await expect(page.getByTestId("provenance-entry").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Answered an elicitation question").first()).toBeVisible();
    await figure(page, "teaser-5-decision-trail");
  });

  test("teaser: published form and derivation", async ({ page }) => {
    await seed({ portfolios: [soccerPublished], history: { [SOCCER_ID]: soccerHistory } });

    await page.goto(`/forms/${SOCCER_ID}`);
    await expect(page.getByTestId("form-renderer")).toBeVisible({ timeout: 30_000 });
    await figure(page, "teaser-6-published-form");

    await page.goto(`/portfolios/${SOCCER_ID}/derive`);
    await page
      .locator("textarea")
      .first()
      .fill(
        "A match-day list for the coach: who is the player, which age group, and whom do I call in an emergency?",
      );
    await page.locator("textarea").first().blur();
    await figure(page, "teaser-7-derivation");
  });

  // =========================================================================
  // Scenario 2 — hiring a sales representative
  // =========================================================================
  test("scenario 2: hiring a sales representative", async ({ page }) => {
    await seed({
      portfolios: [hiring],
      questions: { [HIRING_ID]: hiringQuestions },
      history: { [HIRING_ID]: hiringHistory },
    });
    await openWorkspace(page, HIRING_ID);
    await waitForDeck(page);
    await figure(page, "s2-3-evolved-workspace");

    // A colleague's feedback goes into "Generate questions"
    await deck(page).getByRole("button", { name: "New questions" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Generate questions" })).toBeVisible();
    await dialog.getByTestId("external-prompt-input").fill(HIRING_FEEDBACK);
    await dialog.getByTestId("external-prompt-input").blur();
    await figure(page, "s2-1-generate-questions");
    await page.keyboard.press("Escape");

    const answered = await openAnswered(page);
    await figure(page, "s2-2-answered-questions", answered);
    await page.keyboard.press("Escape");

    await page.getByTestId("form-field-industryBackground").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // The sheet edits the field: its label is the value of an input
    await expect
      .poll(() =>
        page
          .getByRole("dialog")
          .locator("input, textarea")
          .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value)),
      )
      .toContain("Industry Background");
    await figure(page, "s2-4-field-industry-background");
  });

  // =========================================================================
  // Scenario 3 — orthopedic patient records
  // =========================================================================
  test("scenario 3: orthopedic patient records", async ({ page }) => {
    await seed({ portfolios: [ortho, orthoSurgeon, orthoPhysio], history: orthoHistory });

    await openWorkspace(page, ORTHO_ID);
    await figure(page, "s3-1-base");
    // The base lists the views derived from it …
    const ofBase = page.getByText(/2 derived views/).locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]");
    await expect(ofBase).toContainText("Surgical planning");
    await expect(ofBase).toContainText("Rehabilitation session");
    await figure(page, "s3-4-derived-views-of-base", ofBase);

    await openWorkspace(page, ORTHO_SURGEON_ID);
    await figure(page, "s3-2-surgeon");

    await openWorkspace(page, ORTHO_PHYSIO_ID);
    await figure(page, "s3-3-physiotherapist");
    // … and a derived view says where it comes from
    const fromBase = page.getByText("Derived from").locator("xpath=ancestor::div[contains(@class,'border-dashed')][1]");
    await expect(fromBase).toContainText("Orthopedic Patient Record");
    await figure(page, "s3-5-derived-from-base", fromBase);

    // (The derivation page with the physiotherapist's request, for the text)
    await page.goto(`/portfolios/${ORTHO_ID}/derive`);
    await page.locator("textarea").first().fill(PHYSIO_SCENARIO);
  });

  // =========================================================================
  test("all figures were written, at 2x", async () => {
    const written = fs.readdirSync(FIGURE_DIR).filter((f) => f.endsWith(".png")).sort();
    expect(written).toEqual([...FIGURES].map((f) => `${f}.png`).sort());
    for (const file of written) {
      // PNG: width and height are big-endian at bytes 16 and 20
      const header = fs.readFileSync(path.join(FIGURE_DIR, file)).subarray(0, 24);
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      expect(width, file).toBeGreaterThan(600);
      // Full-page figures are the viewport at twice its size
      const element = /^(teaser-3|s1-3|s2-2|s3-4|s3-5)-/.test(file);
      if (!element) {
        const tall = file.startsWith("teaser-2-");
        expect([width, height], file).toEqual([VIEWPORT.width * 2, (tall ? TALL : VIEWPORT.height) * 2]);
      }
    }
  });
});
