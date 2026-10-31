import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { desktopCssOptimization } from "../../scripts/build/desktop-css-optimization.mjs";
import { desktopLocaleOptimization } from "../../scripts/build/desktop-locale-optimization.mjs";

export default defineConfig({
  plugins: [react(), desktopCssOptimization(), desktopLocaleOptimization()],
  base: "./",
  build: {
    // Desktop runs Electron 43 / Chromium 150, including native CSS nesting.
    cssTarget: "chrome150",
    assetsInlineLimit(filePath) {
      // Keep provider artwork out of CSS and share one emitted asset per icon.
      if (filePath.replaceAll("\\", "/").includes("/settings/assets/"))
        return false;
      return undefined;
    },
    outDir: "dist-renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
});
