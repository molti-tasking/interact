import { expect, test } from "@playwright/test";
import { E2E_ADMIN, signIn } from "../auth";
import { sql } from "../db";
import { resetDatabase, setScenario } from "./helpers";

/**
 * I6 in the browser: a published form with collected responses, and an
 * elicitation question whose answer removes a field people answered. Before
 * anything is chosen, the answer's tile — and the canvas while the answer
 * is previewed — say how many collected responses the change affects.
 *
 * Everything is seeded; no model call is made (the scenario has no
 * recordings, so background checks answer "nothing to do").
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

const SCHEMA = {
  fields: [
    textField("f-name", "name", "Name"),
    textField("f-book", "favouriteBook", "Favourite book"),
    textField("f-notes", "notes", "Anything else?"),
  ],
  groups: [],
  version: 1,
};

const RESPONSES = [
  { name: "Ada", favouriteBook: "Dune", notes: "Evenings only" },
  { name: "Ben", favouriteBook: "Emma", notes: "" },
  { name: "Cleo", favouriteBook: "", notes: "Bringing a friend" },
];

const OPTIONS = [
  {
    value: "dropNotes",
    label: "Drop the open question",
    modelPosition: 0,
    preview: {
      summary: "Removes “Anything else?”",
      schemaPatch: { removeFieldKeys: ["notes"] },
      scope: { added: [], updated: [], removed: ["notes"] },
    },
  },
  {
    value: "addGenre",
    label: "Ask for a favourite genre",
    modelPosition: 1,
    preview: {
      summary: "Adds “Favourite genre”",
      schemaPatch: {
        addFields: [{ key: "favouriteGenre", label: "Favourite genre", type: "string", required: false }],
      },
      scope: { added: ["favouriteGenre"], updated: [], removed: [] },
    },
  },
  {
    value: "keepAsIs",
    label: "Keep the form as it is",
    unchanged: true,
    modelPosition: null,
    preview: { summary: "Keeps the form as it is", schemaPatch: {} },
  },
];

test.describe("Collected responses in previews (I6)", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await resetDatabase();
    setScenario("response-impact");
    await signIn(page, "", E2E_ADMIN);
  });

  test("an answer that removes an answered field says how many responses it affects", async ({ page }) => {
    const [{ id: portfolioId }] = await sql<{ id: string }>(
      `INSERT INTO portfolios (title, intent, schema, status)
       VALUES ($1, $2, $3, 'published') RETURNING id`,
      [
        "Reading club sign-up",
        JSON.stringify({
          purpose: section("Sign-up for a neighbourhood reading club."),
          audience: section(""),
          exclusions: section(""),
          constraints: section(""),
        }),
        JSON.stringify(SCHEMA),
      ],
    );
    for (const data of RESPONSES) {
      await sql(`INSERT INTO responses (portfolio_id, data) VALUES ($1, $2)`, [
        portfolioId,
        JSON.stringify(data),
      ]);
    }
    const [{ id: questionId }] = await sql<{ id: string }>(
      `INSERT INTO design_probes
         (portfolio_id, text, layer, source, options, status, priority, preview_status)
       VALUES ($1, $2, 'dimensions', 'llm', $3, 'pending', 1, 'ready') RETURNING id`,
      [portfolioId, "Keep the open “Anything else?” question?", JSON.stringify(OPTIONS)],
    );

    await page.goto(`/portfolios/${portfolioId}`);
    const deck = page.getByTestId("card-deck-section");
    await deck.waitFor({ state: "visible", timeout: 60_000 });

    // Open the question (it may already be open)
    const drop = page.getByTestId("deck-option-dropNotes");
    await expect(async () => {
      if (!(await drop.isVisible())) {
        await page.getByTestId(`deck-card-${questionId}`).click();
      }
      await expect(drop).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // Two of the three responses answered the field this answer removes
    await expect(drop.getByTestId("option-impact")).toHaveText(
      "Affects 2 collected responses",
      { timeout: 30_000 },
    );
    await expect(drop.getByTestId("option-impact")).toHaveAttribute(
      "title",
      "Anything else?: 2 answers",
    );

    // An answer that only adds a field affects none
    await expect(
      page.getByTestId("deck-option-addGenre").getByTestId("option-impact"),
    ).toHaveCount(0);

    // Previewed on the canvas, the count is shown there too
    await drop.hover();
    await expect(page.getByTestId("probe-preview-impact")).toContainText(
      "affects 2 collected responses",
    );
  });
});
