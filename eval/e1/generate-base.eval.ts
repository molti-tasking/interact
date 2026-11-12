/**
 * Freeze each scenario's base form: generated once from its intent with the
 * app's own first-generation action (`intentToSchemaAction`), then never
 * regenerated. An existing `base-schema.json` is left alone; to regenerate
 * one, delete it and record why in eval/DEVIATIONS.md.
 *
 *   eval/run.sh e1/generate-base.eval.ts      (EVAL_NO_DB=1 is enough)
 */
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { intentToSchemaAction } from "@/app/actions/schema-actions";
import { buildSchemaGenerationRequest } from "@/lib/schema-generation";
import { serializeForLLM } from "interact/forms/structured-intent";
import { assertEvalEnvironment } from "../lib/env";
import { sha256 } from "../lib/hash";
import { Budget, onCall, withCalls } from "../lib/ledger";
import { loadIntent, SCENARIOS, scenarioDir } from "./material";

const OUT = path.resolve(__dirname, "../out");
const CAP_USD = 40;

it("freezes the base forms", async () => {
  assertEvalEnvironment({ model: true, database: false });
  const budget = new Budget(path.join(OUT, "spend.json"), CAP_USD);
  const stop = onCall((call) => budget.add(call));
  const log: string[] = [];

  try {
    for (const name of SCENARIOS) {
      const dir = scenarioDir(name);
      const target = path.join(dir, "base-schema.json");
      if (fs.existsSync(target)) {
        log.push(`${name}: kept (already frozen)`);
        continue;
      }
      if (!budget.fits(0.1)) throw new Error(`Budget: $${budget.remaining.toFixed(3)} left`);

      const { intent } = loadIntent(name);
      // The same request the action builds, hashed for the record
      const request = buildSchemaGenerationRequest(serializeForLLM(intent));
      const { value, calls } = await withCalls(() => intentToSchemaAction(intent));
      if (!value.success || !value.result) {
        throw new Error(`${name}: generation failed: ${value.error}`);
      }
      const schema = value.result.artifactFormSchema;
      fs.writeFileSync(target, `${JSON.stringify(schema, null, 2)}\n`);
      fs.writeFileSync(
        path.join(dir, "base-schema.meta.json"),
        `${JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            action: "intentToSchemaAction",
            model: calls[0]?.model,
            promptSha256: sha256(`${request.system}\n\n${request.prompt}`),
            calls: calls.map(({ output: _output, ...c }) => c),
            fields: schema.fields.length,
          },
          null,
          2,
        )}\n`,
      );
      const cost = calls.reduce((s, c) => s + c.costUsd, 0);
      log.push(`${name}: ${schema.fields.length} fields, ${calls.length} call(s), $${cost.toFixed(4)}`);
    }
  } finally {
    stop();
  }
  process.stderr.write(`\nBASE ${JSON.stringify({ log, spentUsd: budget.spent })}\n`);
});
