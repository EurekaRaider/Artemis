import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type {
  ProjectGitCommitResult,
  ProjectGitInfo,
  ProjectGitPushResult,
} from "../shared/api.js";

const execFileAsync = promisify(execFile);

interface GitFailure extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

interface StatusCounts {
  changeCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
}

interface LineCounts {
  additions: number;
  deletions: number;
}

export interface GitRepositoryWatchPlan {
  root: string;
  gitDirectory: string;
  commonDirectory: string;
}

async function runGit(
  cwd: string,
  args: string[],
  acceptedExitCodes: number[] = [0],
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GCM_INTERACTIVE: "Never",
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const failure = error as GitFailure;
    if (
      typeof failure.code === "number" &&
      acceptedExitCodes.includes(failure.code)
    ) {
      return failure.stdout ?? "";
    }
    const detail = (failure.stderr ?? failure.message).trim();
    throw new Error(detail || "Git command failed.");
  }
}

function isNotRepository(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /not a git repository|must be run in a work tree/iu.test(message);
}

async function repositoryRoot(workspace: string): Promise<string | undefined> {
  try {
    const root = (
      await runGit(workspace, ["rev-parse", "--show-toplevel"])
    ).trim();
    return root ? resolve(root) : undefined;
  } catch (error) {
    if (isNotRepository(error)) return undefined;
    throw error;
  }
}

async function requireRepositoryRoot(workspace: string): Promise<string> {
  const root = await repositoryRoot(workspace);
  if (!root) {
    throw new Error("The selected project is not a Git repository.");
  }
  return root;
}

export async function gitRepositoryWatchPaths(
  workspace: string,
): Promise<GitRepositoryWatchPlan | undefined> {
  const root = await repositoryRoot(workspace);
  if (!root) return undefined;
  const [gitDirectory, commonDirectory] = await Promise.all([
    runGit(root, ["rev-parse", "--absolute-git-dir"]).catch(() => ""),
    runGit(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).catch(() => ""),
  ]);
  const resolvedGitDirectory = gitDirectory.trim();
  const resolvedCommonDirectory = commonDirectory.trim();
  if (!resolvedGitDirectory || !resolvedCommonDirectory) return undefined;
  return {
    root,
    gitDirectory: resolve(resolvedGitDirectory),
    commonDirectory: resolve(resolvedCommonDirectory),
  };
}

async function appendMetadataFile(
  hash: ReturnType<typeof createHash>,
  label: string,
  path: string,
): Promise<void> {
  hash.update(`${label}\0`);
  try {
    hash.update(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    hash.update("missing");
  }
  hash.update("\0");
}

async function appendMetadataDirectory(
  hash: ReturnType<typeof createHash>,
  root: string,
  directory: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    hash.update(`missing-directory:${directory}\0`);
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await appendMetadataDirectory(hash, root, path);
    } else if (entry.isFile()) {
      await appendMetadataFile(hash, path.slice(root.length), path);
    }
  }
}

export async function gitRepositoryMetadataSignature(
  plan: GitRepositoryWatchPlan,
): Promise<string> {
  const hash = createHash("sha256");
  const files = [
    ["git/HEAD", join(plan.gitDirectory, "HEAD")],
    ["git/index", join(plan.gitDirectory, "index")],
    ["git/MERGE_HEAD", join(plan.gitDirectory, "MERGE_HEAD")],
    ["git/CHERRY_PICK_HEAD", join(plan.gitDirectory, "CHERRY_PICK_HEAD")],
    ["git/REVERT_HEAD", join(plan.gitDirectory, "REVERT_HEAD")],
    ["git/config.worktree", join(plan.gitDirectory, "config.worktree")],
    ["common/packed-refs", join(plan.commonDirectory, "packed-refs")],
    ["common/config", join(plan.commonDirectory, "config")],
  ] as const;
  for (const [label, path] of files) {
    await appendMetadataFile(hash, label, path);
  }
  await appendMetadataDirectory(
    hash,
    plan.commonDirectory,
    join(plan.commonDirectory, "refs"),
  );
  return hash.digest("hex");
}

