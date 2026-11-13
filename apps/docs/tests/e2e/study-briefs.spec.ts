import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import { E2E_ADMIN, signIn } from "../auth";
import { sql } from "../db";
import { resetDatabase, setScenario } from "./helpers";

/**
 * The self-paced briefs study (the Prolific study), from the study link to
 * the completion redirect, once per condition (full, assistant, the silent
 * baseline):
 *
 *   researcher  creates a session with one condition, sets the completion
 *               URL, opens it (the server records what it runs with)
 *   participant consent → intro → [situation → build → ratings → recall →
 *               why → quiz] × 2 → questionnaire → completion link
 *
 * Model calls are replayed from tests/fixtures/study-briefs (matched by the
 * text they are about, so the order of the situations doesn't matter). The
 * assistant's four turns are hand-written in the recordings' format (marked
 * `handWritten`) until they are recorded. To record them again with the
 * live model:
 *
 *   RECORD_FIXTURES=true playwright test study-briefs
 *   → tests/fixtures/_recording-session/study-briefs/
 */

const SCENARIO = "study-briefs";
const RECORDING = process.env.RECORD_FIXTURES === "true";
/** The live model is slower than a replay */
const AI = RECORDING ? 240_000 : 60_000;
const COMPLETION_URL = "https://app.prolific.com/submissions/complete?cc=E2ECODE";

const DESCRIPTIONS: Record<string, string> = {
  camp: "A sign-up form for parents for our football club's holiday week for kids aged 6 to 12 in August. The coaches need to know about the children before the week starts.",
  foster:
    "An application form for people who want to foster a cat from our small cat rescue for a few weeks, so volunteers can match cats and homes.",
};

/** Baseline: one change request per situation (a different one each, so the replay can tell them apart) */
const REQUESTS: Record<string, string> = {
  camp: "Add a required question about allergies or dietary requirements.",
  foster: "Add a question about other animals in the household.",
};

/** Assistant: the participant's reply to its first answer, per situation */
const ASSISTANT_ANSWERS: Record<string, string> = {
  camp: "Parents pick the days, Monday to Friday. Yes, the coaches need allergies and someone to call in an emergency.",
  foster: "People who want to foster. Other pets matter, and whether the landlord allows cats.",
};

type Condition = "full" | "assistant" | "baseline";

async function createSession(admin: Page, condition: Condition): Promise<string> {
  await signIn(admin, "", E2E_ADMIN);
  await admin.goto("/studies");
  await admin.getByTestId("mode-briefs").click();
  await admin.getByLabel("Name").fill(`Briefs e2e (${condition})`);
  await admin.getByLabel("Email").fill("researcher@example.org");
  await admin.getByLabel("Researcher").fill("The research team");
  // One condition per session here, so the participant's condition is known
  for (const other of ["full", "no-probes", "baseline", "assistant"]) {
    const box = admin.locator(`#condition-${other}`);
    const checked = (await box.getAttribute("aria-checked")) === "true";
    if (checked !== (other === condition)) await box.click();
  }
  await admin.getByRole("button", { name: "Create session" }).click();
  await admin.waitForURL(/\/studies\/[0-9a-f-]{36}$/);
  const sessionId = admin.url().split("/").pop()!;

  // What it will run with is shown before opening, and recorded by opening
  await expect(admin.getByTestId("run-settings")).toContainText("Will run with");
  await admin.getByLabel("Completion URL (Prolific)").fill(COMPLETION_URL);
  await admin.getByRole("button", { name: "Save", exact: true }).click();
  await expect(admin.getByText("Completion URL saved")).toBeVisible();
  await admin.getByTestId("open-study").click();
  await admin.getByRole("button", { name: "Open", exact: true }).click();
  await expect(admin.getByRole("button", { name: "Pause new starts" })).toBeVisible();
  await expect(admin.getByTestId("run-settings")).toContainText("Runs with");
  await expect(admin.getByTestId("run-settings")).toContainText("committee of 4");
  return sessionId;
}

async function joinCode(sessionId: string): Promise<string> {
  const [{ join_code }] = await sql<{ join_code: string }>(
    "SELECT join_code FROM study_sessions WHERE id = $1",
    [sessionId],
  );
  return join_code;
}

