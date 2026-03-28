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
import type { SessionArtifacts } from "./cdn-rubric";
import type { Persona, Scenario } from "./personas";

// Env vars are read lazily so that .env is loaded before access
const env = () => ({
  BASE_URL: process.env.EVAL_BASE_URL ?? "https://interact-molt.vercel.app",
  LLM_HOST: process.env.LLM_HOST ?? "http://localhost:4000/v1",
  LLM_API_KEY: process.env.LLM_API_KEY ?? "",
  LLM_MODEL:
    process.env.EVAL_SIM_MODEL ?? process.env.LLM_MODEL_NAME ?? "default",
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
  const llmStart = Date.now();
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
  console.log(`[persona] LLM responded in ${((Date.now() - llmStart) / 1000).toFixed(1)}s`);
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
export interface SimulateOptions {
  browser?: Browser;
  screenshotsDir?: string;
  videosDir?: string;
}

export async function simulatePersona(
  persona: Persona,
  scenario: Scenario,
  browserOrOpts?: Browser | SimulateOptions,
  screenshotsDir?: string,
): Promise<SessionArtifacts> {
  // Support both old signature (browser, screenshotsDir) and new options object
  let browser: Browser | undefined;
  let opts: SimulateOptions = {};
  if (browserOrOpts && "newContext" in browserOrOpts) {
    browser = browserOrOpts;
    opts = { browser, screenshotsDir };
  } else if (browserOrOpts) {
    opts = browserOrOpts as SimulateOptions;
    browser = opts.browser;
  }

  const ownBrowser = !browser;
  if (!browser) {
    browser = await chromium.launch({ headless: true });
  }

  // Enable video recording if videosDir is provided
  const contextOptions: Parameters<Browser["newContext"]>[0] = {};
  if (opts.videosDir) {
    fs.mkdirSync(opts.videosDir, { recursive: true });
    contextOptions.recordVideo = {
      dir: opts.videosDir,
      size: { width: 1280, height: 720 },
    };
  }

  const context = await browser.newContext(contextOptions);
  const interactionLog: { timestamp: string; elapsed: number; event: string; detail: string }[] = [];
  const page = await context.newPage();

  // Session-scoped timer for elapsed-time logging
  const t0 = Date.now();
  const log = (msg: string) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${elapsed.padStart(5)}s] ${msg}`);
  };
  const logInteraction = (event: string, detail: string) => {
    const elapsed = (Date.now() - t0) / 1000;
    interactionLog.push({
      timestamp: new Date().toISOString(),
      elapsed: Math.round(elapsed * 10) / 10,
      event,
      detail,
    });
  };
  const slug = `${persona.id ?? persona.name}-${scenario.id ?? scenario.name}`;

  try {
    log(
      `[simulate] ${persona.name} (${persona.skillLevel}) × ${scenario.name}`,
    );

    const { BASE_URL } = env();

    // Step 1: Create portfolio
    log(`[simulate] Navigating to ${BASE_URL}/portfolios/new`);
    await page.goto(`${BASE_URL}/portfolios/new`);
    await page.locator("#title").fill(scenario.title);
    await page.locator('[data-testid="create-portfolio-btn"]').click();
    await page.waitForURL(/\/portfolios\/[a-f0-9-]+/, { timeout: 15000 });
    const portfolioId = page.url().split("/portfolios/")[1]?.split("?")[0];
    log(`[simulate] Created portfolio: ${portfolioId}`);

    // Re-navigate with ?skipConflicts=true to disable the 25s conflict detection LLM call
    await page.goto(`${BASE_URL}/portfolios/${portfolioId}?skipConflicts=true`);
    await page.waitForLoadState("domcontentloaded");

    // Step 2: Enter intent
    // The intent editor is a dynamically-loaded @uiw/react-md-editor.
    // We must wait for its textarea to mount and use keyboard input so that
    // React's onChange fires and structuredIntent updates.
    const intentEditor = page.locator('[data-testid="intent-editor"]');
    await intentEditor.waitFor({ state: "visible" });
    log(`[simulate] Intent editor visible, waiting for textarea to mount...`);
    const textarea = intentEditor.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.click();
    // Use pressSequentially instead of fill() — fill() may not trigger React onChange
    // for the MDEditor component. pressSequentially dispatches real keyboard events.
    await textarea.pressSequentially(scenario.intent, { delay: 5 });
    log(`[simulate] Intent entered: "${scenario.intent.slice(0, 60)}..."`);
    logInteraction("intent-entered", scenario.intent.slice(0, 100));

    const initialIntent = scenario.intent;

    // Step 3: Generate form
    // Verify the button is enabled before clicking
    const generateBtn = page.locator('[data-testid="generate-form-btn"]');
    await generateBtn.waitFor({ state: "visible" });
    const isDisabled = await generateBtn.isDisabled();
    log(`[simulate] generate-form-btn disabled=${isDisabled}`);
    if (isDisabled) {
      log(`[simulate] ❌ Generate button is disabled — intent may not have been registered`);
      const currentValue = await textarea.inputValue();
      log(`[simulate] Textarea value: "${currentValue.slice(0, 80)}..."`);
      throw new Error("Generate button is disabled after entering intent");
    }
    log(`[simulate] Clicking generate-form-btn...`);
    const genStart = Date.now();
    await generateBtn.click();

    // Wait for generation to start (button shows loading state)
    log(`[simulate] Waiting for form generation (timeout: 120s)...`);
    await page
      .locator('[data-testid="generate-form-btn"][data-loading="true"]')
      .waitFor({ state: "attached", timeout: 5000 })
      .catch(() => {
        /* may already be done */
      });

    // Wait for form fields to appear
    await page
      .locator('[data-testid="form-renderer"]')
      .waitFor({ state: "visible", timeout: 120000 });
    log(`[simulate] form-renderer visible, waiting for first form field...`);
    await page
      .locator('[data-testid^="form-field-"]')
      .first()
      .waitFor({ state: "visible", timeout: 30000 });

    const genDuration = ((Date.now() - genStart) / 1000).toFixed(1);
    const initialFieldCount = await page.locator('[data-testid^="form-field-"]').count();
    log(`[simulate] Form generated in ${genDuration}s (${initialFieldCount} fields), waiting for design probes...`);
    logInteraction("form-generated", `${initialFieldCount} fields in ${genDuration}s`);

    // Screenshot after form generation
    if (opts.screenshotsDir) {
      const ssPath = path.join(opts.screenshotsDir, `${slug}-after-gen.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
    }

    // Step 4: Wait for and resolve design probe cards
    // Design probes are generated asynchronously (fire-and-forget LLM call after
    // schema generation). We need to poll until they appear in the UI.
    const resolvedProbes: SessionArtifacts["designProbes"] = [];

    // Poll for design probe cards to appear (up to 60s)
    const probeTimeout = 60000;
    const pollInterval = 3000;
    const probeDeadline = Date.now() + probeTimeout;
    const probePollStart = Date.now();
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
          const pollDuration = ((Date.now() - probePollStart) / 1000).toFixed(1);
          log(`[simulate] ${cardCount} design probe card(s) appeared (waited ${pollDuration}s)`);
          break;
        }
      }
      log(
        `[simulate] No design probes yet, polling... (${Math.round((probeDeadline - Date.now()) / 1000)}s remaining)`,
      );
      await page.waitForTimeout(pollInterval);
    }

    if (!probesAppeared) {
      log(
        `[simulate] ⚠️ No design probes appeared within ${probeTimeout / 1000}s — continuing without`,
      );
    }

    // Resolve design probe cards
    let maxRounds = 8; // Safety limit
    while (maxRounds > 0 && probesAppeared) {
      maxRounds--;

      // Find the first pending design probe card's options
      const probeCards = page.locator('[data-testid^="deck-card-"]');
      const cardCount = await probeCards.count();
      if (cardCount === 0) break;

      const firstCard = probeCards.first();
      const questionText =
        (await firstCard.locator(".font-medium").first().textContent()) ?? "";

      // Extract options from buttons
      const optionButtons = firstCard.locator('[data-testid^="deck-option-"]');
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
      const chosenValue = await personaDecision(persona, questionText, options);
      const chosenLabel =
        options.find((o) => o.value === chosenValue)?.label ?? chosenValue;

      const rejectedLabels = options
        .filter((o) => o.value !== chosenValue)
        .map((o) => o.label);

      log(`[simulate] Design probe: "${questionText}" → "${chosenLabel}"`);
      logInteraction("probe-resolved", `"${questionText}" → "${chosenLabel}" (rejected: ${rejectedLabels.join(", ")})`);

      // Click the chosen option
      const cardCountBefore = await probeCards.count();
      const resolveStart = Date.now();
      await page.locator(`[data-testid="deck-option-${chosenValue}"]`).click();
      resolvedProbes.push({
        text: questionText,
        selectedLabel: chosenLabel,
        status: "resolved",
      });

      // Screenshot after probe resolution
      if (opts.screenshotsDir) {
        const probeIndex = resolvedProbes.length;
        const ssPath = path.join(opts.screenshotsDir, `${slug}-probe-${probeIndex}.png`);
        // Wait briefly for UI to settle, then capture
        await page.waitForTimeout(500);
        await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
      }

      // Wait for the resolved probe card to disappear from the DOM.
      // The resolve triggers an LLM round-trip (schema update), after which
      // the probe status changes from "pending" → "resolved" and the card
      // is removed from the filtered list. Also wait for buttons to re-enable
      // (anyLoading becomes false when the mutation completes).
      log(`[simulate] Waiting for probe resolution...`);
      try {
        // Wait for card count to decrease (resolved probe removed from DOM)
        await page.waitForFunction(
          (expectedCount) => {
            const cards = document.querySelectorAll(
              '[data-testid^="deck-card-"]',
            );
            return cards.length < expectedCount;
          },
          cardCountBefore,
          { timeout: 120000 },
        );
        // Wait for the deck to finish loading (mutation complete, buttons re-enabled)
        await page
          .locator(
            '[data-testid="card-deck-section"]:not([data-loading="true"])',
          )
          .waitFor({ state: "attached", timeout: 10000 })
          .catch(() => {
            /* deck may have been removed entirely */
          });
        const resolveDuration = ((Date.now() - resolveStart) / 1000).toFixed(1);
        log(`[simulate] Probe resolved (${resolveDuration}s)`);
      } catch {
        const resolveDuration = ((Date.now() - resolveStart) / 1000).toFixed(1);
        log(`[simulate] ⚠️ Probe resolution timed out after ${resolveDuration}s — continuing`);
      }
    }

    // Step 5: Collect final state
    const finalIntentEl = page.locator(
      '[data-testid="intent-editor"] textarea',
    );
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

    // Final screenshot
    if (opts.screenshotsDir) {
      const ssPath = path.join(opts.screenshotsDir, `${slug}-final.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
    }
    logInteraction("session-complete", `${fieldCount} fields, ${resolvedProbes.length} probes resolved`);

    // Fetch enriched data from Supabase (schema JSON + provenance log)
    let schemaJson: object | null = null;
    let provenanceLog: object[] = [];
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseKey && portfolioId) {
      try {
        // Fetch schema
        const schemaRes = await fetch(
          `${supabaseUrl}/rest/v1/portfolios?id=eq.${portfolioId}&select=schema`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
        );
        if (schemaRes.ok) {
          const rows = await schemaRes.json();
          schemaJson = rows[0]?.schema ?? null;
        }

        // Fetch provenance
        const provRes = await fetch(
          `${supabaseUrl}/rest/v1/provenance_log?portfolio_id=eq.${portfolioId}&order=created_at.asc`,
          { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
        );
        if (provRes.ok) {
          provenanceLog = await provRes.json();
        }
      } catch (err) {
        log(`[simulate] ⚠️ Supabase fetch failed: ${err}`);
      }
    }

    const totalDuration = ((Date.now() - t0) / 1000).toFixed(1);
    log(
      `[simulate] Done: ${fieldCount} fields, ${resolvedProbes.length} probes resolved (total: ${totalDuration}s)`,
    );

    // Save video path if recording
    let videoPath: string | undefined;
    if (opts.videosDir) {
      const video = page.video();
      if (video) {
        videoPath = await video.path();
      }
    }

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
      provenanceEntries: provenanceLog.length || resolvedProbes.length + 1,
      provenanceSummary: `Intent updated once. ${resolvedProbes.length} design probe resolutions recorded.`,
      // Enriched fields (for CDN evidence collection)
      ...(interactionLog.length > 0 && { interactionLog }),
      ...(schemaJson && { schemaJson }),
      ...(provenanceLog.length > 0 && { provenanceLog }),
      ...(videoPath && { videoPath }),
    };
  } catch (err) {
    // Save a screenshot for debugging failed sessions
    const outDir =
      opts.screenshotsDir ?? path.join(__dirname, "results", "screenshots");
    fs.mkdirSync(outDir, { recursive: true });
    const screenshotPath = path.join(outDir, `${slug}-failure.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log(`[simulate] ❌ Screenshot saved: ${screenshotPath}`);
    throw err;
  } finally {
    await context.close();
    if (ownBrowser) await browser.close();
  }
}
