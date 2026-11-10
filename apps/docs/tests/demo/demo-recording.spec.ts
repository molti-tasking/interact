/**
 * The scripted demo recording: the paper's three scenarios in one take.
 *
 *   pnpm demo:record
 *   → paper-figures/video/raw.webm, marks.json   (this spec)
 *   → paper-figures/video/malleable-forms-demo.mp4 (tests/demo/post.py:
 *     captions burnt in under the picture, 1080p)
 *
 * The approach is the one of the paper repository's recorder
 * (video/recorder/record.js, post.py): Playwright records the page, a drawn
 * cursor shows where the pointer is, captions are timestamps in marks.json
 * that the post step burns in. Unlike that recorder, this one calls no
 * model: the scenarios are seeded (tests/screenshots/paper-scenarios.ts)
 * and every answer given on camera is applied from its preview. The one
 * call a scenario makes — "Generate questions" with a colleague's feedback —
 * is answered from a fixture written here from the same seed. So the
 * recording shows the same content as the paper's figures, every run.
 *
 * Like the figures, the recording is anonymous (ANONYMIZE).
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { E2E_ADMIN, signIn } from "../auth";
import { resetDatabase, setScenario } from "../e2e/helpers";
import { ANONYMIZE, FIGURE_DIR, IDENTIFYING, seed, visibleText } from "../screenshots/helpers";
import {
  HIRING_FEEDBACK,
  HIRING_ID,
  ORTHO_ID,
  ORTHO_PHYSIO_ID,
  ORTHO_SURGEON_ID,
  PHYSIO_SCENARIO,
  SOCCER_ID,
  SOCCER_ONE_LINE,
  hiringGenerated,
  hiringStart,
  hiringStartHistory,
  ortho,
  orthoHistory,
  orthoPhysio,
  orthoSurgeon,
  soccerStart,
  soccerStartHistory,
  soccerStartQuestions,
} from "../screenshots/paper-scenarios";

const SIZE = { width: 1600, height: 900 };
const OUT = path.join(FIGURE_DIR, "video");
const FIXTURES = path.resolve(process.cwd(), "tests/fixtures/demo-recording");

/** A drawn cursor (the recorded page has no system cursor). */
const CURSOR = `
(() => {
  const css = \`
    #__cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -4px 0 0 -4px;
      pointer-events: none; background: rgba(20,20,20,.88); border: 2px solid #fff;
      border-radius: 50% 50% 50% 0; transform: rotate(-90deg) scale(.8);
      box-shadow: 0 1px 4px rgba(0,0,0,.4); left: -50px; top: -50px; }
    #__cursor.down { transform: rotate(-90deg) scale(.6); background: #0d9488; }
  \`;
  const boot = () => {
    if (!document.body || document.getElementById("__cursor")) return;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "__cursor";
    document.body.appendChild(cursor);
    const pos = JSON.parse(sessionStorage.getItem("__cur") || "null");
    if (pos) { cursor.style.left = pos[0] + "px"; cursor.style.top = pos[1] + "px"; }
    addEventListener("mousemove", (e) => {
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
      sessionStorage.setItem("__cur", JSON.stringify([e.clientX, e.clientY]));
    }, true);
    addEventListener("mousedown", () => cursor.classList.add("down"), true);
    addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot); else boot();
  setInterval(boot, 500);
})();
`;

/** The figures' anonymising script, but with motion: this is a video. */
const ANONYMIZE_MOVING = ANONYMIZE.replace(/\*, \*::before, \*::after \{[^}]*\}/, "");

const card = (title: string, lines: string[], sub = "") => `<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#0f2a2a;color:#f3f6f4;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif">
<div style="max-width:1180px;padding:0 60px"><div style="font-size:64px;font-weight:650;letter-spacing:-1px">${title}</div>
${sub ? `<div style="font-size:30px;margin-top:14px;color:#9fd8cf">${sub}</div>` : ""}
<div style="margin-top:38px;font-size:29px;line-height:1.6;color:#dbe7e3">${lines.map((l) => `<div>${l}</div>`).join("")}</div></div></body></html>`;

