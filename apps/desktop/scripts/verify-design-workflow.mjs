import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.ARTEMIS_DESIGN_UI_OUTPUT ?? tmpdir();
await mkdir(base, { recursive: true });
const output = await mkdtemp(join(base, "artemis-design-ui-"));
const electron = createRequire(import.meta.url)("electron");
const desktop = fileURLToPath(new URL("../", import.meta.url));
const results = [];
for (const theme of ["light", "dark"]) {
  const screenshot = join(output, `${theme}.png`);
  const env = {
    ...process.env,
    ARTEMIS_SMOKE_SCREENSHOT: screenshot,
    ARTEMIS_SMOKE_VIEW: "design-workflow",
    ARTEMIS_SMOKE_THEME: theme,
    ARTEMIS_SMOKE_LOCALE: "zh-CN",
    ARTEMIS_SMOKE_WINDOW_WIDTH: "1540",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    electron,
    [
      desktop,
      `--user-data-dir=${join(output, `${theme}-profile`)}`,
      "--disable-gpu",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk;
  });
  child.stderr.on("data", (chunk) => {
    log += chunk;
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 60000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(deadline);
  await writeFile(join(output, `${theme}.log`), log);
  const checks = JSON.parse(
    await readFile(`${screenshot}.design-checks.json`, "utf8"),
  );
  const passed =
    code === 0 &&
    checks.length >= 30 &&
    checks.every((check) => check.passed) &&
    !log.includes("Smoke validation failed");
  results.push({ theme, passed, checks });
  console.log(`${theme}: ${passed ? "passed" : "failed"}`);
}
await writeFile(join(output, "report.json"), JSON.stringify(results, null, 2));
console.log(`Design UI evidence: ${output}`);
process.exitCode = results.every((result) => result.passed) ? 0 : 1;