/** Every item on the current questionnaire page gets an answer. */
async function answerPage(page: Page) {
  const groups = page.locator('[role="radiogroup"], fieldset');
  for (let i = 0; i < (await groups.count()); i++) {
    const group = groups.nth(i);
    const radios = group.getByRole("radio");
    const n = await radios.count();
    if (!n) continue;
    // The instructed-response item asks for "Disagree" (the second point)
    const instructed = /please select/i.test((await group.textContent()) ?? "");
    await radios.nth(instructed ? 1 : Math.min(n - 1, 3)).check({ force: true });
  }
  const areas = page.locator("textarea");
  for (let i = 0; i < (await areas.count()); i++) await areas.nth(i).fill("Seeing what would change.");
}

/**
 * The arm's tour on the first form: it opens a moment after the workspace
 * is ready, with `steps` steps; on the second form it doesn't open again.
 * An open tour dims the page and blocks clicks, so it is closed here.
 */
async function handleTour(page: Page, task: number, steps: number) {
  const popover = page.locator(".driver-popover");
  if (task === 1) {
    await expect(popover).toBeVisible({ timeout: 10_000 });
    await expect(popover.locator(".driver-popover-title")).toHaveText("Your task");
    await expect(popover.locator(".driver-popover-progress-text")).toHaveText(`1 of ${steps}`);
    await page.locator(".driver-popover-close-btn").click();
  } else {
    await page.waitForTimeout(1_500);
  }
  await expect(popover).toHaveCount(0);
  await expect(page.getByTestId("show-tour")).toBeVisible();
}

