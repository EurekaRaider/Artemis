import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function mainPushUpdate(input) {
  const updates = input
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.split(/\s+/u))
    .filter(([, sha, ref]) => ref === "refs/heads/main" && !/^0+$/u.test(sha));
  if (updates.length > 1) throw new Error("Expected one main-branch update.");
  const update = updates[0];
  return update ? { head: update[1], base: update[3] } : undefined;
}

export function isReadmeOnlyChange(paths) {
  const changed = paths.split("\0").filter(Boolean);
  return (
    changed.length > 0 &&
    changed.every((path) => /(^|\/)README\.md$/u.test(path))
  );
}

export function verifyPrePush({
  head,
  base,
  root,
  run,
  temporary,
  remove,
  env = process.env,
}) {
  const git = (...args) => run("git", args, root, env).trim();
  if (git("rev-parse", "HEAD") !== head)
    throw new Error(
      "Check out the main commit being pushed before verification.",
    );
  if (git("status", "--porcelain"))
    throw new Error("Commit or stash workspace changes before pushing main.");
  if (
    base &&
    !/^0+$/u.test(base) &&
    isReadmeOnlyChange(
      git("diff", "--name-only", "--no-renames", "-z", base, head),
    )
  ) {
    console.log("README-only update: CI verification is not required.");
    return;
  }
  const directory = temporary();
  try {
    run(
      "git",
      ["clone", "--quiet", "--shared", "--no-checkout", root, directory],
      root,
      env,
    );
    run("git", ["checkout", "--quiet", "--detach", head], directory, env);
    const checkEnv = { ...env, ARTEMIS_EXPECTED_HEAD: head };
    run("npm", ["ci"], directory, checkEnv);
    run("npm", ["run", "verify:ci"], directory, checkEnv);
    run("npm", ["run", "verify:visual-convergence"], directory, checkEnv);
    if (git("rev-parse", "HEAD") !== head || git("status", "--porcelain")) {
      throw new Error(
        "Workspace changed during verification; push was stopped.",
      );
    }
  } finally {
    remove(directory);
  }
}

function execute(command, args, cwd, env) {
  const capture = command === "git";
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    shell: command === "npm" && process.platform === "win32",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr ?? result.status}`,
    );
  }
  return result.stdout ?? "";
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const update = process.argv.includes("--hook")
      ? mainPushUpdate(readFileSync(0, "utf8"))
      : {
          head: execute(
            "git",
            ["rev-parse", "HEAD"],
            process.cwd(),
            process.env,
          ).trim(),
        };
    if (update) {
      const { head, base } = update;
      console.log(
        `Verifying main ${head.slice(0, 12)} in a clean temporary checkout before push.`,
      );
      verifyPrePush({
        head,
        base,
        root: process.cwd(),
        run: execute,
        temporary: () => mkdtempSync(join(tmpdir(), "artemis-pre-push-")),
        remove: (directory) =>
          rmSync(directory, { recursive: true, force: true }),
      });
      console.log(`Main ${head.slice(0, 12)} pre-push verification completed.`);
    }
  } catch (error) {
    console.error(`Push blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
