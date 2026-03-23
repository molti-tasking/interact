import type { FixtureEntry } from "./fixture-types";

/**
 * Env-gated fixture guard for server actions.
 *
 * Three modes:
 * - Normal (no env vars): passthrough, calls realFn
 * - Replay (USE_FIXTURES=true): returns recorded fixture, no LLM call
 * - Record (RECORD_FIXTURES=true): calls realFn, then saves input+output to disk
 */
export async function fixtureGuard<T>(
  actionName: string,
  input: unknown,
  realFn: () => Promise<T>,
  matchHints?: FixtureEntry["matchHints"],
): Promise<T> {
  const useFixtures = process.env.USE_FIXTURES === "true";
  const recordFixtures = process.env.RECORD_FIXTURES === "true";

  // REPLAY mode: return recorded fixture
  if (useFixtures && !recordFixtures) {
    const { loadFixture } = await import("./fixture-loader");
    return loadFixture<T>(actionName, input);
  }

  // Execute the real function
  const result = await realFn();

  // RECORD mode: save the result alongside real execution
  if (recordFixtures) {
    const { recordFixture } = await import("./fixture-recorder");
    recordFixture(actionName, input, result, matchHints);
  }

  return result;
}