/** Ratings → recall → why, with the form hidden (new sessions, 2026-11-13). */
async function postTaskMeasures(page: Page, fields: Locator) {
  await expect(page.getByRole("heading", { name: "Your form" })).toBeVisible({ timeout: 60_000 });
  await expect(fields).toHaveCount(0);
  await expect(page.getByTestId("ratings-continue")).toBeDisabled();
  await page.getByTestId("rating-know").getByRole("radio", { name: "6", exact: true }).click();
  await page.getByTestId("rating-confident").getByRole("radio", { name: "5", exact: true }).click();
  await page.getByTestId("ratings-continue").click();

  await expect(page.getByRole("heading", { name: "What your form asks" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("recall-continue")).toBeDisabled();
  await page.getByTestId("recall-input").fill("The child's or applicant's name\n\nA phone number\n");
  await page.getByTestId("recall-continue").click();

  await expect(page.getByRole("heading", { name: "Why your form asks this" })).toBeVisible({ timeout: 30_000 });
  const items = page.getByTestId("why-item");
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThanOrEqual(3);
  await expect(page.getByTestId("why-continue")).toBeDisabled();
  for (let i = 0; i < n; i++) await items.nth(i).locator("textarea").fill("So the volunteers know before the start.");
  await page.getByTestId("why-continue").click();
}

/** Seconds per step of the one participant in a session, by the server's clock. */
async function stepTimes(sessionId: string): Promise<{ step: string; seconds: number }[]> {
  const rows = await sql<{ step: string; at: Date }>(
    `SELECT CASE WHEN type = 'joined' THEN 'consent' ELSE phase END AS step, created_at AS at
     FROM study_events WHERE session_id = $1 AND type IN ('joined', 'step_entered') ORDER BY id`,
    [sessionId],
  );
  return rows.slice(0, -1).map((row, i) => ({
    step: row.step,
    seconds: Math.round((new Date(rows[i + 1].at).getTime() - new Date(row.at).getTime()) / 1000),
  }));
}

async function participant(
  browser: Browser,
  code: string,
  pid: string,
  condition: Condition,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // The completion link points at the panel: answer it here
  await context.route("https://app.prolific.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Prolific: submission complete</h1>" }),
  );
  const page = await context.newPage();
  // The interaction log is the study's data: a rejected write fails the run
  const rejectedLogWrites: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/rest/v1/study_events") && !response.ok()) {
      rejectedLogWrites.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/rest/v1/study_events")) {
      console.log("study_events request failed:", request.failure()?.errorText, request.postData()?.slice(0, 200));
    }
  });
  page.on("request", (request) => {
    if (process.env.DEBUG_EVENTS && request.url().includes("/rest/v1/study_events")) {
      console.log("study_events →", (request.postData() ?? "").match(/"type":"[a-z_]+"/g)?.join(","));
    }
  });

  await page.goto(`/join?code=${code}&PROLIFIC_PID=${pid}&STUDY_ID=study1&SESSION_ID=sess-${pid}`);
  await expect(page.getByRole("heading", { name: "Before you start" })).toBeVisible({ timeout: 30_000 });
  await page.locator("#consent-agree").click();
  await page.getByTestId("consent-continue").click();
  await page.getByTestId("intro-continue").click();

  for (let task = 1; task <= 2; task++) {
    // The situation is an image: its text is not in the page
    const image = page.getByTestId("brief-image");
    await expect(image).toBeVisible();
    const key = (await image.getAttribute("src"))!.split("/").pop()!;
    expect(Object.keys(DESCRIPTIONS)).toContain(key);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/landlord|nut allergy/i);
    await expect(page.getByTestId("brief-continue")).toBeEnabled({ timeout: 40_000 });
    await page.getByTestId("brief-continue").click();

    const fields = page.locator('[data-testid^="form-field-"]');
    if (condition === "assistant") {
      // No description card and no intent pane: a chat from the start, and
      // the first message is the description
      await expect(page.locator("#study-intent")).toHaveCount(0);
      const pane = page.getByTestId("assistant-pane");
      await expect(pane).toBeVisible();
      await handleTour(page, task, 3);
      await expect(page.getByTestId("card-deck-section")).toHaveCount(0);
      await expect(page.getByTestId("intent-editor")).toHaveCount(0);
      await expect(page.getByTestId("chat-edit-pane")).toHaveCount(0);
      await expect(page.getByTestId("finish-task")).toBeDisabled();
      await page.getByTestId("assistant-input").fill(DESCRIPTIONS[key]);
      await page.getByTestId("assistant-send").click();
      // (Recorded) it asks first: an answer, no form yet
      const replies = pane.getByTestId("assistant-message-assistant");
      await expect(replies).toHaveCount(1, { timeout: AI });
      await expect(fields).toHaveCount(0);
      await page.getByTestId("assistant-input").fill(ASSISTANT_ANSWERS[key]);
      await page.getByTestId("assistant-send").click();
      await expect(replies).toHaveCount(2, { timeout: AI });
      // The form updates right away, like an artifact
      await expect(pane.getByText(/Form updated: \d added/)).toBeVisible();
      await expect.poll(() => fields.count(), { timeout: 20_000 }).toBeGreaterThan(3);
    } else {
    // Describe the form; the tool drafts it
    await page.locator("#study-intent").fill(DESCRIPTIONS[key]);
    await page.getByRole("button", { name: "Create my form" }).click();
    await expect(fields.first()).toBeVisible({ timeout: AI });
    await handleTour(page, task, condition === "full" ? 4 : 3);
    const before = await fields.count();

    if (condition === "baseline") {
      // No elicitation questions, no intent pane: a chat box
      await expect(page.getByTestId("chat-edit-pane")).toBeVisible();
      await expect(page.getByTestId("card-deck-section")).toHaveCount(0);
      await expect(page.getByTestId("intent-editor")).toHaveCount(0);
      await page.getByTestId("chat-edit-input").fill(REQUESTS[key]);
      await page.getByTestId("chat-edit-send").click();
      await expect(
        page.getByTestId("chat-edit-pane").getByText(/\d added/).last(),
      ).toBeVisible({ timeout: AI });
      await expect.poll(() => fields.count(), { timeout: 20_000 }).toBeGreaterThan(before);
    } else {
      await expect(page.getByTestId("chat-edit-pane")).toHaveCount(0);
      const deck = page.getByTestId("card-deck-section");
      await expect(deck.getByRole("heading", { name: /Elicitation questions/ })).toBeVisible();
      // Answers come with what they would change; one keeps the form as it is
      const tiles = deck.locator('[data-testid^="deck-option-"]');
      await expect(tiles.first()).toBeVisible({ timeout: AI });
      await expect(deck.locator('[data-testid^="deck-option-"][data-preview="ready"]').first()).toBeVisible({
        timeout: AI,
      });
      await expect(deck.getByText("No form change")).toHaveCount(1);
      await expect(deck.getByTestId("own-answer-open")).toBeVisible();
      // None is marked or focused before the participant acts
      await expect(deck.locator("[data-armed]")).toHaveCount(0);

      // An answer that changes the form: preview it on the form, then apply
      const changing = deck
        .locator('[data-testid^="deck-option-"][data-preview="ready"]')
        .filter({ has: page.getByTestId("option-diff") })
        .first();
      await changing.hover();
      await expect(page.locator('[data-testid="field-annotation"]').first()).toBeVisible();
      await page.waitForTimeout(500); // long enough to count as a look
      await changing.click();
      await expect(page.getByText(/^Applied: /).first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => fields.count(), { timeout: 20_000 }).not.toBe(before);
    }
    }

    await page.getByTestId("finish-task").click();
    await page.getByRole("button", { name: "Yes, it's ready" }).click();

    // With the form hidden: ratings, recall, why — then the quiz
    await postTaskMeasures(page, fields);
    await expect(page.getByRole("heading", { name: "About the form you just built" })).toBeVisible({
      timeout: 60_000,
    });
    await expect(fields).toHaveCount(0);
    const items = page.locator("fieldset");
    const count = await items.count();
    expect(count).toBeGreaterThan(3);
    for (let i = 0; i < count; i++) {
      await items.nth(i).getByRole("radio", { name: i % 3 === 0 ? "No" : "Yes", exact: true }).click();
    }
    await page.getByTestId("quiz-continue").click();
  }

  // Questionnaire: the same in both conditions, NCS-6 included
  await expect(page.getByRole("heading", { name: "Almost done" })).toBeVisible({ timeout: 30_000 });
  let sawNcs = false;
  for (let pageNo = 0; pageNo < 8; pageNo++) {
    sawNcs ||= (await page.getByText("I would prefer complex to simple problems.").count()) > 0;
    await answerPage(page);
    const next = page.getByRole("button", { name: /^Next/ });
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(300);
      continue;
    }
    await page.getByTestId("form-submit-btn").click();
    break;
  }
  expect(sawNcs).toBe(true);

  // Completion: the link back to the panel, followed to the end
  await expect(page.getByText(/Thank you/)).toBeVisible({ timeout: 30_000 });
  const link = page.getByRole("link", { name: /Return to Prolific/ });
  await expect(link).toHaveAttribute("href", COMPLETION_URL);
  if (!page.url().startsWith("https://app.prolific.com")) await link.click().catch(() => {});
  await page.waitForURL(COMPLETION_URL, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Prolific: submission complete" })).toBeVisible();
  expect(rejectedLogWrites).toEqual([]);
  await context.close();
}

