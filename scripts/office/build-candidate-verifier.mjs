import { build } from "vite";
import { resolve } from "node:path";
await build({
  configFile: false,
  ssr: { noExternal: true },
  build: {
    ssr: resolve("scripts/office/verify-candidate.ts"),
    outDir: resolve("artifacts/office/candidate-tools"),
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: "verify-candidate.mjs" } },
  },
});
