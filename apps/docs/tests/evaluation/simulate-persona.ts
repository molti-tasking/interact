/**
 * Phase 1: Persona Simulation
 *
 * Uses Playwright to drive a persona through the Malleable Forms app,
 * making decisions based on the persona's profile via LLM.
 *
 * Can run against local (localhost:3000) or deployed (interact-molt.vercel.app).
 */

import { chromium, type Browser } from "@playwright/test";
import fs from "fs";
import path from "path";
import type { Persona, Scenario } from "./personas";
import type { SessionArtifacts } from "./cdn-rubric";


// Env vars are read lazily so that .env is loaded before access
const env = () => ({
  BASE_URL: process.env.EVAL_BASE_URL ?? "https://interact-molt.vercel.app",
  LLM_HOST: process.env.LLM_HOST ?? "http://localhost:4000/v1",
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_MODEL: process.env.EVAL_SIM_MODEL ?? process.env.LLM_MODEL_NAME ?? "default",
});

/**
 * Call the LLM to make a persona-driven decision about a design probe card.
 */
async function personaDecision(
  persona: Persona,
  questionText: string,
  options: { value: string; label: string }[],
): Promise<string> {
  const prompt = `You are role-playing as ${persona.name}, a ${persona.role} (${persona.skillLevel} skill level).

Description: ${persona.description}
Decision style: ${persona.decisionStyle}

You are designing a form and the system asks you:
"${questionText}"

Options:
${options.map((o, i) => `${i + 1}. "${o.label}" (value: ${o.value})`).join("\n")}

Based on your persona's expertise and decision style, which option would you choose?
Return ONLY the value string of your chosen option, nothing else.`;

  const { LLM_HOST, LLM_API_KEY, LLM_MODEL } = env();
  console.log(`[persona] LLM call → ${LLM_HOST} (model: ${LLM_MODEL})`);

  const response = await fetch(`${LLM_HOST}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 50,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Try to match the response to a valid option value
  const exactMatch = options.find((o) => o.value === choice);
  if (exactMatch) return exactMatch.value;

  // Fuzzy match: check if response contains an option label
  const fuzzy = options.find(
    (o) =>
      choice.toLowerCase().includes(o.label.toLowerCase()) ||
      choice.toLowerCase().includes(o.value.toLowerCase()),
  );
  if (fuzzy) return fuzzy.value;

  // Fallback: first option
  console.warn(
    `[persona] Could not match LLM response "${choice}" to options, using first option`,
  );
  return options[0].value;
}

/**
 * Run a single persona through a scenario on the live app.
 * Returns collected artifacts for CDN evaluation.
 */
export async function simulatePersona(
  persona: Persona,
  scenario: Scenario,
  browser?: Browser,
  screenshotsDir?: string,
): Promise<SessionArtifacts> {
  const ownBrowser = !browser;
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(
      `[simulate] ${persona.name} (${persona.skillLevel}) × ${scenario.name}`,
    );

    const { BASE_URL } = env();

    // Step 1: Create portfolio
    console.log(`[simulate] Navigating to ${BASE_URL}/portfolios/new`);
    await page.goto(`${BASE_URL}/portfolios/new`);
    await page.locator("#title").fill(scenario.title);
    await page.locator('[data-testid="create-portfolio-btn"]').click();
    await page.waitForURL(/\/portfolios\/[a-f0-9-]+$/, { timeout: 15000 });
    const portfolioId = page.url().split("/portfolios/")[1];
    console.log(`[simulate] Created portfolio: ${portfolioId}`);

    // Step 2: Enter intent
    // The intent editor is a dynamically-loaded @uiw/react-md-editor.
    // We must wait for its textarea to mount and use keyboard input so that
    // React's onChange fires and structuredIntent updates.
    const intentEditor = page.locator('[data-testid="intent-editor"]');
    await intentEditor.waitFor({ state: "visible" });
    console.log(`[simulate] Intent editor visible, waiting for textarea to mount...`);
    const textarea = intentEditor.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.click();
    // Use pressSequentially instead of fill() — fill() may not trigger React onChange
    // for the MDEditor component. pressSequentially dispatches real keyboard events.
    await textarea.pressSequentially(scenario.intent, { delay: 5 });
    console.log(`[simulate] Intent entered: "${scenario.intent.slice(0, 60)}..."`);

    const initialIntent = scenario.intent;

    // Step 3: Generate form
    // Verify the button is enabled before clicking
    const generateBtn = page.locator('[data-testid="generate-form-btn"]');
    await generateBtn.waitFor({ state: "visible" });
    const isDisabled = await generateBtn.isDisabled();
    console.log(`[simulate] generate-form-btn disabled=${isDisabled}`);
    if (isDisabled) {
      console.error(`[simulate] Generate button is disabled — intent may not have been registered`);
      const currentValue = await textarea.inputValue();
      console.error(`[simulate] Textarea value: "${currentValue.slice(0, 80)}..."`);
      throw new Error("Generate button is disabled after entering intent");
    }
    console.log(`[simulate] Clicking generate-form-btn...`);
    await generateBtn.click();

    // Wait for form fields to appear
    console.log(`[simulate] Waiting for form-renderer to become visible (timeout: 90s)...`);
    await page
      .locator('[data-testid="form-renderer"]')
      .waitFor({ state: "visible", timeout: 90000 });
    console.log(`[simulate] form-renderer visible, waiting for first form field...`);
    await page
      .locator('[data-testid^="form-field-"]')
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

    console.log(`[simulate] Form generated, waiting for design probes to be generated...`);

    // Step 4: Wait for and resolve design probe cards
    // Design probes are generated asynchronously (fire-and-forget LLM call after
    // schema generation). We need to poll until they appear in the UI.
    const resolvedProbes: SessionArtifacts["designProbes"] = [];

    // Poll for design probe cards to appear (up to 60s)
    const probeTimeout = 60000;
    const pollInterval = 3000;
    const probeDeadline = Date.now() + probeTimeout;
    let probesAppeared = false;

    while (Date.now() < probeDeadline) {
      const deckSection = page.locator('[data-testid="card-deck-section"]');
      const hasDeck = await deckSection.isVisible().catch(() => false);
      if (hasDeck) {
        const cardCount = await page
          .locator('[data-testid^="deck-card-"]')
          .count();
        if (cardCount > 0) {
          probesAppeared = true;
          console.log(`[simulate] ${cardCount} design probe card(s) appeared`);
          break;
        }
      }
      console.log(
        `[simulate] No design probes yet, polling... (${Math.round((probeDeadline - Date.now()) / 1000)}s remaining)`,
      );
      await page.waitForTimeout(pollInterval);
    }

    if (!probesAppeared) {
      console.warn(`[simulate] No design probes appeared within ${probeTimeout / 1000}s — continuing without`);
    }

    // Resolve design probe cards
    let maxRounds = 8; // Safety limit
    while (maxRounds > 0 && probesAppeared) {
      maxRounds--;

      // Find the first pending design probe card's options
      const probeCards = page.locator(
        '[data-testid^="deck-card-"]',
      );
      const cardCount = await probeCards.count();
      if (cardCount === 0) break;

      const firstCard = probeCards.first();
      const questionText =
        (await firstCard.locator(".font-medium").first().textContent()) ?? "";

      // Extract options from buttons
      const optionButtons = firstCard.locator(
        '[data-testid^="deck-option-"]',
      );
      const optCount = await optionButtons.count();
      if (optCount === 0) break;

      const options: { value: string; label: string }[] = [];
      for (let i = 0; i < optCount; i++) {
        const btn = optionButtons.nth(i);
        const testId = (await btn.getAttribute("data-testid")) ?? "";
        const value = testId.replace("deck-option-", "");
        const label = (await btn.textContent()) ?? value;
        options.push({ value, label });
      }

      // Ask the persona's LLM which option to choose
      const chosenValue = await personaDecision(
        persona,
        questionText,
        options,
      );
      const chosenLabel =
        options.find((o) => o.value === chosenValue)?.label ?? chosenValue;

      console.log(
        `[simulate] Design probe: "${questionText}" → "${chosenLabel}"`,
      );

      // Click the chosen option
      await page
        .locator(`[data-testid="deck-option-${chosenValue}"]`)
        .click();
      resolvedProbes.push({
        text: questionText,
        selectedLabel: chosenLabel,
        status: "resolved",
      });

      // Wait for the design probe to be processed and the card to disappear.
      // The resolve triggers a schema update round-trip, so give it time.
      console.log(`[simulate] Waiting for design probe resolution to process...`);
      await page.waitForTimeout(5000);
    }

    // Step 5: Collect final state
    const finalIntentEl = page.locator('[data-testid="intent-editor"] textarea');
    const finalIntent =
      (await finalIntentEl.inputValue().catch(() => "")) || initialIntent;

    const fieldCount = await page
      .locator('[data-testid^="form-field-"]')
      .count();

    // Collect field labels for schema description
    const fieldLabels: string[] = [];
    const fields = page.locator('[data-testid^="form-field-"]');
    const fCount = await fields.count();
    for (let i = 0; i < Math.min(fCount, 20); i++) {
      const label =
        (await fields.nth(i).locator("label").first().textContent()) ?? "";
      if (label) fieldLabels.push(label);
    }

    console.log(
      `[simulate] Done: ${fieldCount} fields, ${resolvedProbes.length} design probes resolved`,
    );

    return {
      persona: {
        name: persona.name,
        role: persona.role,
        skillLevel: persona.skillLevel,
        description: persona.description,
      },
      scenario: { name: scenario.name },
      initialIntent,
      finalIntent,
      designProbes: resolvedProbes,
      fieldCount,
      schemaDescription: `${fieldCount} fields: ${fieldLabels.join(", ")}`,
      provenanceEntries: resolvedProbes.length + 1, // intent update + probe resolutions
      provenanceSummary: `Intent updated once. ${resolvedProbes.length} design probe resolutions recorded.`,
    };
  } catch (err) {
    // Save a screenshot for debugging failed sessions
    const outDir = screenshotsDir ?? path.join(__dirname, "results", "screenshots");
    fs.mkdirSync(outDir, { recursive: true });
    const slug = `${persona.id ?? persona.name}-${scenario.id ?? scenario.name}`;
    const screenshotPath = path.join(outDir, `${slug}-failure.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.error(`[simulate] Screenshot saved: ${screenshotPath}`);
    throw err;
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}
