import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  canonicalizeFileSystemPath,
  sameFileSystemPath,
} from "@artemis/platform";

const execFileAsync = promisify(execFile);

interface GitFailure extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

export interface GitWorktreeInfo {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface CreateManagedWorktreeInput {
  repositoryPath: string;
  managedRoot: string;
  id: string;
  startPoint?: string;
}

export interface AttachPermanentWorktreeInput {
  repositoryPath: string;
  worktreePath: string;
}

export interface ManagedWorktreeInput {
  repositoryPath: string;
  managedRoot: string;
  worktreePath: string;
}

export interface BranchizeManagedWorktreeInput extends ManagedWorktreeInput {
  branchName: string;
}

export interface RemoveManagedWorktreeInput extends ManagedWorktreeInput {
  recoveryRoot: string;
  force: boolean;
}

export interface RemoveManagedWorktreeResult {
  recoveryPath?: string;
}

export interface RestoreWorktreeSnapshotInput {
  recoveryRoot: string;
  recoveryPath: string;
  targetWorkspace: string;
}

export interface RestoreWorktreeSnapshotResult {
  restoredFiles: string[];
}

interface WorktreeSnapshotManifest {
  version: 1;
  repositoryPath: string;
  worktreePath: string;
  head: string;
  branch?: string;
  createdAt: string;
  untrackedFiles: string[];
  untrackedSymlinks: Record<string, string>;
}

function samePath(left: string, right: string): boolean {
  return sameFileSystemPath(left, right);
}

function assertDescendant(root: string, target: string): string {
  const normalizedRoot = canonicalizeFileSystemPath(root);
  const normalizedTarget = canonicalizeFileSystemPath(target);
  const relation = relative(normalizedRoot, normalizedTarget);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`Worktree path is outside the managed root: ${target}`);
  }
  return normalizedTarget;
}

function assertSafeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Git returned an unsafe untracked path: ${path}`);
  }
  return normalized;
}

function resolveInside(root: string, path: string): string {
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`Snapshot path escapes its root: ${path}`);
  }
  return target;
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
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
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

async function applyGitPatch(
  cwd: string,
  patch: string,
  flags: string[],
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("git", ["apply", "--binary", ...flags, "-"], {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(stderr.trim() || `git apply exited with ${String(code)}.`),
        );
      }
    });
    child.stdin.end(patch, "utf8");
  });
}

function parseWorktreeSnapshotManifest(
  value: unknown,
): WorktreeSnapshotManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Worktree recovery manifest is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.repositoryPath !== "string" ||
    typeof record.worktreePath !== "string" ||
    typeof record.head !== "string" ||
    typeof record.createdAt !== "string" ||
    !Array.isArray(record.untrackedFiles) ||
    !record.untrackedFiles.every((path) => typeof path === "string") ||
    !record.untrackedSymlinks ||
    typeof record.untrackedSymlinks !== "object" ||
    Array.isArray(record.untrackedSymlinks) ||
    !Object.values(record.untrackedSymlinks).every(
      (target) => typeof target === "string",
    )
  ) {
    throw new Error("Worktree recovery manifest is invalid.");
  }
  return {
    version: 1,
    repositoryPath: record.repositoryPath,
    worktreePath: record.worktreePath,
    head: record.head,
    ...(typeof record.branch === "string" ? { branch: record.branch } : {}),
    createdAt: record.createdAt,
    untrackedFiles: record.untrackedFiles.map(assertSafeRelativePath),
    untrackedSymlinks: Object.fromEntries(
      Object.entries(record.untrackedSymlinks).map(([path, target]) => [
        assertSafeRelativePath(path),
        target,
      ]),
    ),
  };
}

async function repositoryRoot(path: string): Promise<string> {
  const root = (await runGit(path, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) {
    throw new Error("The selected project is not a Git repository.");
  }
  return resolve(root);
}

export async function listGitWorktrees(
  repositoryPath: string,
): Promise<GitWorktreeInfo[]> {
  const root = await repositoryRoot(repositoryPath);
  const output = await runGit(root, [
    "-c",
    "core.quotePath=false",
    "worktree",
    "list",
    "--porcelain",
  ]);
  return output
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((block) => {
      const values = new Map<string, string>();
      const flags = new Set<string>();
      for (const line of block.split(/\r?\n/)) {
        const separator = line.indexOf(" ");
        if (separator < 0) {
          flags.add(line);
        } else {
          values.set(line.slice(0, separator), line.slice(separator + 1));
        }
      }
      const path = values.get("worktree");
      const head = values.get("HEAD");
      if (!path || !head) {
        throw new Error("Git returned an invalid worktree record.");
      }
      const branchRef = values.get("branch");
      return {
        path: resolve(path),
        head,
        ...(branchRef
          ? { branch: branchRef.replace(/^refs\/heads\//, "") }
          : {}),
        detached: flags.has("detached"),
        locked: flags.has("locked") || values.has("locked"),
        prunable: flags.has("prunable") || values.has("prunable"),
      };
    });
}

export async function attachPermanentWorktree(
  input: AttachPermanentWorktreeInput,
): Promise<GitWorktreeInfo> {
  const root = await repositoryRoot(input.repositoryPath);
  const selectedPath = resolve(input.worktreePath);
  if (samePath(root, selectedPath)) {
    throw new Error(
      "The primary checkout is Local, not a permanent task worktree.",
    );
  }
  const info = (await listGitWorktrees(root)).find((item) =>
    samePath(item.path, selectedPath),
  );
  if (!info) {
    throw new Error(
      "The selected directory is not a registered worktree for this project.",
    );
  }
  if (info.locked) {
    throw new Error("The selected permanent worktree is locked.");
  }
  if (info.prunable) {
    throw new Error("The selected permanent worktree is marked prunable.");
  }
  return info;
}

async function requireManagedWorktree(
  input: ManagedWorktreeInput,
): Promise<{ root: string; info: GitWorktreeInfo }> {
  const root = await repositoryRoot(input.repositoryPath);
  const safePath = assertDescendant(input.managedRoot, input.worktreePath);
  if (samePath(root, safePath)) {
    throw new Error(
      "The primary worktree cannot be managed as a task worktree.",
    );
  }
  const info = (await listGitWorktrees(root)).find((item) =>
    samePath(item.path, safePath),
  );
  if (!info) {
    throw new Error("The managed worktree is no longer registered with Git.");
  }
  if (info.locked) {
    throw new Error("The managed worktree is locked.");
  }
  return { root, info };
}

export async function createManagedWorktree(
  input: CreateManagedWorktreeInput,
): Promise<GitWorktreeInfo> {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(input.id)) {
    throw new Error("Managed worktree ID is invalid.");
  }
  const root = await repositoryRoot(input.repositoryPath);
  const destination = assertDescendant(
    input.managedRoot,
    resolve(input.managedRoot, input.id),
  );
  try {
    await lstat(destination);
    throw new Error(`Managed worktree path already exists: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(resolve(input.managedRoot), { recursive: true });
  await runGit(root, [
    "worktree",
    "add",
    "--detach",
    destination,
    input.startPoint ?? "HEAD",
  ]);
  const created = (await listGitWorktrees(root)).find((item) =>
    samePath(item.path, destination),
  );
  if (!created) {
    throw new Error("Git created the worktree but did not register it.");
  }
  return created;
}