async function defaultCompareBase(
  root: string,
  currentBranch: string | undefined,
): Promise<string | undefined> {
  const candidates: string[] = [];
  const remoteHead = (
    await runGit(root, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]).catch(() => "")
  ).trim();
  if (remoteHead) candidates.push(remoteHead);
  candidates.push("main", "master");
  for (const candidate of candidates) {
    if (candidate === currentBranch) continue;
    const exists = await runGit(
      root,
      ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
      [0, 1],
    );
    if (exists.trim()) return candidate;
  }
  return currentBranch;
}

function normalizeBranchName(branchName: string): string {
  const normalized = branchName.trim();
  if (!normalized) throw new Error("Enter a branch name.");
  return normalized;
}

async function validateBranchName(
  root: string,
  branchName: string,
): Promise<string> {
  const normalized = normalizeBranchName(branchName);
  await runGit(root, ["check-ref-format", "--branch", normalized]);
  return normalized;
}

function statusCounts(output: string): StatusCounts {
  const entries = output.split("\0");
  let changeCount = 0;
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let conflictCount = 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry || entry.length < 3) continue;
    const status = entry.slice(0, 2);
    const staged = status[0] ?? " ";
    const unstaged = status[1] ?? " ";
    changeCount += 1;
    if (status === "??") {
      untrackedCount += 1;
    } else {
      if (staged !== " " && staged !== "!") stagedCount += 1;
      if (unstaged !== " " && unstaged !== "!") unstagedCount += 1;
    }
    if (["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status)) {
      conflictCount += 1;
    }
    if (staged === "R" || staged === "C") index += 1;
  }

  return {
    changeCount,
    stagedCount,
    unstagedCount,
    untrackedCount,
    conflictCount,
  };
}

function parseNumstat(output: string): LineCounts {
  let additions = 0;
  let deletions = 0;
  for (const line of output.split(/\r?\n/u)) {
    if (!line) continue;
    const [added = "", deleted = ""] = line.split("\t", 2);
    if (/^\d+$/u.test(added)) additions += Number(added);
    if (/^\d+$/u.test(deleted)) deletions += Number(deleted);
  }
  return { additions, deletions };
}

async function untrackedLineCounts(root: string): Promise<LineCounts> {
  const paths = (
    await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])
  )
    .split("\0")
    .filter(Boolean);
  const total = { additions: 0, deletions: 0 };
  for (let index = 0; index < paths.length; index += 4) {
    const counts = await Promise.all(
      paths
        .slice(index, index + 4)
        .map(async (path) =>
          parseNumstat(
            await runGit(
              root,
              [
                "-c",
                "core.quotePath=false",
                "diff",
                "--no-ext-diff",
                "--no-index",
                "--numstat",
                "--",
                "/dev/null",
                path,
              ],
              [0, 1],
            ),
          ),
        ),
    );
    for (const count of counts) {
      total.additions += count.additions;
      total.deletions += count.deletions;
    }
  }
  return total;
}

async function workingTreeLineCounts(root: string): Promise<LineCounts> {
  const hasHead = await runGit(
    root,
    ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    [0, 1],
  );
  const tracked = hasHead.trim()
    ? await runGit(root, ["diff", "--no-ext-diff", "--numstat", "HEAD", "--"])
    : `${await runGit(root, ["diff", "--no-ext-diff", "--numstat", "--cached", "--"])}${await runGit(root, ["diff", "--no-ext-diff", "--numstat", "--"])}`;
  const [trackedCounts, untrackedCounts] = await Promise.all([
    Promise.resolve(parseNumstat(tracked)),
    untrackedLineCounts(root),
  ]);
  return {
    additions: trackedCounts.additions + untrackedCounts.additions,
    deletions: trackedCounts.deletions + untrackedCounts.deletions,
  };
}

