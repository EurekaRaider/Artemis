import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { desktopCssOptimization } from "../../scripts/build/desktop-css-optimization.mjs";

export default defineConfig({
  plugins: [react(), desktopCssOptimization()],
  base: "./",
  build: {
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
