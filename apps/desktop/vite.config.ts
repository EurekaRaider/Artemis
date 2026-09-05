import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { desktopCssOptimization } from "../../scripts/desktop-css-optimization.mjs";

export default defineConfig({
  plugins: [react(), desktopCssOptimization()],
  base: "./",
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
});