async function aheadBehind(root: string): Promise<LineCounts> {
  const output = (
    await runGit(root, [
      "rev-list",
      "--left-right",
      "--count",
      "HEAD...@{upstream}",
    ])
  ).trim();
  const [ahead = "0", behind = "0"] = output.split(/\s+/u, 2);
  return {
    additions: Number(ahead) || 0,
    deletions: Number(behind) || 0,
  };
}

export async function inspectGitBranches(
  workspace: string,
): Promise<ProjectGitInfo> {
  const root = await repositoryRoot(workspace);
  if (!root) {
    return {
      managed: false,
      detached: false,
      changeCount: 0,
      additions: 0,
      deletions: 0,
      stagedAdditions: 0,
      stagedDeletions: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      ahead: 0,
      behind: 0,
      branches: [],
    };
  }

  const [
    symbolicBranch,
    shortHead,
    fullHead,
    branchOutput,
    statusOutput,
    lineCounts,
    stagedLineCounts,
  ] = await Promise.all([
    runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
      () => "",
    ),
    runGit(root, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
    runGit(root, ["rev-parse", "HEAD"]).catch(() => ""),
    runGit(root, [
      "for-each-ref",
      "--sort=refname",
      "--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ]),
    runGit(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    workingTreeLineCounts(root),
    runGit(root, ["diff", "--no-ext-diff", "--numstat", "--cached", "--"]).then(
      parseNumstat,
    ),
  ]);

  const currentBranch = symbolicBranch.trim() || undefined;
  const branches = branchOutput
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [ref = "", name = "", upstream = "", marker = ""] =
        line.split("\t");
      return {
        name,
        current: marker === "*" || name === currentBranch,
        ...(upstream ? { upstream } : {}),
        ...(ref.startsWith("refs/remotes/") ? { remote: true } : {}),
      };
    })
    .filter((branch) => branch.name && !branch.name.endsWith("/HEAD"));

  if (
    currentBranch &&
    !branches.some((branch) => branch.name === currentBranch)
  ) {
    branches.unshift({ name: currentBranch, current: true });
  }

  const upstream = branches.find((branch) => branch.current)?.upstream;
  const divergence = upstream
    ? await aheadBehind(root).catch(() => ({ additions: 0, deletions: 0 }))
    : { additions: 0, deletions: 0 };
  const counts = statusCounts(statusOutput);
  const compareBase = await defaultCompareBase(root, currentBranch);
  return {
    managed: true,
    root,
    ...(currentBranch ? { currentBranch } : {}),
    ...(shortHead.trim() ? { head: shortHead.trim() } : {}),
    ...(fullHead.trim() ? { headOid: fullHead.trim() } : {}),
    detached: !currentBranch,
    ...counts,
    additions: lineCounts.additions,
    deletions: lineCounts.deletions,
    stagedAdditions: stagedLineCounts.additions,
    stagedDeletions: stagedLineCounts.deletions,
    ...(upstream ? { upstream } : {}),
    ...(compareBase ? { compareBase } : {}),
    ahead: divergence.additions,
    behind: divergence.deletions,
    branches,
  };
}

export async function switchGitBranch(
  workspace: string,
  branchName: string,
): Promise<ProjectGitInfo> {
  const root = await requireRepositoryRoot(workspace);
  const normalized = await validateBranchName(root, branchName);
  const before = await inspectGitBranches(root);
  if (before.currentBranch === normalized) return before;
  const local = await runGit(
    root,
    ["rev-parse", "--verify", "--quiet", `refs/heads/${normalized}^{commit}`],
    [0, 1],
  );
  if (local.trim()) {
    await runGit(root, ["switch", normalized]);
    return inspectGitBranches(root);
  }
  const remote = await runGit(
    root,
    ["rev-parse", "--verify", "--quiet", `refs/remotes/${normalized}^{commit}`],
    [0, 1],
  );
  if (!remote.trim()) {
    throw new Error(`Branch does not exist: ${normalized}`);
  }
  await runGit(root, ["switch", "--track", normalized]);
  return inspectGitBranches(root);
}

export async function createGitBranch(
  workspace: string,
  branchName: string,
): Promise<ProjectGitInfo> {
  const root = await requireRepositoryRoot(workspace);
  const normalized = await validateBranchName(root, branchName);
  await runGit(root, ["switch", "-c", normalized]);
  return inspectGitBranches(root);
}

export async function commitProjectChanges(
  workspace: string,
  message: unknown,
  includeUnstaged = true,
): Promise<ProjectGitCommitResult> {
  const root = await requireRepositoryRoot(workspace);
  if (typeof message !== "string") {
    throw new Error("Commit message is invalid.");
  }
  const normalizedMessage = message.trim();
  if (normalizedMessage.length > 10_000) {
    throw new Error("Commit message must not exceed 10,000 characters.");
  }
  if (typeof includeUnstaged !== "boolean") {
    throw new Error("Include-unstaged selection is invalid.");
  }
  const before = await inspectGitBranches(root);
  if (before.detached) {
    throw new Error("Create or switch to a branch before committing.");
  }
  if (before.conflictCount > 0) {
    throw new Error("Resolve repository conflicts before committing.");
  }
  if (includeUnstaged ? before.changeCount === 0 : before.stagedCount === 0) {
    throw new Error(
      includeUnstaged
        ? "There are no project changes to commit."
        : "There are no staged changes to commit.",
    );
  }

  if (includeUnstaged) {
    await runGit(root, ["add", "--all", "--"]);
  }
  const staged = await runGit(root, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--",
  ]);
  if (!staged) {
    throw new Error("There are no staged changes to commit.");
  }
  const stagedPaths = staged.split("\0").filter(Boolean);
  const generatedMessage =
    stagedPaths.length === 1
      ? `Update ${stagedPaths[0]}`
      : `Update ${stagedPaths.length} files`;
  await runGit(root, ["commit", "-m", normalizedMessage || generatedMessage]);
  const commit = (await runGit(root, ["rev-parse", "HEAD"])).trim();
  return { commit, gitInfo: await inspectGitBranches(root) };
}

