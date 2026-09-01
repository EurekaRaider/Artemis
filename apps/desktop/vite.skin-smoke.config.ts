import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function requiredFixturePath(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the dedicated skin smoke build.`);
  }
  return resolve(value);
}

function skinSmokeAliases(): Plugin {
  const appWrapper = requiredFixturePath("ARTEMIS_SKIN_SMOKE_APP_WRAPPER");
  const registry = requiredFixturePath("ARTEMIS_SKIN_SMOKE_REGISTRY");
  const productionApp = resolve(import.meta.dirname, "src/renderer/App.tsx");
  const productionBootstrap = resolve(
    import.meta.dirname,
    "src/renderer/desktop-skin-bootstrap.ts",
  );

  return {
    name: "artemis-dedicated-skin-smoke-aliases",
    enforce: "pre",
    resolveId(source, importer) {
      const normalizedImporter = importer?.split("?", 1)[0];
      if (source === "./App.js" && normalizedImporter?.endsWith("/main.tsx")) {
        return appWrapper;
      }
      if (
        source === "./desktop-skin-registry.js" &&
        normalizedImporter === productionBootstrap
      ) {
        return registry;
      }
      if (source === productionApp) return productionApp;
      return undefined;
    },
  };
}

export default defineConfig({
  plugins: [skinSmokeAliases(), react()],
  base: "./",
  resolve: {
    alias: [
      {
        find: /^react$/u,
        replacement: resolve(
          import.meta.dirname,
          "../../node_modules/react/index.js",
        ),
      },
      {
        find: /^react\/(jsx-runtime|jsx-dev-runtime)$/u,
        replacement: resolve(
          import.meta.dirname,
          "../../node_modules/react/$1.js",
        ),
      },
      {
        find: "@artemis/theme-artemis/manifest.json",
        replacement: resolve(
          import.meta.dirname,
          "../../packages/theme-artemis/dist/manifest.json",
        ),
      },
    ],
  },
  build: {
    outDir: "dist-renderer-skin-smoke",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
});
