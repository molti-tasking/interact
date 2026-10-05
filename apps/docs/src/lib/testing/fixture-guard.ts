import type { FixtureEntry } from "./fixture-types";

/**
 * Env-gated fixture guard for server actions.
 *
 * Three modes:
 * - Normal (no env vars): passthrough, calls realFn
 * - Replay (USE_FIXTURES=true): returns recorded fixture, no LLM call
 * - Record (RECORD_FIXTURES=true): calls realFn, then saves input+output to disk
 *
 * Production builds always pass through: a stray USE_FIXTURES must not serve
 * canned answers, and RECORD_FIXTURES must never write respondent data to disk.
 */
export async function fixtureGuard<T>(
  actionName: string,
  input: unknown,
  realFn: () => Promise<T>,
  matchHints?: FixtureEntry["matchHints"],
): Promise<T> {
  if (process.env.NODE_ENV === "production") return realFn();

  const useFixtures = process.env.USE_FIXTURES === "true";
  const recordFixtures = process.env.RECORD_FIXTURES === "true";

  // REPLAY mode: return recorded fixture
  if (useFixtures && !recordFixtures) {
    const { loadFixture } = await import("./fixture-loader");
    return loadFixture<T>(actionName, input);
  }

  // Execute the real function
  const result = await realFn();

  // RECORD mode: save the result alongside real execution. A failed write
  // (read-only FS, permissions) must not fail the action itself.
  if (recordFixtures) {
    try {
      const { recordFixture } = await import("./fixture-recorder");
      recordFixture(actionName, input, result, matchHints);
    } catch (error) {
      console.warn(
        `[fixture-guard] Could not record fixture for ${actionName}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return result;
}
