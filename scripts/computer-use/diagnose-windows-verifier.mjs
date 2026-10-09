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
const args = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "[Console]::WriteLine('verifier-started')",
];
const results = [];
for (const [name, env, closeInput] of [
  ["inherited-environment", process.env, false],
  ["isolated-environment", { SystemRoot: systemRoot }, false],
  ["isolated-environment-closed-input", { SystemRoot: systemRoot }, true],
]) {
  const started = performance.now();
  try {
    const pending = run(command, args, {
      env,
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 4096,
    });
    if (closeInput) pending.child.stdin.end();
    const result = await pending;
    results.push({
      name,
      passed: result.stdout.includes("verifier-started"),
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
if (results.some((result) => !result.passed)) process.exitCode = 1;