export async function pushProjectBranch(
  workspace: string,
): Promise<ProjectGitPushResult> {
  const root = await requireRepositoryRoot(workspace);
  const before = await inspectGitBranches(root);
  if (before.detached || !before.currentBranch) {
    throw new Error("Create or switch to a branch before pushing.");
  }
  if (before.conflictCount > 0) {
    throw new Error("Resolve repository conflicts before pushing.");
  }
  if (before.changeCount > 0) {
    throw new Error("Commit or discard project changes before pushing.");
  }
  if (!before.upstream) {
    const remotes = (await runGit(root, ["remote"]))
      .split(/\r?\n/u)
      .filter(Boolean);
    const remote = remotes.includes("origin")
      ? "origin"
      : remotes.length === 1
        ? remotes[0]
        : undefined;
    if (!remote) {
      throw new Error(
        remotes.length === 0
          ? "No Git remote is configured."
          : "Choose a remote before publishing this branch.",
      );
    }
    await runGit(root, [
      "push",
      "--porcelain",
      "--set-upstream",
      remote,
      before.currentBranch,
    ]);
    const gitInfo = await inspectGitBranches(root);
    return {
      upstream: gitInfo.upstream ?? `${remote}/${before.currentBranch}`,
      gitInfo,
    };
  }
  if (before.behind > 0) {
    throw new Error(
      "The current branch is behind or diverged from its upstream.",
    );
  }
  if (before.ahead === 0) {
    throw new Error("There are no commits to push.");
  }

  const target = (
    await runGit(root, [
      "for-each-ref",
      "--format=%(upstream:remotename)%09%(upstream:remoteref)",
      `refs/heads/${before.currentBranch}`,
    ])
  ).trim();
  const [remote = "", remoteRef = ""] = target.split("\t", 2);
  if (!remote || !remoteRef.startsWith("refs/heads/")) {
    throw new Error("The configured upstream is not a pushable remote branch.");
  }
  await runGit(root, [
    "push",
    "--porcelain",
    "--",
    remote,
    `HEAD:${remoteRef}`,
  ]);
  return { upstream: before.upstream, gitInfo: await inspectGitBranches(root) };
}
