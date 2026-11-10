import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/unit/setup.ts"],
    // The engine package's own tests run here too (it has no test runner
    // of its own; `pnpm test` covers both)
    include: [
      "**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "../../packages/interact/tests/**/*.test.ts",
    ],
    exclude: ["tests/e2e/**", "tests/screenshots/**", "tests/demo/**", "tests/evaluation/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
