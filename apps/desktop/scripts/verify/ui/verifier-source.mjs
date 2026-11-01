import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

// Release verification stays exact-head by default. Local UI review must opt in
// explicitly and bind its evidence to the actual uncommitted file contents.
export function captureVerifierSource(
  root,
  workingTree = process.argv.includes("--working-tree"),
) {
  const git = (...args) => execFileSync("git", args, { cwd: root });
  const head = git("rev-parse", "HEAD").toString().trim();
  const status = git("status", "--porcelain").toString().trim();
  assert(
    workingTree || status === "",
    "UI verification requires a clean exact-head worktree; use --working-tree for explicitly fingerprinted local evidence.",
  );
  const hash = createHash("sha256");
  const files = git(
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  )
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of files) {
    hash.update(file).update("\0");
    try {
      const path = join(root, file);
      const stat = lstatSync(path);
      hash.update(String(stat.mode)).update("\0");
      hash.update(
        stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      hash.update("<deleted>");
    }
    hash.update("\0");
  }
  return {
    mode: workingTree ? "working-tree" : "exact-head",
    head,
    status,
    sha256: hash.digest("hex"),
  };
}

export function assertVerifierSourceUnchanged(root, initial) {
  assert.deepEqual(
    captureVerifierSource(root, initial.mode === "working-tree"),
    initial,
    "UI verification source changed during the run.",
  );
}
