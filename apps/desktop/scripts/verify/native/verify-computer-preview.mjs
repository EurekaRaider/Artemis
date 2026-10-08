import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
if (process.platform !== "darwin")
  throw new Error(
    "This native preview fixture requires macOS 14+. Verify the Windows GPU module on Windows 11.",
  );
const root = fileURLToPath(new URL("../../../../..", import.meta.url));
const evidence = resolve(
  process.env.ARTEMIS_PREVIEW_EVIDENCE ??
    join(
      root,
      "artifacts/verification/computer-preview",
      new Date().toISOString().replace(/[:.]/g, "-"),
    ),
);
await mkdir(evidence, { recursive: true });
await Promise.all([
  build({
    entryPoints: [
      join(root, "apps/desktop/test/fixtures/computer-preview-electron.ts"),
    ],
    outfile: join(evidence, "fixture.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["electron"],
    target: "node24",
  }),
  build({
    entryPoints: [
      join(root, "apps/desktop/test/fixtures/computer-preview-renderer.tsx"),
    ],
    outfile: join(evidence, "renderer.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
  }),
]);
await writeFile(
  join(evidence, "index.html"),
  '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>html,body,#root{margin:0;width:100%;height:100%}</style><div id="root"></div><script src="renderer.js"></script>',
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require("electron"),
  [
    join(evidence, "fixture.mjs"),
    evidence,
    join(root, "apps/desktop/dist-electron/preload.cjs"),
    join(
      root,
      "apps/desktop/build/computer-use/development/artemis-computer-use",
    ),
    join(
      root,
      "apps/desktop/build/computer-use/development/artemis-computer-preview.node",
    ),
    process.env.ARTEMIS_PREVIEW_DURATION_SECONDS ?? "12",
  ],
  { env: environment, stdio: "inherit" },
);
child.once("exit", (code) => {
  console.log("Preview evidence: " + evidence);
  process.exitCode = code ?? 1;
});
