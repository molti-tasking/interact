/**
 * Print the hash of E1's material (scenarios, prompts, compatibility table,
 * measures, pipelines) and of the prompts, for eval/FROZEN.md.
 *
 *   EVAL_NO_DB=1 eval/run.sh e1/hash.eval.ts
 */
import { it } from "vitest";
import { promptHashes } from "./pipelines";
import { materialHash } from "./material";

it("prints the material hash", () => {
  process.stderr.write(`\nHASH ${JSON.stringify({ e1Material: materialHash(), prompts: promptHashes() })}\n`);
});
