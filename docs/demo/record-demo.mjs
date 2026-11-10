// Demo recording for Malleable Forms (docs/demo/malleable-forms-demo.mp4).
//
// Drives the real app with the real model, so each run differs a little.
// It was recorded against a throwaway Supabase stack (API 56321, DB 56322)
// and `next dev -p 3210`; adjust BASE, DB and the admin login below. The
// script inserts 34 made-up responses into that database — never point it
// at one with real data.
//
//   node docs/demo/record-demo.mjs          record to ./raw/*.webm
//   DRY=1 node docs/demo/record-demo.mjs    screenshots only (./shots)
//   ffmpeg -i raw/<file>.webm -c:v libx264 -crf 20 -pix_fmt yuv420p demo.mp4
import { createRequire } from "module";
const require = createRequire("/Users/au774186/projects/au/ai-elements/interact/apps/docs/package.json");
const { chromium } = require("@playwright/test");
const { Client } = require("pg");
import fs from "fs";

const BASE = "http://localhost:3210";
const DB = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const DIR = new URL("./", import.meta.url).pathname;
const DRY = !!process.env.DRY;
const SIZE = { width: 1600, height: 900 };
const marks = [];
const t0 = Date.now();
const mark = (name) => { marks.push({ name, t: (Date.now() - t0) / 1000 }); console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`); };

const INIT = () => {
  const setup = () => {
    if (document.getElementById("__demo_css")) return;
    const css = document.createElement("style");
    css.id = "__demo_css";
    css.textContent = `
      nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }
      #__cap { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); max-width: 1180px;
        background: rgba(17,24,28,.92); color: #fff; font: 500 21px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        padding: 14px 26px; border-radius: 14px; z-index: 2147483000; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,.28);
        transition: opacity .35s; opacity: 0; pointer-events: none; letter-spacing: .1px; }
      #__cap b { color: #7fe3c4; font-weight: 600; }
      #__cur { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
        background: rgba(16,120,100,.35); border: 2px solid rgba(16,120,100,.9); z-index: 2147483001; pointer-events: none;
        transition: transform .12s; left: -50px; top: -50px; }
      #__cur.down { transform: scale(.6); background: rgba(16,120,100,.7); }
      #__card { position: fixed; inset: 0; z-index: 2147483002; background: #0f2a2a; color: #fff; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 22px; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        transition: opacity .5s; opacity: 0; pointer-events: none; text-align: center; padding: 0 140px; }
      #__card h1 { font: 600 62px/1.1 ui-serif, Georgia, serif; margin: 0; letter-spacing: -.5px; }
      #__card p { font-size: 27px; line-height: 1.45; margin: 0; color: #cfe7e0; max-width: 1100px; }
      #__card ul { list-style: none; padding: 0; margin: 8px 0 0; display: grid; gap: 14px; text-align: left; }
      #__card li { font-size: 25px; color: #e8f4f0; }
      #__card li b { color: #7fe3c4; font-weight: 600; }
    `;
    document.documentElement.appendChild(css);
    for (const id of ["__cap", "__cur", "__card"]) {
      const el = document.createElement("div");
      el.id = id;
      document.documentElement.appendChild(el);
    }
    const cap = sessionStorage.getItem("__cap");
    if (cap) { const el = document.getElementById("__cap"); el.innerHTML = cap; el.style.opacity = "1"; }
    const pos = JSON.parse(sessionStorage.getItem("__cur") || "null");
    const cur = document.getElementById("__cur");
    if (pos) { cur.style.left = pos.x + "px"; cur.style.top = pos.y + "px"; }
    addEventListener("mousemove", (e) => { cur.style.left = e.clientX + "px"; cur.style.top = e.clientY + "px";
      sessionStorage.setItem("__cur", JSON.stringify({ x: e.clientX, y: e.clientY })); }, true);
    addEventListener("mousedown", () => cur.classList.add("down"), true);
    addEventListener("mouseup", () => cur.classList.remove("down"), true);
  };
  if (document.documentElement) setup();
  document.addEventListener("DOMContentLoaded", setup);
};

const browser = await chromium.launch();

// Sign in outside the recording
{
  const ctx = await browser.newContext({ viewport: SIZE });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.getByLabel("Email").fill("demo-admin@test.local");
  await p.getByLabel("Password").fill("demo-admin-password");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 60000 });
  await ctx.storageState({ path: DIR + "state.json" });
  // Warm the routes so compile time isn't in the video
  for (const path of ["/portfolios/new"]) { await p.goto(BASE + path); await p.waitForTimeout(1500); }
  await ctx.close();
}

const ctx = await browser.newContext({
  viewport: SIZE,
  storageState: DIR + "state.json",
  ...(DRY ? {} : { recordVideo: { dir: DIR + "raw", size: SIZE } }),
});
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
mark("video-start");
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

let shot = 0;
const snap = async (name) => { if (DRY) await page.screenshot({ path: `${DIR}shots/r${String(++shot).padStart(2, "0")}-${name}.png` }); };
const pause = (ms) => page.waitForTimeout(DRY ? Math.min(ms, 500) : ms);
const caption = async (html) => {
  await page.evaluate((h) => {
    const el = document.getElementById("__cap");
    if (!el) return;
    if (h) { el.innerHTML = h; el.style.opacity = "1"; sessionStorage.setItem("__cap", h); }
    else { el.style.opacity = "0"; sessionStorage.removeItem("__cap"); }
  }, html);
};
const card = async (html, ms) => {
  await page.evaluate((h) => { const el = document.getElementById("__card"); el.innerHTML = h; el.style.opacity = "1"; }, html);
  await pause(ms);
  await page.evaluate(() => { document.getElementById("__card").style.opacity = "0"; });
  await pause(600);
};
let mouse = { x: 800, y: 450 };
const glide = async (locator, dx = 0, dy = 0) => {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (!box) throw new Error("no box for " + locator);
  const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
  const steps = DRY ? 2 : Math.max(12, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 22));
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
};
const click = async (locator, opts = {}) => { await glide(locator); await pause(opts.before ?? 350); await locator.click(); await pause(opts.after ?? 500); };

// ---------------------------------------------------------------------------
await page.goto(`${BASE}/portfolios/new`);
await page.locator("textarea").first().waitFor();
mark("title");
await card(`<h1>Malleable Forms</h1><p>Describe what you need in a sentence.<br/>The form takes shape through the decisions that matter.</p>`, 4200);

// 1 — one sentence
await caption("Start with <b>one sentence</b>.");
const box = page.locator("textarea").first();
await click(box);
await box.pressSequentially(
  "Sign-up form for our neighbourhood board game night. I want to know who is coming and which games people like.",
  { delay: DRY ? 0 : 26 },
);
await pause(700);
await snap("typed");
mark("create");
await page.keyboard.press("Meta+Enter");

// 2 — the first draft streams in
await page.waitForURL(/\/portfolios\/[0-9a-f-]{36}/, { timeout: 60000 });
const portfolioId = page.url().match(/portfolios\/([0-9a-f-]{36})/)[1];
await caption("A first draft <b>streams in</b> — only what you asked for.");
await page.locator('[data-testid^="form-field-"]').first().waitFor({ timeout: 90000 });
await snap("stream");
mark("fields");
await pause(3500);

// 3 — the committee
await caption("Meanwhile, <b>four independent drafts</b> of the whole form are compared.<br/>Where they disagree, the description leaves a decision open.");
await page.locator('[data-testid^="deck-option-"]').first().waitFor({ timeout: 120000 });
await page.locator('[data-testid="option-diff"]').first().waitFor({ timeout: 60000 });
mark("probes");
await pause(1200);
await snap("probes");
await caption("Each open decision becomes a <b>question</b> — the most contested first.");
await pause(3800);

// 4 — previews
const options = page.locator('[data-testid^="deck-option-"]');
const count = await options.count();
// The options that change the form (those with an "adds" line)
const changing = [];
for (let i = 0; i < count; i++) {
  if (await options.nth(i).locator('[data-testid="option-diff"]').count()) changing.push(i);
}
console.log("options", count, "changing", changing);
await caption("Hover an answer: the canvas shows <b>exactly what it would change</b>.");
for (const i of changing.slice(0, 2)) { await glide(options.nth(i)); await pause(2300); }
await snap("hover");
const pick = options.nth(changing[0] ?? 1);
await glide(pick);
await pause(900);
await caption("Choose — it applies <b>instantly</b>. The change was worked out before you asked.");
await pause(600);
mark("apply");
await pick.click();
await pause(2800);
await snap("applied");

// A second answer, quickly
const again = page.locator('[data-testid^="deck-option-"]');
await again.first().waitFor({ timeout: 30000 });
const n2 = await again.count();
let second = -1;
for (let i = 0; i < n2; i++) if (await again.nth(i).locator('[data-testid="option-diff"]').count()) { second = i; break; }
if (second >= 0) {
  await glide(again.nth(second));
  await pause(1600);
  await again.nth(second).click();
  await pause(2200);
}

// 5 — the purpose keeps the creator's words
await caption("Your description stays <b>yours</b>: a sentence is added, nothing is rewritten.");
const collapsed = page.locator('[data-testid="intent-toggle"][aria-expanded="false"]');
if (await collapsed.count()) await click(collapsed.first());
const editor = page.locator('[data-testid="intent-editor"]').first();
const before = (await editor.innerText().catch(() => "")).length;
for (let i = 0; i < 30; i++) {
  if ((await editor.innerText().catch(() => "")).length > before + 20) break;
  await page.waitForTimeout(500);
}
await glide(editor, 0, -10).catch(() => {});
await pause(4500);
await snap("intent");

// 6 — pretest
await caption("Before real people see it: <b>12 simulated respondents</b> try the form.");
await click(page.getByRole("button", { name: "Pretest" }));
await pause(1500);
mark("pretest");
await click(page.getByRole("button", { name: "Run pretest" }));
await caption("They report where they got stuck — a missing option, a question they can't answer.");
await page.getByRole("button", { name: "Run again" }).waitFor({ timeout: 150000 });
mark("pretest-done");
await pause(1200);
await snap("pretest");
const sendButtons = page.getByRole("button", { name: "Send to questions" });
const issues = await sendButtons.count();
console.log("pretest issues with send:", issues);
await pause(3200);
if (issues > 0) {
  await caption("Send an issue to the questions — it comes with the fix as an answer.");
  await click(sendButtons.first());
  await pause(2200);
  await snap("pretest-sent");
}
await click(page.getByRole("dialog").getByRole("button", { name: "Close" }).first());
await pause(1500);
await snap("after-pretest");

// 7 — help for respondents + publish
await caption("Optional <b>help for respondents</b>, switched on per form.");
await click(page.locator('[data-testid="respondent-assist"]'));
await click(page.locator('[data-testid="assist-explain"]'), { after: 700 });
if (!(await page.locator('[data-testid="assist-prefill"]').isVisible().catch(() => false))) {
  await click(page.locator('[data-testid="respondent-assist"]'));
}
await click(page.locator('[data-testid="assist-prefill"]'), { after: 900 });
await page.keyboard.press("Escape");
await pause(600);
await click(page.getByRole("button", { name: "Publish" }).first());
await click(page.getByRole("dialog").getByRole("button", { name: "Publish" }));
await pause(1600);
await snap("published");
await page.keyboard.press("Escape");

// 8 — the respondent's side
mark("respondent");
await page.goto(`${BASE}/forms/${portfolioId}`);
await page.locator("form, [data-testid^='form-field-']").first().waitFor({ timeout: 60000 });
await caption("The respondent can ask what a question means…");
await pause(1800);
await snap("public");
const explain = page.getByRole("button", { name: /What does .* mean\?/ });
const nExplain = await explain.count();
if (nExplain > 0) {
  const target = explain.nth(Math.min(nExplain - 1, 3));
  await click(target);
  await page.getByText("Explaining…").waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
  await pause(3600);
  await snap("explained");
}
await caption("…or just <b>write a few lines</b> and let the form fill itself in — to check, not to submit.");
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await pause(900);
await click(page.getByRole("button", { name: "Fill in from a text" }));
const prefill = page.getByRole("textbox").filter({ hasNot: page.locator("input") }).locator("xpath=self::textarea").first();
const area = (await prefill.count()) ? prefill : page.locator("textarea").first();
await click(area);
await area.pressSequentially(
  "Hi, I'm Jonas Weber (jonas.weber@example.org). I'll be there with one friend. We love Catan and Codenames and I can bring Carcassonne.",
  { delay: DRY ? 0 : 18 },
);
await pause(600);
await click(page.getByRole("button", { name: "Fill in the form" }));
await page.getByText("Reading…").waitFor({ state: "detached", timeout: 90000 }).catch(() => {});
await pause(1500);
await snap("prefilled");
await page.mouse.wheel(0, 260);
await pause(3800);
await snap("prefilled-2");

// 9 — responses feed back
mark("seed");
{
  const db = new Client({ connectionString: DB });
  await db.connect();
  const { rows } = await db.query("select schema from portfolios where id = $1", [portfolioId]);
  const fields = rows[0].schema.fields;
  const names = ["Mia Hansen", "Jonas Weber", "Aisha Khan", "Luca Rossi", "Sofie Nielsen", "Tom Baker", "Elif Demir", "Noah Berg", "Hana Sato", "Oskar Lind", "Zoe Martin", "Emil Krogh"];
  const games = [
    "Catan, mostly", "Settlers of Catan and Carcassonne", "Carcassonne", "anything strategic like Terraforming Mars", "Catan!",
    "Codenames", "party games – Codenames, Just One", "Just One and Wavelength", "Codenames with a big group",
    "Pandemic", "co-op games like Pandemic or Spirit Island", "Pandemic Legacy", "cooperative stuff",
    "Chess", "classics: chess, backgammon", "Scrabble and chess", "Uno", "card games like Uno", "Wingspan", "Ticket to Ride", "Ticket to Ride, Catan",
  ];
  const pickOf = (arr, i) => arr[i % arr.length];
  for (let i = 0; i < 34; i++) {
    const data = {};
    for (const f of fields) {
      const k = f.type.kind;
      const text = `${f.name} ${f.label}`.toLowerCase();
      if (k === "text") {
        if (/mail/.test(text)) data[f.name] = pickOf(names, i).toLowerCase().replace(" ", ".") + "@example.org";
        else if (/name/.test(text)) data[f.name] = pickOf(names, i);
        else if (/game/.test(text)) data[f.name] = pickOf(games, i * 7 + 3);
        else if (i % 3 === 0) data[f.name] = pickOf(["No", "Nothing special", "Vegetarian snacks please", "Ground floor access"], i);
      } else if (k === "select") {
        // Leave the last option unused, so the dashboard has something to find
        const usable = f.type.options.length > 2 ? f.type.options.slice(0, -1) : f.type.options;
        data[f.name] = f.type.multiple ? [pickOf(usable, i).value] : pickOf(usable, i * 3 + (i % 2)).value;
      } else if (k === "boolean") data[f.name] = i % 3 !== 0;
      else if (k === "number") data[f.name] = 1 + (i % 3);
      else if (k === "scale") data[f.name] = f.type.min + (i % (f.type.max - f.type.min + 1));
      else if (k === "date") data[f.name] = "2026-11-2" + (i % 9);
    }
    await db.query("insert into responses (portfolio_id, data, submitted_at) values ($1, $2, now() - ($3 || ' hours')::interval)", [portfolioId, JSON.stringify(data), String(i * 5)]);
  }
  await db.end();
}
mark("responses");
await page.goto(`${BASE}/responses/${portfolioId}`);
await page.getByText("responses collected").first().waitFor({ timeout: 90000 });
await caption("Then the <b>answers</b> come in — and feed back into the design.");
await pause(2600);
await snap("responses");
await click(page.getByRole("tab", { name: /Dashboard/ }).or(page.getByRole("button", { name: /Dashboard/ })).first());
await page.locator('[data-testid="findings-panel"], [data-testid="theme-search"]').first().waitFor({ timeout: 60000 }).catch(() => console.log("no findings panel visible"));
await pause(2500);
await snap("dashboard");
const themeBtn = page.getByRole("button", { name: "Look for themes in text answers" });
if (await themeBtn.count()) {
  await themeBtn.scrollIntoViewIfNeeded();
  await pause(800);
  await caption("Free-text answers are grouped into <b>themes</b>, counted from the answers themselves.");
  await click(themeBtn);
  await page.getByRole("button", { name: "Look again" }).waitFor({ timeout: 120000 }).catch(() => {});
  await pause(2500);
  await snap("themes");
  const ask = page.getByRole("button", { name: "Ask in Design" });
  console.log("ask-in-design buttons:", await ask.count());
  if (await ask.count()) {
    await caption("A finding becomes a design question — with the change ready to apply.");
    await click(ask.last());
    await pause(2600);
    await snap("asked");
  }
}

// 10 — back in design
mark("design-again");
await page.goto(`${BASE}/portfolios/${portfolioId}`);
await page.locator('[data-testid^="deck-card-"]').first().waitFor({ timeout: 60000 });
await pause(1800);
await snap("design-again");
const fromData = page.locator('[data-testid^="deck-card-"]').filter({ hasText: /into a choice/ }).first();
if (await fromData.count()) {
  await caption("The themes from the answers arrive as a question: <b>turn free text into a choice?</b>");
  if ((await fromData.getAttribute("aria-expanded")) === "false") await click(fromData);
  await pause(1200);
  const opts = page.locator('[data-testid^="deck-option-"]');
  let idx = -1;
  for (let i = 0; i < (await opts.count()); i++) if (await opts.nth(i).locator('[data-testid="option-diff"]').count()) { idx = i; break; }
  if (idx >= 0) {
    await glide(opts.nth(idx));
    await pause(3200);
    await snap("data-hover");
    await opts.nth(idx).click();
    await pause(3000);
    await snap("data-applied");
  }
}
await pause(1500);
await caption("");
mark("end");
await card(
  `<h1>Malleable Forms</h1><ul>
   <li><b>Questions chosen by disagreement</b> — not by asking a model what to ask</li>
   <li><b>Every change previewed</b>, and limited to what the preview showed</li>
   <li><b>Your words stay yours</b> — one bounded edit at a time</li>
   <li><b>Pretested</b> before launch, <b>refined</b> by the answers after</li></ul>`,
  7000,
);
mark("done");

fs.writeFileSync(DIR + "marks.json", JSON.stringify(marks, null, 2));
const video = page.video();
await ctx.close();
if (video) console.log("VIDEO", await video.path());
await browser.close();
