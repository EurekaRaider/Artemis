import { spawnSync } from "node:child_process";

// Shared by the Release workflow and the optional manual pre-push check.
// npm test builds the production bundles before running tests and artifact checks.
const commands = [
  "verify:public-workflows",
  "verify:slack-cli",
  "format:check",
  "test",
  "typecheck",
];
if (process.env.ARTEMIS_SKIP_PRODUCTION_AUDIT !== "true") {
  commands.push("audit:production");
}
for (const command of commands) {
  const result = spawnSync("npm", ["run", command], {
    stdio: "inherit",
    // Let jsdom provide browser storage instead of Node 26's server-only global.
    env:
      command === "test"
        ? {
            ...process.env,
            NODE_OPTIONS: [
              process.env.NODE_OPTIONS,
              "--no-experimental-webstorage",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : process.env,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
