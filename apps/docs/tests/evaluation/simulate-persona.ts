/**
 * Phase 1: Persona Simulation
 *
 * Uses Playwright to drive a persona through the Malleable Forms app,
 * making decisions based on the persona's profile via LLM.
 *
 * Can run against local (localhost:3000) or deployed (interact-molt.vercel.app).
 */

import { chromium, type Browser } from "@playwright/test";
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
 * Call the LLM to make a persona-driven decision about an opinion card.
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
    const intentEditor = page.locator('[data-testid="intent-editor"]');
    await intentEditor.waitFor({ state: "visible" });
    const textarea = intentEditor.locator("textarea").first();
    await textarea.click();
    await textarea.fill(scenario.intent);

    const initialIntent = scenario.intent;

    // Step 3: Generate form
    console.log(`[simulate] Clicking generate-form-btn...`);
    await page.locator('[data-testid="generate-form-btn"]').click();

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

    console.log(`[simulate] Form generated, waiting for opinions...`);

    // Step 4: Wait for and resolve opinion cards
    const resolvedOpinions: SessionArtifacts["opinions"] = [];
    let maxRounds = 8; // Safety limit

    while (maxRounds > 0) {
      maxRounds--;

      // Check if there are pending opinion cards
      const deckSection = page.locator('[data-testid="card-deck-section"]');
      const hasDeck = await deckSection.isVisible().catch(() => false);
      if (!hasDeck) {
        // Try waiting briefly for opinions to appear
        await page.waitForTimeout(3000);
        const retryDeck = await deckSection.isVisible().catch(() => false);
        if (!retryDeck) break;
      }

      // Find the first pending opinion card's options
      const opinionCards = page.locator(
        '[data-testid^="opinion-deck-card-"]',
      );
      const cardCount = await opinionCards.count();
      if (cardCount === 0) break;

      const firstCard = opinionCards.first();
      const questionText =
        (await firstCard.locator(".font-medium").first().textContent()) ?? "";

      // Extract options from buttons
      const optionButtons = firstCard.locator(
        '[data-testid^="opinion-option-"]',
      );
      const optCount = await optionButtons.count();
      if (optCount === 0) break;

      const options: { value: string; label: string }[] = [];
      for (let i = 0; i < optCount; i++) {
        const btn = optionButtons.nth(i);
        const testId = (await btn.getAttribute("data-testid")) ?? "";
        const value = testId.replace("opinion-option-", "");
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
        `[simulate] Opinion: "${questionText}" → "${chosenLabel}"`,
      );

      // Click the chosen option
      await page
        .locator(`[data-testid="opinion-option-${chosenValue}"]`)
        .click();
      resolvedOpinions.push({
        text: questionText,
        selectedLabel: chosenLabel,
        status: "resolved",
      });

      // Wait for the opinion to be processed
      await page.waitForTimeout(4000);
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
      `[simulate] Done: ${fieldCount} fields, ${resolvedOpinions.length} opinions resolved`,
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
      opinions: resolvedOpinions,
      fieldCount,
      schemaDescription: `${fieldCount} fields: ${fieldLabels.join(", ")}`,
      provenanceEntries: resolvedOpinions.length + 1, // intent update + opinion resolutions
      provenanceSummary: `Intent updated once. ${resolvedOpinions.length} opinion resolutions recorded.`,
    };
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}
