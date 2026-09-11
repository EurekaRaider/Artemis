import { spawnSync } from "node:child_process";

// Shared by GitHub Actions and the main-branch pre-push check.
const commands = ["format:check", "test", "typecheck", "build"];
if (process.env.ARTEMIS_SKIP_PRODUCTION_AUDIT !== "true") {
  commands.push("audit:production");
}
for (const command of commands) {
  const result = spawnSync("npm", ["run", command], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
