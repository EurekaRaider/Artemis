import { spawnSync } from "node:child_process";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = JSON.parse(input);
// A hook may continue each original turn only once. Never create an unbounded test loop.
if (!event.stop_hook_active) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["test", "--", "--run"],
    {
      cwd: event.cwd,
      encoding: "utf8",
      timeout: 100_000,
      shell: process.platform === "win32",
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0)
    process.stdout.write(
      JSON.stringify({
        decision: "block",
        reason: `The test check failed. Inspect and address it before finishing.\n${(result.stderr || result.stdout || result.error?.message || "No output").slice(-6000)}`,
      }),
    );
}
