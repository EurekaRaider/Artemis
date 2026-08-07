import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import {
  canonicalizeFileSystemPath,
  resolveWorkspacePath,
} from "@artemis/platform";

const execFileAsync = promisify(execFile);

interface GitFailure extends Error {
  stderr?: string;
}

export interface WorkspaceChangeBundleManifest {
  version: 1;
  baseHead: string;
  sourceWorkspace: string;
  createdAt: string;
  paths?: string[];
  untrackedFiles: string[];
}

export interface WorkspaceChangeBundle {
  path: string;
  manifest: WorkspaceChangeBundleManifest;
}

export interface CreateWorkspaceChangeBundleInput {
  sourceWorkspace: string;
  bundleRoot: string;
  paths?: string[];
}

export interface ApplyWorkspaceChangeBundleInput {
  bundlePath: string;
  targetWorkspace: string;
}

export interface ApplyWorkspaceChangeBundleResult {
  appliedFiles: string[];
}

async function runGit(cwd: string, args: string[]): Promise<string> {
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
    throw new Error((failure.stderr ?? failure.message).trim());
  }
}

async function repositoryRoot(path: string): Promise<string> {
  const root = (await runGit(path, ["rev-parse", "--show-toplevel"])).trim();
  if (!root) {
    throw new Error("The handoff workspace is not a Git repository.");
  }
  return resolve(root);
}

function assertSafeRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Handoff contains an unsafe path: ${path}`);
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
    throw new Error(`Handoff path escapes its bundle: ${path}`);
  }
  return target;
}

function repositoryPaths(
  repositoryRootPath: string,
  workspace: string,
  paths: string[],
): string[] {
  const prefix = relative(
    canonicalizeFileSystemPath(repositoryRootPath),
    canonicalizeFileSystemPath(workspace),
  );
  if (prefix === ".." || prefix.startsWith(`..${sep}`) || isAbsolute(prefix)) {
    throw new Error("Handoff workspace is outside its Git repository.");
  }
  return [
    ...new Set(
      paths.map((path) =>
        assertSafeRelativePath(
          prefix ? `${prefix.replaceAll("\\", "/")}/${path}` : path,
        ),
      ),
    ),
  ];
}

function pathArguments(paths: string[] | undefined): string[] {
  return paths === undefined ? ["--"] : ["--", ...paths];
}

async function gitApply(
  cwd: string,
  patch: string,
  flags: string[],
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "git",
      ["apply", "--whitespace=nowarn", ...flags, "-"],
      {
        cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
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
        reject(new Error(stderr.trim() || `git apply exited with ${code}.`));
      }
    });
    child.stdin.end(patch, "utf8");
  });
}

function parseManifest(value: unknown): WorkspaceChangeBundleManifest {
  if (!value || typeof value !== "object") {
    throw new Error("Handoff manifest is invalid.");
  }
  const manifest = value as Partial<WorkspaceChangeBundleManifest>;
  if (
    manifest.version !== 1 ||
    typeof manifest.baseHead !== "string" ||
    !manifest.baseHead ||
    typeof manifest.sourceWorkspace !== "string" ||
    typeof manifest.createdAt !== "string" ||
    !Array.isArray(manifest.untrackedFiles) ||
    !manifest.untrackedFiles.every((path) => typeof path === "string") ||
    (manifest.paths !== undefined &&
      (!Array.isArray(manifest.paths) ||
        !manifest.paths.every((path) => typeof path === "string")))
  ) {
    throw new Error("Handoff manifest is invalid.");
  }
  return {
    version: 1,
    baseHead: manifest.baseHead,
    sourceWorkspace: manifest.sourceWorkspace,
    createdAt: manifest.createdAt,
    ...(manifest.paths
      ? { paths: manifest.paths.map(assertSafeRelativePath) }
      : {}),
    untrackedFiles: manifest.untrackedFiles.map(assertSafeRelativePath),
  };
}

export async function createWorkspaceChangeBundle(
  input: CreateWorkspaceChangeBundleInput,
): Promise<WorkspaceChangeBundle> {
  const root = await repositoryRoot(input.sourceWorkspace);
  const selectedPaths =
    input.paths === undefined
      ? undefined
      : repositoryPaths(root, input.sourceWorkspace, input.paths);
  const baseHead = (
    await runGit(root, ["rev-parse", "--verify", "HEAD^{commit}"])
  ).trim();
  const noSelectedPaths =
    selectedPaths !== undefined && selectedPaths.length === 0;
  const patch = noSelectedPaths
    ? ""
    : await runGit(root, [
        "diff",
        "--binary",
        "--full-index",
        "HEAD",
        ...pathArguments(selectedPaths),
      ]);
  const untracked = noSelectedPaths
    ? []
    : (
        await runGit(root, [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
          ...pathArguments(selectedPaths),
        ])
      )
        .split("\0")
        .filter(Boolean)
        .map(assertSafeRelativePath);

  const createdAt = new Date().toISOString();
  const bundlePath = resolve(
    input.bundleRoot,
    `${createdAt.replaceAll(":", "-")}-${randomUUID()}`,
  );
  await mkdir(resolve(bundlePath, "untracked"), { recursive: true });
  for (const path of untracked) {
    const source = resolveWorkspacePath(root, path);
    const sourceStat = await lstat(source);
    if (sourceStat.isSymbolicLink()) {
      throw new Error(
        `Handoff does not support untracked symbolic links: ${path}`,
      );
    }
    if (!sourceStat.isFile()) continue;
    const destination = resolveInside(resolve(bundlePath, "untracked"), path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await writeFile(resolve(bundlePath, "tracked.patch"), patch, "utf8");
  const manifest: WorkspaceChangeBundleManifest = {
    version: 1,
    baseHead,
    sourceWorkspace: root,
    createdAt,
    ...(selectedPaths ? { paths: selectedPaths } : {}),
    untrackedFiles: untracked,
  };
  await writeFile(
    resolve(bundlePath, "manifest.json"),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );
  return { path: bundlePath, manifest };
}

export async function applyWorkspaceChangeBundle(
  input: ApplyWorkspaceChangeBundleInput,
): Promise<ApplyWorkspaceChangeBundleResult> {
  const targetRoot = await repositoryRoot(input.targetWorkspace);
  const manifest = parseManifest(
    JSON.parse(
      await readFile(resolve(input.bundlePath, "manifest.json"), "utf8"),
    ),
  );
  const targetHead = (
    await runGit(targetRoot, ["rev-parse", "--verify", "HEAD^{commit}"])
  ).trim();
  if (targetHead !== manifest.baseHead) {
    throw new Error(
      "Handoff target has a different HEAD. Rebase or choose a matching workspace.",
    );
  }
  const patch = await readFile(
    resolve(input.bundlePath, "tracked.patch"),
    "utf8",
  );
  if (patch) {
    try {
      await gitApply(targetRoot, patch, ["--check"]);
    } catch (error) {
      throw new Error(
        `Handoff patch cannot be applied cleanly: ${
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
    const source = resolveInside(resolve(input.bundlePath, "untracked"), path);
    const sourceStat = await lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Handoff untracked file is invalid: ${path}`);
    }
    const destination = resolveWorkspacePath(targetRoot, path);
    try {
      const targetStat = await lstat(destination);
      if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
        throw new Error(
          `Handoff target already exists and is not a regular file: ${path}`,
        );
      }
      const [sourceContent, targetContent] = await Promise.all([
        readFile(source),
        readFile(destination),
      ]);
      if (!sourceContent.equals(targetContent)) {
        throw new Error(
          `Handoff target already exists with different content: ${path}`,
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

  let patchApplied = false;
  const copied: string[] = [];
  try {
    if (patch) {
      await gitApply(targetRoot, patch, []);
      patchApplied = true;
    }
    for (const file of filesToCopy) {
      await mkdir(dirname(file.destination), { recursive: true });
      await copyFile(file.source, file.destination);
      copied.push(file.path);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const path of copied.reverse()) {
      try {
        await rm(resolveWorkspacePath(targetRoot, path), { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (patchApplied) {
      try {
        await gitApply(targetRoot, patch, ["--reverse"]);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Handoff failed and could not be fully rolled back.",
      );
    }
    throw error;
  }
  return {
    appliedFiles: [
      ...(patch ? (manifest.paths ?? []) : []),
      ...manifest.untrackedFiles,
    ],
  };
}
