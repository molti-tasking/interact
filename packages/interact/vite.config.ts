import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.ts",
      name: "Interact",
      fileName: (format) =>
        format === "es" ? "interact.es.mjs" : "interact.cjs",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["react", "react-dom"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
    sourcemap: true,
    // We currently generate types first, and then the vite build (which by default removes all types), so for the moment we configure vite to NOT remove the earlier assets. Alternatively, we should switch the order of the steps in the build command, which requires implicit knowledge about the build process of vite. This is why I prefer this explicit statement at this place.
    emptyOutDir: false,
  },
});
