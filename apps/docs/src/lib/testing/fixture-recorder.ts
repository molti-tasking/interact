import fs from "fs";
import path from "path";

import type { FixtureEntry } from "./fixture-types";

/**
 * Records server action calls to disk for later replay.
 * Activated only when RECORD_FIXTURES=true.
 * Files are written to tests/fixtures/_recording-session/[<scenario>/].
 */

const FIXTURES_DIR = path.resolve(process.cwd(), "tests/fixtures");
const RECORDING_ROOT = path.join(FIXTURES_DIR, "_recording-session");

/**
 * Where this call is recorded: a folder per scenario when a test named one
 * (`tests/fixtures/.active-scenario`, as for replay), so several scenarios
 * can be recorded in one run of the server.
 */
function sessionDir(): string {
  try {
    const active = fs
      .readFileSync(path.join(FIXTURES_DIR, ".active-scenario"), "utf-8")
      .trim()
      .split(":")[0];
    if (/^[a-z0-9][a-z0-9-]*$/i.test(active)) return path.join(RECORDING_ROOT, active);
  } catch {
    // No scenario named: the session folder itself
  }
  return RECORDING_ROOT;
}

// Per-action call counter (resets each server restart)
const callCounters = new Map<string, number>();

export function recordFixture(
  actionName: string,
  input: unknown,
  output: unknown,
  matchHints?: FixtureEntry["matchHints"],
): void {
  const index = callCounters.get(actionName) ?? 0;
  callCounters.set(actionName, index + 1);

  const entry: FixtureEntry = {
    actionName,
    callIndex: index,
    input,
    output,
    timestamp: new Date().toISOString(),
    matchHints,
  };

  const SESSION_DIR = sessionDir();
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  const globalStep = fs
    .readdirSync(SESSION_DIR)
    .filter((f) => f.endsWith(".json")).length;
  const filename = `${String(globalStep).padStart(3, "0")}-${actionName}.json`;
  fs.writeFileSync(
    path.join(SESSION_DIR, filename),
    JSON.stringify(entry, null, 2),
  );
}