test.describe("Briefs study, study link to completion redirect", () => {
  test.setTimeout(RECORDING ? 1_500_000 : 480_000);

  test.beforeEach(async () => {
    await resetDatabase();
    setScenario(SCENARIO);
  });

  for (const condition of ["full", "assistant", "baseline"] as const) {
    test(`${condition} condition`, async ({ browser, page: admin }) => {
      const sessionId = await createSession(admin, condition);
      const code = await joinCode(sessionId);
      await participant(browser, code, `e2e${condition}`, condition);

      // --- What the study recorded ------------------------------------
      const [seat] = await sql<{ condition: string; outcome: string; step: string; id: string }>(
        `SELECT a.condition, pr.outcome, pr.step, sp.id
         FROM study_participants sp
         JOIN study_assignments a ON a.participant_id = sp.id
         JOIN study_progress pr ON pr.participant_id = sp.id
         WHERE sp.session_id = $1`,
        [sessionId],
      );
      expect(seat).toMatchObject({ condition, outcome: "completed", step: "done" });

      // How long each step took (a scripted run: machine speed, not people's)
      const times = await stepTimes(sessionId);
      console.log(
        `[timing] ${condition}: ${times.reduce((sum, t) => sum + t.seconds, 0)} s — ` +
          times.map((t) => `${t.step} ${t.seconds}`).join(", "),
      );
      expect(times.map((t) => t.step)).toEqual([
        "consent", "intro",
        "brief:1", "task:1", "ratings:1", "recall:1", "why:1", "quiz:1",
        "brief:2", "task:2", "ratings:2", "recall:2", "why:2", "quiz:2",
        "questionnaire",
      ]);

      // The measures after each task, stored per task
      const measures = await sql<{ instrument: string; answers: Record<string, unknown> }>(
        `SELECT instrument, answers FROM study_questionnaire_responses
         WHERE participant_id = $1 AND instrument ~ '^(ratings|recall|why):' ORDER BY instrument`,
        [seat.id],
      );
      expect(measures.map((m) => m.instrument)).toEqual([
        "ratings:1", "ratings:2", "recall:1", "recall:2", "why:1", "why:2",
      ]);
      expect(measures[0].answers).toMatchObject({ know: 6, confident: 5 });
      expect(measures[2].answers.lines).toEqual(["The child's or applicant's name", "A phone number"]);
      const why = measures[4].answers.items as { origin: string; label: string; answer: string }[];
      expect(why.length).toBeGreaterThan(0);
      for (const item of why) {
        expect(["system", "participant"]).toContain(item.origin);
        expect(item.answer).toBeTruthy();
      }

      const tasks = await sql<{ brief: string; finished_by: string; fields: number; snapshots: string }>(
        `SELECT t.brief, t.finished_by, p.field_count AS fields,
                (SELECT count(*) FROM study_snapshots s
                 WHERE s.participant_id = t.participant_id AND s.portfolio_id = t.portfolio_id) AS snapshots
         FROM study_tasks t JOIN portfolios p ON p.id = t.portfolio_id
         WHERE t.session_id = $1 ORDER BY t.position`,
        [sessionId],
      );
      expect(tasks.map((t) => t.brief)).toEqual(["camp", "foster"]);
      for (const task of tasks) {
        expect(task.finished_by).toBe("participant");
        expect(task.fields).toBeGreaterThan(0);
        expect(task.snapshots).toBe("1");
      }

      const [session] = await sql<{ settings: { run: Record<string, unknown> } }>(
        "SELECT settings FROM study_sessions WHERE id = $1",
        [sessionId],
      );
      expect(session.settings.run).toMatchObject({ questionStrategy: "committee", committeeSize: 4 });
      expect(session.settings.run.model).toBeTruthy();

      const events = await sql<{ type: string; payload: Record<string, unknown> }>(
        "SELECT type, payload FROM study_events WHERE session_id = $1 ORDER BY id",
        [sessionId],
      );
      const types = new Set(events.map((e) => e.type));
      for (const type of ["joined", "first_prompt", "brief_read", "form_marked_ready", "questionnaire_submitted"]) {
        expect(types, type).toContain(type);
      }
      // The arm's own tour, once (on the first form), closed by the participant
      const tours = events.filter((e) => e.type === "tour_started").map((e) => e.payload.tour);
      expect(tours).toEqual([`task-${condition}`]);
      expect(types).toContain("tour_closed");
      if (condition === "assistant") {
        expect(types).not.toContain("probe_shown");
        expect(types).not.toContain("chat_message");
        const turns = events.filter((e) => e.type === "assistant_turn").map((e) => e.payload);
        expect(turns).toHaveLength(4);
        // The recorded first turns ask two questions and leave the form as it is
        for (const first of turns.filter((t) => t.turn === 1)) {
          expect(first).toMatchObject({ questionSentences: 2, patchOps: null, promptVersion: "assistant-1" });
          expect(typeof first.latencyMs).toBe("number");
        }
        for (const second of turns.filter((t) => t.turn === 2)) {
          expect(second.patchOps).toBeGreaterThan(3);
          expect(second.added).toBe(second.patchOps);
        }
        const probes = await sql(
          `SELECT 1 FROM design_probes WHERE portfolio_id IN
             (SELECT portfolio_id FROM study_tasks WHERE session_id = $1)`,
          [sessionId],
        );
        expect(probes).toHaveLength(0);
      } else if (condition === "full") {
        const answered = events.filter((e) => e.type === "probe_answered");
        expect(answered).toHaveLength(2);
        for (const { payload } of answered) {
          expect(typeof payload.position).toBe("number");
          expect(payload).toMatchObject({ typed: false, noChange: false, previewReady: true });
        }
        // The look that ended in the click is on record
        expect(events.filter((e) => e.type === "option_previewed").length).toBeGreaterThanOrEqual(2);
        expect(types).not.toContain("chat_message");
      } else {
        expect(events.filter((e) => e.type === "chat_message")).toHaveLength(2);
        expect(types).not.toContain("probe_shown");
        const probes = await sql(
          `SELECT 1 FROM design_probes WHERE portfolio_id IN
             (SELECT portfolio_id FROM study_tasks WHERE session_id = $1)`,
          [sessionId],
        );
        expect(probes).toHaveLength(0);
      }

      // Every form change is on record with a person and a reason
      const trail = await sql<{ action: string; actor: string; rationale: string | null }>(
        `SELECT action, actor, rationale FROM provenance_log
         WHERE portfolio_id IN (SELECT portfolio_id FROM study_tasks WHERE session_id = $1)
           AND diff <> '{"added": [], "removed": [], "modified": []}'::jsonb`,
        [sessionId],
      );
      // two forms: generated, then changed (the assistant builds each in one turn)
      expect(trail.length).toBeGreaterThanOrEqual(condition === "assistant" ? 2 : 4);
      if (condition === "assistant") {
        expect(trail.map((t) => t.action)).toEqual(["assistant_edit", "assistant_edit"]);
      }
      for (const entry of trail) {
        expect(entry.actor, entry.action).toMatch(/^Participant \d/);
        expect(entry.rationale, entry.action).toBeTruthy();
      }

      // --- Export: the analyst's files, with what the session ran with ---
      await admin.reload();
      const [download] = await Promise.all([
        admin.waitForEvent("download"),
        admin.getByRole("button", { name: "Answered elicitation questions (CSV)" }).click(),
      ]);
      const csv = fs.readFileSync((await download.path())!, "utf-8").trim().split("\n");
      expect(csv[0]).toMatch(/displayed_position.*model,question_strategy,committee_size$/);
      expect(csv).toHaveLength(condition === "full" ? 3 : 1);
      if (condition === "full") expect(csv[1]).toMatch(/,committee,4$/);

      const [participants] = await Promise.all([
        admin.waitForEvent("download"),
        admin.getByRole("button", { name: "Participants and questionnaire (CSV)" }).click(),
      ]);
      const [header, row] = fs.readFileSync((await participants.path())!, "utf-8").trim().split("\n");
      const cell = (name: string) => row.split(",")[header.split(",").indexOf(name)];
      expect(cell("outcome")).toBe("completed");
      expect(cell("attention_passed")).toBe("1");
      expect(Number(cell("ncs6_score"))).toBeGreaterThanOrEqual(1);
      expect(cell("t1_rating_know")).toBe("6");
      expect(Number(cell("seconds_task_1"))).toBeGreaterThan(0);
      expect(cell("t1_assistant_turns")).toBe(condition === "assistant" ? "2" : "");

      // The raters' recall sheet: two lines per form, form codes only
      const [recall] = await Promise.all([
        admin.waitForEvent("download"),
        admin.getByRole("button", { name: "Recall sheet (CSV)" }).click(),
      ]);
      const recallRows = fs.readFileSync((await recall.path())!, "utf-8").trim().split("\n");
      expect(recallRows[0]).toMatch(/^form,situation,line_no,text,matches_field,requirement_id,/);
      expect(recallRows).toHaveLength(1 + 4);
      expect(recallRows.join("\n")).not.toMatch(/assistant|baseline|Participant \d/);
      if (condition === "assistant") {
        const [turnsFile] = await Promise.all([
          admin.waitForEvent("download"),
          admin.getByRole("button", { name: "Assistant turns (CSV)" }).click(),
        ]);
        expect(fs.readFileSync((await turnsFile.path())!, "utf-8").trim().split("\n")).toHaveLength(1 + 4);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Wave 2: handoff
// ---------------------------------------------------------------------------

/** A finished wave-1 session with one completed participant, written to the database. */
async function seedWave1(): Promise<{ sessionId: string; forms: Record<string, string> }> {
  const [{ id: adminId }] = await sql<{ id: string }>("SELECT id FROM auth.users WHERE email = $1", [
    E2E_ADMIN.email,
  ]);
  const [{ id: sessionId }] = await sql<{ id: string }>(
    `INSERT INTO study_sessions (name, join_code, phase, settings)
     VALUES ('Wave 1 (seeded)', 'WAVE1X', 'done', $1) RETURNING id`,
    [
      JSON.stringify({
        mode: "briefs",
        briefs: ["camp", "foster"],
        conditions: ["full"],
        run: { model: "recorded-fixtures", questionStrategy: "committee", committeeSize: 4 },
      }),
    ],
  );
  const [{ id: participantId }] = await sql<{ id: string }>(
    `INSERT INTO study_participants (session_id, user_id, display_name)
     VALUES ($1, $2, 'Participant 1') RETURNING id`,
    [sessionId, adminId],
  );
  await sql(
    `INSERT INTO study_assignments (participant_id, session_id, condition, task_order)
     VALUES ($1, $2, 'full', 0)`,
    [participantId, sessionId],
  );
  await sql(
    `INSERT INTO study_progress (participant_id, session_id, step, completed_at, outcome)
     VALUES ($1, $2, 'done', now(), 'completed')`,
    [participantId, sessionId],
  );
  const field = (name: string, label: string) => ({
    id: `f-${name}`,
    name,
    label,
    type: { kind: "text" },
    required: true,
    constraints: [],
    origin: "system",
    tags: [],
  });
  const forms: Record<string, string> = {};
  for (const [position, brief, purpose, fields] of [
    [1, "camp", "Sign-up for the holiday football week.", [field("childName", "Child's name"), field("tshirtSize", "T-shirt size")]],
    [2, "foster", "Application to foster a cat.", [field("applicantName", "Your name"), field("homeVisit", "When can a volunteer visit?")]],
  ] as const) {
    const [{ id }] = await sql<{ id: string }>(
      `INSERT INTO portfolios (title, intent, schema, creator_role)
       VALUES ($1, $2, $3, 'participant') RETURNING id`,
      [
        `Participant 1 · form ${position}`,
        JSON.stringify({
          purpose: { content: purpose, updatedAt: "t" },
          audience: { content: "", updatedAt: "t" },
          exclusions: { content: "", updatedAt: "t" },
          constraints: { content: "", updatedAt: "t" },
        }),
        JSON.stringify({ fields, groups: [], version: 1 }),
      ],
    );
    forms[brief] = id;
    await sql(
      `INSERT INTO study_tasks (participant_id, session_id, position, brief, portfolio_id, started_at, finished_at, finished_by)
       VALUES ($1, $2, $3, $4, $5, now() - interval '10 minutes', now(), 'participant')`,
      [participantId, sessionId, position, brief, id],
    );
    await sql(
      `INSERT INTO design_probes (portfolio_id, text, layer, source, options, selected_option, status, resolved_by, resolved_at)
       VALUES ($1, 'Ask for a size?', 'dimensions', 'committee', $2, 'yes', 'resolved', 'Participant 1', now())`,
      [id, JSON.stringify([{ value: "yes", label: "Yes, as a choice" }, { value: "keepAsIs", label: "Keep the form as it is", unchanged: true }])],
    );
  }
  return { sessionId, forms };
}

test.describe("Briefs study, wave 2: taking over a finished form", () => {
  test.setTimeout(300_000);

  test.beforeEach(async () => {
    await resetDatabase();
    setScenario(SCENARIO);
  });

  test("participants start from a wave-1 form, as a portfolio or as a bare form", async ({
    browser,
    page: admin,
  }) => {
    await signIn(admin, "", E2E_ADMIN);
    const wave1 = await seedWave1();

    // --- The researcher sets up wave 2 from the finished wave-1 forms ----
    await admin.goto("/studies");
    await admin.getByTestId("mode-briefs").click();
    await admin.getByLabel("Name").fill("Briefs e2e (wave 2)");
    await admin.getByLabel("Email").fill("researcher@example.org");
    await admin.getByTestId("wave-2").check();
    await admin.getByTestId("handoff-source").selectOption(wave1.sessionId);
    for (const brief of ["camp-2", "foster-2"]) {
      await admin.getByTestId(`handoff-all-${brief}`).click();
      await expect(admin.getByText(new RegExp(`${brief}.*1 of 1\\s+chosen`))).toBeVisible();
    }
    await admin.getByRole("button", { name: "Create session" }).click();
    await admin.waitForURL(/\/studies\/[0-9a-f-]{36}$/);
    const sessionId = admin.url().split("/").pop()!;
    await expect(admin.getByText(/wave 2: participants adapt a finished form/)).toBeVisible();
    await admin.getByTestId("open-study").click();
    await admin.getByRole("button", { name: "Open", exact: true }).click();
    await expect(admin.getByRole("button", { name: "Pause new starts" })).toBeVisible();
    const code = await joinCode(sessionId);

    // --- Two participants: one gets the portfolio, one the bare form -----
    const seen: Record<string, { intent: string; answered: number; fields: number }> = {};
    for (const pid of ["w2a", "w2b"]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`/join?code=${code}&PROLIFIC_PID=${pid}&STUDY_ID=s&SESSION_ID=${pid}`);
      await page.locator("#consent-agree").click();
      await page.getByTestId("consent-continue").click();
      await page.getByTestId("intro-continue").click();
      // The variant situation, then somebody else's form
      await expect(page.getByText(/somebody else built for these people/)).toBeVisible();
      await expect(page.getByTestId("brief-continue")).toBeEnabled({ timeout: 40_000 });
      await expect(page.getByTestId("brief-continue")).toHaveText(/Open the form/);
      await page.getByTestId("brief-continue").click();

      await expect(page.getByTestId("task-bar")).toContainText("Somebody else built it");
      // The form is there from the start, so the tour opens right away
      await handleTour(page, 1, 4);
      // No "describe the form" step: the form is there
      await expect(page.locator("#study-intent")).toHaveCount(0);
      const fields = page.locator('[data-testid^="form-field-"]');
      await expect(fields).toHaveCount(2, { timeout: 30_000 });

      const [task] = await sql<{ start_kind: string; source_portfolio_id: string; purpose: string; answered: string }>(
        `SELECT t.start_kind, t.source_portfolio_id, p.intent->'purpose'->>'content' AS purpose,
                (SELECT count(*) FROM design_probes dp WHERE dp.portfolio_id = p.id AND dp.status = 'resolved') AS answered
         FROM study_tasks t
         JOIN study_assignments a ON a.participant_id = t.participant_id
         JOIN portfolios p ON p.id = t.portfolio_id
         WHERE t.session_id = $1 AND a.external_id = $2 AND t.position = 1`,
        [sessionId, pid],
      );
      expect(Object.values(wave1.forms)).toContain(task.source_portfolio_id);
      seen[task.start_kind] = {
        intent: task.purpose,
        answered: Number(task.answered),
        fields: await fields.count(),
      };

      if (task.start_kind === "portfolio") {
        // The earlier author's intent and decisions came along
        await expect(page.getByTestId("reflective-conversation-pane")).toContainText(/Sign-up|Application/);
        await expect(page.getByTestId("card-deck-section").getByText(/1 answered/)).toBeVisible();
      } else {
        // Fields only: no intent, no decisions
        await expect(page.getByTestId("card-deck-section").getByText(/answered/)).toHaveCount(0);
      }
      await context.close();
    }

    expect(Object.keys(seen).sort()).toEqual(["form", "portfolio"]);
    expect(seen.portfolio).toMatchObject({ answered: 1, fields: 2 });
    expect(seen.portfolio.intent).not.toBe("");
    expect(seen.form).toEqual({ intent: "", answered: 0, fields: 2 });

    // The console shows the starting point as a factor
    await admin.reload();
    await expect(admin.getByRole("columnheader", { name: "Starts from" })).toBeVisible();
    await expect(admin.getByRole("cell", { name: "Form only" }).first()).toBeVisible();
  });
});