test.describe("Demo recording", () => {
  test.setTimeout(600_000);

  test("three scenarios", async ({ browser }) => {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });

    // The one model call of the recording, from the seed
    fs.rmSync(FIXTURES, { recursive: true, force: true });
    fs.mkdirSync(FIXTURES, { recursive: true });
    fs.writeFileSync(
      path.join(FIXTURES, "000-generateDesignProbesAction.json"),
      JSON.stringify(
        {
          actionName: "generateDesignProbesAction",
          callIndex: 0,
          input: { externalPrompt: HIRING_FEEDBACK },
          output: { success: true, interactions: hiringGenerated },
          timestamp: "2026-11-10T00:00:00.000Z",
          matchHints: { prompt: HIRING_FEEDBACK },
        },
        null,
        2,
      ),
    );

    await resetDatabase();
    setScenario("demo-recording");
    await seed({
      portfolios: [soccerStart, hiringStart, ortho, orthoSurgeon, orthoPhysio],
      questions: { [SOCCER_ID]: soccerStartQuestions },
      history: {
        [SOCCER_ID]: soccerStartHistory,
        [HIRING_ID]: hiringStartHistory,
        ...orthoHistory,
      },
    });

    // Sign in off camera
    const setup = await browser.newContext();
    const setupPage = await setup.newPage();
    await signIn(setupPage, "", E2E_ADMIN);
    for (const warm of [`/portfolios/${SOCCER_ID}`, `/portfolios/${SOCCER_ID}/provenance`, "/portfolios/new", `/portfolios/${ORTHO_ID}/derive`]) {
      await setupPage.goto(warm); // compile the pages before the camera runs
      await setupPage.waitForLoadState("networkidle").catch(() => {});
    }
    const storageState = await setup.storageState();
    await setup.close();

    const context = await browser.newContext({
      viewport: SIZE,
      storageState,
      recordVideo: { dir: OUT, size: SIZE },
    });
    await context.addInitScript(ANONYMIZE_MOVING);
    await context.addInitScript(CURSOR);
    const page = await context.newPage();

    const t0 = Date.now();
    const now = () => (Date.now() - t0) / 1000;
    const caps: { t: number; text: string }[] = [];
    const cap = (text: string) => caps.push({ t: now(), text });
    const sleep = (ms: number) => page.waitForTimeout(ms);
    const moveTo = async (target: Locator, dx = 0.5, dy = 0.5) => {
      await target.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
      const box = await target.boundingBox();
      if (!box) return;
      await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy, { steps: 28 });
    };
    const click = async (target: Locator, dx = 0.5, dy = 0.5) => {
      await moveTo(target, dx, dy);
      await sleep(350);
      await page.mouse.down();
      await sleep(90);
      await page.mouse.up();
    };
    const anonymous = async (p: Page) => expect(await visibleText(p)).not.toMatch(IDENTIFYING);
    const deck = page.getByTestId("card-deck-section");
    const option = (value: string) => deck.getByTestId(`deck-option-${value}`);
    const fields = page.locator('[data-testid^="form-field-"]');
    /** Off the answers, onto the form: nothing is previewed by accident */
    const rest = () => page.mouse.move(SIZE.width * 0.72, SIZE.height * 0.62, { steps: 22 });
    const openQuestion = async (text: string) => {
      const collapsed = deck.locator('button[data-testid^="deck-card-"]', { hasText: text });
      if (await collapsed.count()) await click(collapsed.first(), 0.35, 0.5);
      await sleep(700);
    };

    // ── Title ────────────────────────────────────────────────────────────
    await page.setContent(
      card(
        "Malleable Forms",
        [
          "Creating a form means deciding up front what to ask.",
          "What if those decisions were raised one by one, as questions?",
        ],
        "Elicitation questions for forms that take shape as they are used",
      ),
    );
    cap("");
    await sleep(6000);

    // ── Scenario 1: youth soccer registration ───────────────────────────
    await page.goto("/portfolios/new");
    cap("Scenario 1. A coach starts with one rough sentence. No field list.");
    const intentBox = page.locator("#intent");
    await click(intentBox, 0.3, 0.4);
    await intentBox.pressSequentially(SOCCER_ONE_LINE, { delay: 38 });
    await sleep(1800);

    await page.goto(`/portfolios/${SOCCER_ID}`);
    await expect(fields.first()).toBeVisible({ timeout: 30_000 });
    cap("A first form is drafted from that sentence. Then the system asks elicitation questions.");
    await expect(deck.locator('[data-testid^="deck-option-"]').first()).toBeVisible({ timeout: 30_000 });
    await anonymous(page);
    // The form's own count: fields shown as a preview don't count
    const fieldCount = async () =>
      Number((await page.getByTestId("field-count").innerText()).match(/\d+/)?.[0] ?? 0);
    const before = await fieldCount();
    await moveTo(deck, 0.5, 0.2);
    await sleep(4500);

    // G1 + G2: a question that names a consideration, alternatives, none marked
    await openQuestion("Which age groups does the club run?");
    cap("Each question names one consideration and offers alternatives. None is recommended or pre-selected.");
    await sleep(4200);
    // G3: consequences before commitment
    cap("Hovering an answer previews exactly what it would change on the form.");
    for (const value of ["fromBirthDate", "fixedGroups"]) {
      await moveTo(option(value), 0.45, 0.5);
      await sleep(2600);
    }
    cap("Choosing it applies that previewed change, and nothing else.");
    await click(option("fixedGroups"), 0.45, 0.5);
    await rest();
    await expect.poll(fieldCount, { timeout: 20_000 }).toBe(before + 1);
    await sleep(2600);

    await openQuestion("Collect medical information?");
    cap("Question by question, the form covers what the first sentence never mentioned.");
    await moveTo(option("emergencyOnly"), 0.45, 0.5);
    await sleep(2200);
    await moveTo(option("allergiesAndConditions"), 0.45, 0.5);
    await sleep(2400);
    await click(option("allergiesAndConditions"), 0.45, 0.5);
    await rest();
    await expect.poll(fieldCount, { timeout: 20_000 }).toBe(before + 3);
    await sleep(2400);

    await openQuestion("How is the season fee paid?");
    cap("Keeping the form as it is is always one of the answers. So is writing your own.");
    await moveTo(option("keepAsIs"), 0.45, 0.5);
    await sleep(2600);
    await click(option("keepAsIs"), 0.45, 0.5);
    await rest();
    await expect(deck.getByText(/3 answered/)).toBeVisible({ timeout: 20_000 });
    await moveTo(deck.getByTestId("own-answer-open"), 0.5, 0.5);
    await sleep(2600);

    // G4: no change without a decision
    cap("The form only changes through such a decision. Every one is recorded: who, what, why.");
    await click(page.getByRole("link", { name: "History" }).first());
    await expect(page.getByTestId("provenance-entry").first()).toBeVisible({ timeout: 30_000 });
    await anonymous(page);
    await page.mouse.move(SIZE.width * 0.5, SIZE.height * 0.55, { steps: 20 });
    await sleep(2500);
    await page.mouse.wheel(0, 320);
    await sleep(4200);

    // ── Scenario 2: hiring a sales representative ───────────────────────
    await page.goto(`/portfolios/${HIRING_ID}`);
    await expect(fields.first()).toBeVisible({ timeout: 30_000 });
    cap("Scenario 2. A founder's job application form. Her co-founder has feedback.");
    await sleep(3800);
    await click(deck.getByRole("button", { name: "New questions" }));
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Generate questions" })).toBeVisible();
    cap("Feedback is not applied as an edit. It becomes questions for the form's owner.");
    const feedback = dialog.getByTestId("external-prompt-input");
    await click(feedback, 0.3, 0.4);
    await feedback.pressSequentially(HIRING_FEEDBACK, { delay: 16 });
    await sleep(1500);
    await click(dialog.getByRole("button", { name: "Generate" }));
    await expect(option("asChoice")).toBeVisible({ timeout: 30_000 });
    await anonymous(page);
    await sleep(2200);

    cap("She previews the alternatives and decides.");
    await moveTo(option("asText"), 0.45, 0.5);
    await sleep(2400);
    await moveTo(option("asChoice"), 0.45, 0.5);
    await sleep(2600);
    await click(option("asChoice"), 0.45, 0.5);
    await rest();
    await expect(page.getByTestId("form-field-industryBackground")).toBeVisible({ timeout: 20_000 });
    await sleep(2200);
    await openQuestion("Require a cover letter?");
    await moveTo(option("optional"), 0.45, 0.5);
    await sleep(2400);
    await click(option("optional"), 0.45, 0.5);
    await rest();
    await expect(deck.getByText(/2 answered/)).toBeVisible({ timeout: 20_000 });
    await sleep(1800);

    cap("Fields stay directly editable. A direct edit is a decision too, and is recorded like one.");
    await click(page.getByTestId("form-field-industryBackground"), 0.3, 0.3);
    await expect(page.getByRole("dialog")).toBeVisible();
    await sleep(5200);
    await page.keyboard.press("Escape");
    await sleep(800);

    // ── Scenario 3: orthopedic patient records ──────────────────────────
    await page.goto(`/portfolios/${ORTHO_ID}`);
    await expect(fields.first()).toBeVisible({ timeout: 30_000 });
    cap("Scenario 3. One shared patient record for an orthopedic department.");
    await anonymous(page);
    await moveTo(page.getByText(/2 derived views/), 0.5, 0.5);
    await sleep(4800);
    cap("The surgeon works with a view derived from it: part of the record, plus what surgery needs.");
    await page.goto(`/portfolios/${ORTHO_SURGEON_ID}`);
    await expect(fields.first()).toBeVisible({ timeout: 30_000 });
    await moveTo(page.getByText("Derived from"), 0.8, 0.5);
    await sleep(2400);
    await page.mouse.move(SIZE.width * 0.72, SIZE.height * 0.6, { steps: 20 });
    await page.mouse.wheel(0, 500);
    await sleep(3200);
    cap("The physiotherapist has another. Both stay linked to the base they came from.");
    await page.goto(`/portfolios/${ORTHO_PHYSIO_ID}`);
    await expect(fields.first()).toBeVisible({ timeout: 30_000 });
    await moveTo(page.getByText("Derived from"), 0.8, 0.5);
    await sleep(2400);
    await page.mouse.move(SIZE.width * 0.72, SIZE.height * 0.6, { steps: 20 });
    await page.mouse.wheel(0, 500);
    await sleep(3200);
    cap("A new view starts from a sentence about what a role needs.");
    await page.goto(`/portfolios/${ORTHO_ID}/derive`);
    const scenario = page.locator("textarea").first();
    await click(scenario, 0.3, 0.4);
    await scenario.pressSequentially(PHYSIO_SCENARIO, { delay: 18 });
    await sleep(2600);

    // ── End card ─────────────────────────────────────────────────────────
    await page.setContent(
      card(
        "Malleable Forms",
        [
          "• Ask, then show alternatives",
          "• Alternatives, not a recommendation",
          "• Consequences before commitment",
          "• No change without a decision",
        ],
        "Four interaction goals for elicitation questions",
      ),
    );
    cap("");
    await sleep(7000);

    const end = now();
    await context.close();
    const raw = fs.readdirSync(OUT).find((f) => f.endsWith(".webm"));
    expect(raw).toBeTruthy();
    fs.renameSync(path.join(OUT, raw!), path.join(OUT, "raw.webm"));
    fs.writeFileSync(
      path.join(OUT, "marks.json"),
      JSON.stringify({ caps, waits: [], end, W: SIZE.width, H: SIZE.height }, null, 1),
    );
    // The old term appears in no caption
    expect(caps.map((c) => c.text).join(" ")).not.toMatch(/\bprobes?\b/i);
  });
});
