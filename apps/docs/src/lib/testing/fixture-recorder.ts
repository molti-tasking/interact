import fs from "fs";
import path from "path";

import type { FixtureEntry } from "./fixture-types";

/**
 * Records server action calls to disk for later replay.
 * Activated only when RECORD_FIXTURES=true.
 * Files are written to tests/fixtures/_recording-session/.
 */

const SESSION_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/_recording-session",
);

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
