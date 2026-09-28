import { build } from "vite";
import { resolve } from "node:path";
await build({
  configFile: false,
  ssr: { noExternal: true },
  build: {
    ssr: resolve("scripts/office/verify-public-windows.ts"),
    outDir: resolve("artifacts/office/public-tools"),
    emptyOutDir: true,
    rolldownOptions: {
      output: { entryFileNames: "verify-public-windows.mjs" },
    },
  },
});
