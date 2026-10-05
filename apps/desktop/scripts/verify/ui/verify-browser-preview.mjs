import { build } from "esbuild";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";
const output = resolve(
  process.argv[2] ?? verificationOutput("browser-preview"),
);
await mkdir(output, { recursive: true });
await rm(join(output, "result.json"), { force: true });
const base = "apps/desktop/test/fixtures/browser-preview-";
await build({
  entryPoints: [base + "renderer.tsx"],
  bundle: true,
  outfile: join(output, "renderer.js"),
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  loader: {
    ".svg": "dataurl",
    ".woff2": "file",
    ".woff": "file",
    ".ttf": "file",
    ".png": "dataurl",
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const entry of ["electron", "preload"])
  await build({
    entryPoints: [base + entry + ".ts"],
    bundle: true,
    outfile: join(output, entry === "electron" ? "main.cjs" : "preload.cjs"),
    format: "cjs",
    platform: "node",
    external: ["electron"],
  });
await writeFile(
  join(output, "index.html"),
  '<!doctype html><title>Browser preview verification</title><link rel="stylesheet" href="renderer.css"><style>html,body,#root{margin:0;width:100%;height:100%;background:var(--bg);color:var(--text)}textarea[aria-label="Chat draft"]{box-sizing:border-box;width:100%;height:90px;background:var(--panel);color:var(--text);border:1px solid var(--border)} .browser-panel{width:100%}</style><div id="root"></div><script src="renderer.js"></script>',
);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  createRequire(import.meta.url)("electron"),
  [join(output, "main.cjs"), output],
  { env: environment, stdio: "inherit" },
);
process.exitCode = await new Promise((done) =>
  child.on("exit", (code) => done(code ?? 1)),
);
console.log(`Browser preview evidence: ${output}`);
