import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { verificationOutput } from "../../../../../scripts/artifacts/output-path.mjs";

const output = resolve(
  process.env.ARTEMIS_VERIFY_OUTPUT ??
    verificationOutput("computer-browser-input"),
);
await mkdir(output, { recursive: true });
const entry = `${output}/fixture.mjs`;
await build({
  entryPoints: [
    fileURLToPath(
      new URL(
        "../../../test/fixtures/computer-browser-input-electron.ts",
        import.meta.url,
      ),
    ),
  ],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["electron"],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
});
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
console.log(`Browser input evidence: ${output}`);
const child = spawn(
  createRequire(import.meta.url)("electron"),
  [entry, output],
  { env: environment, stdio: "inherit" },
);
const timer = setTimeout(() => child.kill("SIGKILL"), 45000);
child.once("error", (error) => {
  clearTimeout(timer);
  throw error;
});
child.once("exit", (code) => {
  clearTimeout(timer);
  process.exitCode = code === 0 ? 0 : 1;
});
