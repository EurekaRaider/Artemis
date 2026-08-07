import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import type { ProjectGitInfo } from "../shared/api.js";

const execFileAsync = promisify(execFile);

interface GitFailure extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const failure = error as GitFailure;
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

export async function inspectGitBranches(
  workspace: string,
): Promise<ProjectGitInfo> {
  const root = await repositoryRoot(workspace);
  if (!root) {
    return {
      managed: false,
      detached: false,
      changeCount: 0,
      branches: [],
    };
  }

  const [symbolicBranch, shortHead, branchOutput, statusOutput] =
    await Promise.all([
      runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
        () => "",
      ),
      runGit(root, ["rev-parse", "--short", "HEAD"]).catch(() => ""),
      runGit(root, [
        "for-each-ref",
        "--sort=refname",
        "--format=%(refname:short)%09%(upstream:short)%09%(HEAD)",
        "refs/heads",
      ]),
      runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    ]);

  const currentBranch = symbolicBranch.trim() || undefined;
  const branches = branchOutput
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [name = "", upstream = "", marker = ""] = line.split("\t");
      return {
        name,
        current: marker === "*" || name === currentBranch,
        ...(upstream ? { upstream } : {}),
      };
    })
    .filter((branch) => branch.name);

  if (
    currentBranch &&
    !branches.some((branch) => branch.name === currentBranch)
  ) {
    branches.unshift({ name: currentBranch, current: true });
  }

  return {
    managed: true,
    root,
    ...(currentBranch ? { currentBranch } : {}),
    ...(shortHead.trim() ? { head: shortHead.trim() } : {}),
    detached: !currentBranch,
    changeCount: statusOutput.split(/\r?\n/u).filter((line) => line.length > 0)
      .length,
    branches,
  };
}

export async function switchGitBranch(
  workspace: string,
  branchName: string,
): Promise<ProjectGitInfo> {
  const root = await requireRepositoryRoot(workspace);
  const normalized = await validateBranchName(root, branchName);
  await runGit(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${normalized}^{commit}`,
  ]);
  await runGit(root, ["switch", normalized]);
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
