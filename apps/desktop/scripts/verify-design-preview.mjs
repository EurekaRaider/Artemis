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
if (
  process.env.ARTEMIS_EXPECTED_HEAD &&
  process.env.ARTEMIS_EXPECTED_HEAD !== head
)
  throw new Error("Design P0 checkout does not match the expected commit.");
const base = process.env.ARTEMIS_DESIGN_P0_OUTPUT ?? tmpdir();
await mkdir(base, { recursive: true });
const output = await mkdtemp(join(base, "artemis-design-p0-"));
await build({
  entryPoints: ["design-source", "design-store"].map((name) =>
    fileURLToPath(new URL(`../src/main/${name}.ts`, import.meta.url)),
  ),
  outdir: output,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
});
const env = {
  ...process.env,
  ARTEMIS_DESIGN_P0_OUTPUT: output,
  ARTEMIS_DESIGN_P0_HEAD: head,
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
    report.checks.length === 12 &&
    report.checks.every((check) => check.passed);
} catch {
  console.error("Native probe did not produce a report.");
}
process.exitCode = code === 0 && passed ? 0 : 1;