export async function branchizeManagedWorktree(
  input: BranchizeManagedWorktreeInput,
): Promise<GitWorktreeInfo> {
  const { root, info } = await requireManagedWorktree(input);
  const branchName = input.branchName.trim();
  if (!branchName) {
    throw new Error("Branch name cannot be empty.");
  }
  await runGit(root, ["check-ref-format", "--branch", branchName]);
  if (await branchExists(root, branchName)) {
    throw new Error(`Branch already exists: ${branchName}`);
  }
  await runGit(info.path, ["switch", "-c", branchName]);
  const updated = (await listGitWorktrees(root)).find((item) =>
    samePath(item.path, info.path),
  );
  if (!updated?.branch || updated.branch !== branchName) {
    throw new Error("Git did not attach the worktree to the requested branch.");
  }
  return updated;
}

async function branchExists(
  root: string,
  branchName: string,
): Promise<boolean> {
  try {
    await runGit(root, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function createWorktreeSnapshot(
  root: string,
  info: GitWorktreeInfo,
  recoveryRoot: string,
): Promise<string> {
  const relationToWorktree = relative(info.path, resolve(recoveryRoot));
  if (
    !relationToWorktree ||
    (!relationToWorktree.startsWith(`..${sep}`) &&
      relationToWorktree !== ".." &&
      !isAbsolute(relationToWorktree))
  ) {
    throw new Error("Recovery storage must be outside the worktree.");
  }
  const createdAt = new Date().toISOString();
  const recoveryPath = resolve(
    recoveryRoot,
    `${createdAt.replaceAll(":", "-")}-${randomUUID()}`,
  );
  await mkdir(recoveryPath, { recursive: true });
  const patch = await runGit(info.path, [
    "diff",
    "--binary",
    "--full-index",
    "HEAD",
    "--",
  ]);
  await writeFile(resolve(recoveryPath, "tracked.patch"), patch, "utf8");

  const untracked = (
    await runGit(info.path, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
    ])
  )
    .split("\0")
    .filter(Boolean)
    .map(assertSafeRelativePath);
  const untrackedSymlinks: Record<string, string> = {};
  for (const path of untracked) {
    const source = resolveInside(info.path, path);
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink()) {
      untrackedSymlinks[path] = await readlink(source);
      continue;
    }
    if (!sourceStat.isFile()) continue;
    const destination = resolveInside(resolve(recoveryPath, "untracked"), path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }

  const manifest: WorktreeSnapshotManifest = {
    version: 1,
    repositoryPath: root,
    worktreePath: info.path,
    head: info.head,
    ...(info.branch ? { branch: info.branch } : {}),
    createdAt,
    untrackedFiles: untracked.filter((path) => !(path in untrackedSymlinks)),
    untrackedSymlinks,
  };
  await writeFile(
    resolve(recoveryPath, "manifest.json"),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );
  return recoveryPath;
}

export async function removeManagedWorktree(
  input: RemoveManagedWorktreeInput,
): Promise<RemoveManagedWorktreeResult> {
  const { root, info } = await requireManagedWorktree(input);
  const status = await runGit(info.path, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const dirty = status.length > 0;
  if (dirty && !input.force) {
    throw new Error(
      "Managed worktree has uncommitted changes. Force cleanup requires a recovery snapshot.",
    );
  }
  const recoveryPath =
    dirty && input.force
      ? await createWorktreeSnapshot(root, info, input.recoveryRoot)
      : undefined;

  await runGit(root, [
    "worktree",
    "remove",
    ...(input.force ? ["--force"] : []),
    info.path,
  ]);
  await runGit(root, ["worktree", "prune"]);
  const stillRegistered = (await listGitWorktrees(root)).some((item) =>
    samePath(item.path, info.path),
  );
  if (stillRegistered) {
    throw new Error("Git did not remove the managed worktree registration.");
  }
  return recoveryPath ? { recoveryPath } : {};
}

export async function restoreWorktreeSnapshot(
  input: RestoreWorktreeSnapshotInput,
): Promise<RestoreWorktreeSnapshotResult> {
  const recoveryPath = assertDescendant(input.recoveryRoot, input.recoveryPath);
  const manifest = parseWorktreeSnapshotManifest(
    JSON.parse(
      await readFile(resolve(recoveryPath, "manifest.json"), "utf8"),
    ) as unknown,
  );
  const targetRoot = resolve(
    (
      await runGit(input.targetWorkspace, ["rev-parse", "--show-toplevel"])
    ).trim(),
  );
  if (!samePath(targetRoot, manifest.repositoryPath)) {
    throw new Error("Recovery snapshot belongs to a different Git repository.");
  }
  const targetHead = (
    await runGit(targetRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
  ).trim();
  if (targetHead !== manifest.head) {
    throw new Error(
      "Recovery target has a different HEAD. Restore into a matching revision.",
    );
  }

  const patch = await readFile(resolve(recoveryPath, "tracked.patch"), "utf8");
  if (patch) {
    try {
      await applyGitPatch(targetRoot, patch, ["--check"]);
    } catch (error) {
      throw new Error(
        `Recovery patch cannot be applied cleanly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const filesToCopy: Array<{
    source: string;
    destination: string;
    path: string;
  }> = [];
  for (const path of manifest.untrackedFiles) {
    const source = resolveInside(resolve(recoveryPath, "untracked"), path);
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Recovery snapshot file is invalid: ${path}`);
    }
    const destination = resolveInside(targetRoot, path);
    try {
      const destinationStat = await lstat(destination);
      if (!destinationStat.isFile() || destinationStat.isSymbolicLink()) {
        throw new Error(
          `Recovery target already exists and is not a regular file: ${path}`,
        );
      }
      if (!(await readFile(source)).equals(await readFile(destination))) {
        throw new Error(
          `Recovery target already exists with different content: ${path}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        filesToCopy.push({ source, destination, path });
      } else {
        throw error;
      }
    }
  }

  const symlinksToCreate: Array<{
    destination: string;
    path: string;
    target: string;
  }> = [];
  for (const [path, target] of Object.entries(manifest.untrackedSymlinks)) {
    if (isAbsolute(target)) {
      throw new Error(`Recovery symlink target must be relative: ${path}`);
    }
    const destination = resolveInside(targetRoot, path);
    const resolvedTarget = resolve(dirname(destination), target);
    const targetRelation = relative(targetRoot, resolvedTarget);
    if (
      targetRelation === ".." ||
      targetRelation.startsWith(`..${sep}`) ||
      isAbsolute(targetRelation)
    ) {
      throw new Error(`Recovery symlink target escapes the workspace: ${path}`);
    }
    try {
      await lstat(destination);
      throw new Error(`Recovery symlink target already exists: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    symlinksToCreate.push({ destination, path, target });
  }

  let patchApplied = false;
  const createdPaths: string[] = [];
  try {
    if (patch) {
      await applyGitPatch(targetRoot, patch, []);
      patchApplied = true;
    }
    for (const file of filesToCopy) {
      await mkdir(dirname(file.destination), { recursive: true });
      await copyFile(file.source, file.destination);
      createdPaths.push(file.path);
    }
    for (const link of symlinksToCreate) {
      await mkdir(dirname(link.destination), { recursive: true });
      await symlink(link.target, link.destination);
      createdPaths.push(link.path);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const path of createdPaths.reverse()) {
      try {
        await rm(resolveInside(targetRoot, path), { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (patchApplied) {
      try {
        await applyGitPatch(targetRoot, patch, ["--reverse"]);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Snapshot restore failed and could not be fully rolled back.",
      );
    }
    throw error;
  }

  return {
    restoredFiles: [
      ...(patch ? ["tracked.patch"] : []),
      ...manifest.untrackedFiles,
      ...Object.keys(manifest.untrackedSymlinks),
    ],
  };
}
