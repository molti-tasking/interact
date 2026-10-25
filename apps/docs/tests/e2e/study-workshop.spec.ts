import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "fs";
import { E2E_ADMIN, signIn } from "../auth";

/**
 * Study mode: a whole workshop with a facilitator and three participants in
 * separate browser contexts. Forms are seeded in the database so the run
 * doesn't depend on the LLM; the refine loop (answers → design probe →
 * apply) is deterministic.
 */

const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

const NAMES = ["Ana", "Ben", "Cleo"];

function hobbySchema(name: string) {
  const field = (id: string, label: string, type: object, required: boolean) => ({
    id,
    name: id,
    label,
    type,
    required,
    constraints: [],
    origin: "creator",
    tags: [],
  });
  return {
    version: 1,
    groups: [],
    fields: [
      field(
        "frequency",
        `How often do you do ${name}'s hobby?`,
        {
          kind: "select",
          multiple: false,
          options: ["Daily", "Weekly", "Monthly", "Rarely"].map((o) => ({
            label: o,
            value: o.toLowerCase(),
          })),
        },
        true,
      ),
      field("nickname", "Club nickname", { kind: "text", maxLength: 80 }, false),
    ],
  };
}

async function participant(browser: Browser, code: string, name: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/join?code=${code}`);
  await page.locator("#join-name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
  await page.waitForURL(/\/study\/[0-9a-f-]{36}/);
  return page;
}

async function advance(admin: Page, to: string) {
  await admin.getByTestId("advance-phase").click();
  await admin.getByRole("button", { name: "Move everyone" }).click();
  await expect(admin.getByRole("button", { name: "Move everyone" })).toBeHidden();
  await expect(admin.getByText(`${to} —`, { exact: false }).first()).toBeVisible();
}

async function closeTour(page: Page) {
  const close = page.locator(".driver-popover-close-btn");
  if (await close.isVisible().catch(() => false)) await close.click();
}

test.describe("Study mode workshop", () => {
  test.setTimeout(180_000);
  let sessionId: string | undefined;

  test.afterEach(async () => {
    if (!sessionId) return;
    const rows = await sql<{ portfolio_id: string; user_id: string }>(
      "SELECT portfolio_id, user_id FROM study_participants WHERE session_id = $1",
      [sessionId],
    );
    const [{ space_id }] = await sql<{ space_id: string }>(
      "SELECT space_id FROM study_sessions WHERE id = $1",
      [sessionId],
    );
    await sql("DELETE FROM study_snapshots WHERE session_id = $1", [sessionId]);
    await sql("DELETE FROM study_sessions WHERE id = $1", [sessionId]);
    await sql("DELETE FROM portfolios WHERE id = ANY($1::uuid[])", [rows.map((r) => r.portfolio_id)]);
    await sql("DELETE FROM spaces WHERE id = $1", [space_id]);
    await sql("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [rows.map((r) => r.user_id)]);
    sessionId = undefined;
  });

  test("join → create → answer → refine → questionnaire → export", async ({
    browser,
    page: admin,
  }) => {
    // --- Facilitator creates a session ---------------------------------
    await signIn(admin, "", E2E_ADMIN);
    await admin.goto("/studies");
    await admin.locator("#session-name").fill(`e2e workshop ${Date.now()}`);
    // Three participants → two answers per form: suggestions from two
    await admin.locator("#findings-min").fill("2");
    await admin.getByRole("button", { name: "Create session" }).click();
    await admin.waitForURL(/\/studies\/[0-9a-f-]{36}$/);
    sessionId = admin.url().split("/studies/")[1];
    const code = (await admin.locator("span.font-mono").first().innerText()).trim();

    // --- Participants join ------------------------------------------------
    const pages: Record<string, Page> = {};
    for (const name of NAMES) pages[name] = await participant(browser, code, name);
    const ana = pages.Ana;
    await expect(ana.getByText("3 people have joined")).toBeVisible();

    // Participants are kept to the study pages
    await ana.goto("/portfolios");
    await expect(ana).toHaveURL(/\/join$/);
    await ana.goto(`/study/${sessionId}`);

    // Seed each form (instead of generating it with the LLM)
    for (const name of NAMES) {
      await sql(
        `UPDATE portfolios SET title = $1, schema = $2::jsonb,
           intent = jsonb_set(intent, '{purpose,content}', to_jsonb($3::text))
         WHERE id = (SELECT portfolio_id FROM study_participants
                     WHERE session_id = $4 AND display_name = $5)`,
        [`${name}'s hobby`, JSON.stringify(hobbySchema(name)), `About ${name}'s hobby.`, sessionId, name],
      );
    }

    // --- Create: the restricted workspace ---------------------------------
    await advance(admin, "Create");
    await expect(ana.getByTestId("preview-pane")).toBeVisible();
    await closeTour(ana);
    // No publishing, deriving or voice for participants
    await expect(ana.getByRole("link", { name: /Derive variant/ })).toHaveCount(0);
    await expect(ana.getByRole("button", { name: /Publish/ })).toHaveCount(0);

    // --- Answer: everyone answers every other form ------------------------
    await advance(admin, "Answer");
    for (const name of NAMES) {
      const page = pages[name];
      await closeTour(page);
      for (let i = 1; i <= 2; i++) {
        await page.locator('[data-testid="peer-form-card"]:not([disabled])').first().click();
        await page.getByRole("combobox").first().click();
        await page.getByRole("option", { name: "Weekly" }).click();
        await page.getByTestId("form-submit-btn").click();
        await expect(page.getByText(`${i} of 2 answered`)).toBeVisible();
      }
      // Answered forms can't be sent again
      await expect(page.locator('[data-testid="peer-form-card"]:not([disabled])')).toHaveCount(0);
    }

    // --- Refine ---------------------------------------------------------------
    await advance(admin, "Refine");
    const answers = ana.getByTestId("answers-panel");
    await expect(answers).toContainText("Answers to your form (2)");
    await closeTour(ana);
    // No dashboard: the answers come as a table or one respondent at a time
    await expect(ana.getByTestId("responses-dashboard")).toHaveCount(0);
    await expect(answers.getByTestId("answers-table")).toContainText(/weekly/i);
    await answers.getByTestId("answers-mode-cards").click();
    await expect(answers.getByText("Answer 1 of 2")).toBeVisible();
    await expect(answers.getByTestId("answer-detail")).toContainText(/weekly/i);
    await answers.getByTestId("answers-next").click();
    await expect(answers.getByText("Answer 2 of 2")).toBeVisible();
    // On the form: each question shows its number of answers
    await expect(ana.getByTestId("field-insight-badge").first()).toContainText("2 answers");
    // Patterns in the answers arrive as design probes ("nobody picks Daily")
    await expect(
      ana.locator('[data-testid^="deck-card-"]', { hasText: 'Remove "Daily"' }).first(),
    ).toBeVisible();
    await ana.getByTestId("mark-ready").click();
    await expect(ana.getByText("Marked as ready.")).toBeVisible();

    const [before] = await sql<{ revision: number }>(
      `SELECT revision FROM portfolios WHERE id =
         (SELECT portfolio_id FROM study_participants WHERE session_id = $1 AND display_name = 'Ana')`,
      [sessionId],
    );
    // Refine in the same workspace as in Create: nobody picked "Daily"
    await ana.getByRole("button", { name: /^Edit field How often/ }).click();
    await ana.getByLabel("Options (one per line)").fill("Weekly\nMonthly\nRarely");
    await ana.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(async () => {
        const [row] = await sql<{ revision: number; actors: string[] }>(
          `SELECT p.revision, ARRAY(SELECT DISTINCT actor FROM provenance_log l
                                    WHERE l.portfolio_id = p.id) AS actors
           FROM portfolios p WHERE p.id =
             (SELECT portfolio_id FROM study_participants WHERE session_id = $1 AND display_name = 'Ana')`,
          [sessionId],
        );
        return row.revision > before.revision && row.actors.includes("Ana (Participant)");
      }, { timeout: 20_000 })
      .toBe(true);

    // --- Questionnaire --------------------------------------------------------
    await advance(admin, "Reflect");
    await expect(ana.getByText("How did it go?")).toBeVisible();
    for (let pageIndex = 0; pageIndex < 6; pageIndex++) {
      for (const group of await ana.getByRole("radiogroup").all()) {
        await group.locator('input[type="radio"]').nth(3).check({ force: true });
      }
      for (const textarea of await ana.locator("textarea:visible").all()) {
        await textarea.fill("The answers showed my options were too coarse.");
      }
      const next = ana.getByTestId("page-next");
      if (!(await next.isVisible())) break;
      await next.click();
    }
    await ana.getByTestId("form-submit-btn").click();
    await expect(ana.getByText("your answers are saved")).toBeVisible();

    // Interaction events are sent in batches about a second after they happen
    await expect
      .poll(async () =>
        (await sql(
          "SELECT 1 FROM study_events WHERE session_id = $1 AND type = 'questionnaire_submitted'",
          [sessionId],
        )).length,
      )
      .toBe(1);

    // --- Done + export ----------------------------------------------------------
    await advance(admin, "Done");
    await expect(ana.getByText("Thank you, Ana!")).toBeVisible();
    const [download] = await Promise.all([
      admin.waitForEvent("download"),
      admin.getByRole("button", { name: "Everything (JSON)" }).click(),
    ]);
    const data = JSON.parse(fs.readFileSync((await download.path())!, "utf-8"));
    expect(data.participants).toHaveLength(3);
    expect(data.responses).toHaveLength(6);
    expect(data.snapshots.map((s: { label: string }) => s.label).sort()).toEqual([
      "end_of_create",
      "end_of_create",
      "end_of_create",
      "end_of_review",
      "end_of_review",
      "end_of_review",
    ]);
    expect(data.questionnaires).toHaveLength(1);
    const types = new Set(data.events.map((e: { type: string }) => e.type));
    for (const type of ["joined", "phase_changed", "peer_form_submitted", "finding_sent_to_design", "probe_answered", "questionnaire_submitted"]) {
      expect(types, type).toContain(type);
    }
  });
});
