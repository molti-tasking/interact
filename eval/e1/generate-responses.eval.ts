/**
 * Write each scenario's `responses.json`: 30 synthetic responses to its
 * frozen base form, from the seeded generator (`responses.ts`). No model, no
 * database. Deterministic: running it again rewrites identical files.
 *
 *   EVAL_NO_DB=1 eval/run.sh e1/generate-responses.eval.ts
 */
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { generateResponses } from "./responses";
import { loadBaseSchema, SCENARIOS, scenarioDir } from "./material";

it("writes the seeded responses", () => {
  for (const name of SCENARIOS) {
    const responses = generateResponses(name, loadBaseSchema(name));
    const file = path.join(scenarioDir(name), "responses.json");
    const text = `${JSON.stringify(responses, null, 2)}\n`;
    if (fs.existsSync(file)) {
      // Frozen: regenerating must give the same file
      expect(fs.readFileSync(file, "utf-8")).toBe(text);
    } else {
      fs.writeFileSync(file, text);
    }
  }
});
