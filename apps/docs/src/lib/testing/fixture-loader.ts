import fs from "fs";
import path from "path";

import type { FixtureEntry } from "./fixture-types";

/**
 * Loads recorded fixtures for server action replay during tests.
 *
 * The active scenario is read from tests/fixtures/.active-scenario
 * (written by Playwright beforeEach). Fixtures are loaded from the
 * corresponding scenario directory.
 *
 * Matching strategy:
 * 1. Read all fixture files for this action in the scenario dir
 * 2. Sort by filename (preserves recording order)
 * 3. For resolveOpinionInteraction: try matchHint-based lookup first
 * 4. Fallback: return the Nth fixture (N = call count for this action)
 */

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const SCENARIO_FILE = path.join(FIXTURES_DIR, ".active-scenario");

// Stateful call counters — reset when scenario token changes
const callCounters = new Map<string, number>();
let lastScenarioToken: string | null = null;

// Cache parsed fixture files per scenario to avoid repeated disk reads
const fixtureCache = new Map<string, Map<string, FixtureEntry[]>>();

function getActiveScenario(): { scenario: string; token: string } {
  try {
    const raw = fs.readFileSync(SCENARIO_FILE, "utf-8").trim();
    const colonIndex = raw.indexOf(":");
    if (colonIndex === -1) {
      return { scenario: raw, token: raw };
    }
    return { scenario: raw.slice(0, colonIndex), token: raw };
  } catch {
    throw new Error(
      "No active fixture scenario. Write scenario name to tests/fixtures/.active-scenario",
    );
  }
}

function loadScenarioFixtures(scenario: string): Map<string, FixtureEntry[]> {
  if (fixtureCache.has(scenario)) {
    return fixtureCache.get(scenario)!;
  }

  const scenarioDir = path.join(FIXTURES_DIR, scenario);
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Fixture scenario directory not found: ${scenarioDir}`);
  }

  const allFiles = fs
    .readdirSync(scenarioDir)
    .filter((f) => f.endsWith(".json") && f !== "scenario.meta.json")
    .sort();

  const byAction = new Map<string, FixtureEntry[]>();

  for (const filename of allFiles) {
    const content = fs.readFileSync(
      path.join(scenarioDir, filename),
      "utf-8",
    );
    const entry: FixtureEntry = JSON.parse(content);
    const existing = byAction.get(entry.actionName) ?? [];
    existing.push(entry);
    byAction.set(entry.actionName, existing);
  }

  fixtureCache.set(scenario, byAction);
  return byAction;
}

export function loadFixture<T>(
  actionName: string,
  currentInput?: unknown,
): T {
  const { scenario, token } = getActiveScenario();

  // Reset counters when scenario token changes (new test started)
  if (token !== lastScenarioToken) {
    callCounters.clear();
    lastScenarioToken = token;
  }

  const scenarioFixtures = loadScenarioFixtures(scenario);
  const actionFixtures = scenarioFixtures.get(actionName);

  if (!actionFixtures || actionFixtures.length === 0) {
    throw new Error(
      `No fixtures found for action "${actionName}" in scenario "${scenario}"`,
    );
  }

  const callIndex = callCounters.get(actionName) ?? 0;
  callCounters.set(actionName, callIndex + 1);

  // Try hint-based matching first (for resolveOpinionInteraction)
  if (
    currentInput &&
    typeof currentInput === "object" &&
    "selectedOptionLabel" in currentInput
  ) {
    const selectedLabel = (currentInput as Record<string, unknown>)
      .selectedOptionLabel;
    const hintMatch = actionFixtures.find(
      (f) => f.matchHints?.selectedOptionLabel === selectedLabel,
    );
    if (hintMatch) {
      return hintMatch.output as T;
    }
  }

  // Fallback: sequential index
  if (callIndex >= actionFixtures.length) {
    throw new Error(
      `Fixture exhausted: action "${actionName}" called ${callIndex + 1} times ` +
        `but only ${actionFixtures.length} fixtures exist in "${scenario}"`,
    );
  }

  return actionFixtures[callIndex].output as T;
}

/** Explicitly reset counters (for testing the loader itself) */
export function resetFixtureState(): void {
  callCounters.clear();
  lastScenarioToken = null;
  fixtureCache.clear();
}
