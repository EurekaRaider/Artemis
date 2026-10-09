import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

if (process.platform !== "win32") throw new Error("Windows diagnostic only");
const run = promisify(execFile);
const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
const command = join(
  systemRoot,
  "System32/WindowsPowerShell/v1.0/powershell.exe",
);
const results = [];
for (const [name, pinModules] of [
  ["default-module-lookup", false],
  ["system-module-lookup", true],
]) {
  const started = performance.now();
  try {
    const result = await run(
      command,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        (pinModules
          ? "$env:PSModulePath=[System.IO.Path]::Combine($PSHOME,'Modules');"
          : "") +
          "[Console]::WriteLine('verifier-started');Write-Output 'verifier-completed'",
      ],
      {
        env: { SystemRoot: systemRoot },
        timeout: 10000,
        windowsHide: true,
        maxBuffer: 4096,
      },
    );
    results.push({
      name,
      passed: result.stdout.includes("verifier-completed"),
      durationMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    results.push({
      name,
      passed: false,
      durationMs: Math.round(performance.now() - started),
      code: error.code,
      killed: error.killed,
      stdout: error.stdout?.slice(0, 512),
      stderr: error.stderr?.slice(0, 512),
    });
  }
  console.log(JSON.stringify(results.at(-1)));
}
if (!results.find((result) => result.name === "system-module-lookup").passed)
  process.exitCode = 1;
