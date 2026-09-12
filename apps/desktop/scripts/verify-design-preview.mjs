import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const head = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const dirty = Boolean(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
);
if (
  process.env.ARTEMIS_EXPECTED_HEAD &&
  process.env.ARTEMIS_EXPECTED_HEAD !== head
)
  throw new Error("Design P0 checkout does not match the expected commit.");
if (process.env.ARTEMIS_EXPECTED_HEAD && dirty)
  throw new Error(
    "Design P0 expected-head validation requires a clean checkout.",
  );
const base = process.env.ARTEMIS_DESIGN_P0_OUTPUT ?? tmpdir();
await mkdir(base, { recursive: true });
const output = await mkdtemp(join(base, "artemis-design-p0-"));
await build({
  entryPoints: [
    "design-source",
    "design-store",
    "design-watchdog",
    "design-preview-host",
    "design-export",
  ].map((name) =>
    fileURLToPath(new URL(`../src/main/${name}.ts`, import.meta.url)),
  ),
  outdir: output,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
const env = {
  ...process.env,
  ARTEMIS_DESIGN_P0_OUTPUT: output,
  ARTEMIS_DESIGN_P0_HEAD: head,
  ARTEMIS_DESIGN_P0_DIRTY: String(dirty),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  createRequire(import.meta.url)("electron"),
  [fileURLToPath(new URL("./design-p0/preview.cjs", import.meta.url))],
  { env, stdio: "inherit" },
);
const timeout = setTimeout(() => child.kill("SIGKILL"), 35000);
const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", resolve);
});
clearTimeout(timeout);
console.log(`Design P0 evidence: ${output}`);
let passed = false;
try {
  const report = JSON.parse(
    await readFile(join(output, "report.json"), "utf8"),
  );
  console.log(JSON.stringify(report, null, 2));
  passed =
    !report.error &&
    report.checks.length === 13 &&
    report.checks.every((check) => check.passed);
} catch {
  console.error("Native probe did not produce a report.");
}
process.exitCode = code === 0 && passed ? 0 : 1;

if (process.exitCode !== 1) {
  const production = spawn(
    createRequire(import.meta.url)("electron"),
    [fileURLToPath(new URL("./design-p0/production.cjs", import.meta.url))],
    { env, stdio: "inherit" },
  );
  const deadline = setTimeout(() => production.kill("SIGKILL"), 60000);
  const exit = await new Promise((resolve, reject) => {
    production.once("error", reject);
    production.once("exit", resolve);
  });
  clearTimeout(deadline);
  const result = JSON.parse(
    await readFile(join(output, "production-report.json"), "utf8"),
  );
  console.log(JSON.stringify(result, null, 2));
  process.exitCode =
    exit === 0 &&
    result.checks.length >= 14 &&
    result.checks.every((item) => !item.error && item.passed !== false)
      ? 0
      : 1;
}
