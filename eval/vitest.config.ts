import path from "path";
import { defineConfig } from "vitest/config";

/**
 * The evaluation's scripts run under vitest, like the app's replay
 * evaluation: the app's server actions are imported as they are, and only
 * auth and tracing are stubbed (`lib/setup.ts`).
 *
 *   *.test.ts  pure parts (measures, generators); no model, no database
 *   *.eval.ts  experiments; started through `eval/run.sh`, which loads
 *              eval/.env.eval and checks the environment first
 *
 * `eval/node_modules` is a symlink to apps/docs/node_modules (git-ignored),
 * so these files resolve the app's packages.
 */
const here = __dirname;
const app = path.resolve(here, "../apps/docs");

export default defineConfig({
  root: here,
  test: {
    // The app's Supabase client is the browser one; integration tests run it in jsdom too
    environment: "jsdom",
    include: process.env.EVAL_SCRIPT ? [process.env.EVAL_SCRIPT] : ["**/*.test.ts"],
    exclude: ["node_modules/**", ".worktrees/**", "out/**"],
    setupFiles: [path.join(here, "lib/setup.ts")],
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.join(app, "src"),
    },
  },
});
