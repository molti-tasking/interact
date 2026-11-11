import path from "path";
import { defineConfig } from "vitest/config";

/** Config for the replay run only (`run-replay.ts`) — not part of `pnpm test`. */
const root = path.resolve(__dirname, "../../..");

export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["tests/evaluation/replay/replay.eval.ts"],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60 * 1000,
    // One file, one test: nothing to isolate, and the output should stream
    fileParallelism: false,
    reporters: ["default"],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
    },
  },
});
