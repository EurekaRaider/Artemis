import { spawnSync } from "node:child_process";

if (!process.env.CI) {
  const current = spawnSync("git", ["config", "--get", "core.hooksPath"], {
    encoding: "utf8",
  });
  const path = current.stdout?.trim();
  if (path && path !== ".githooks") {
    console.warn(
      `Existing Git hooksPath ${path} was preserved. Add the Artemis pre-push check to your existing hooks.`,
    );
  } else {
    const result = spawnSync(
      "git",
      ["config", "--local", "core.hooksPath", ".githooks"],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
