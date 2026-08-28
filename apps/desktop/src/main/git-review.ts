import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { copyFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { canonicalizeFileSystemPath } from "@artemis/platform";

import type {
  ReviewAction,
  ReviewDiff,
  ReviewFile,
  ReviewHunk,
  ReviewScope,
} from "../shared/api.js";

const execFileAsync = promisify(execFile);
const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

interface ReviewTarget {
  kind: "file" | "hunk";
  id: string;
}

export interface GetReviewDiffInput {
  workspace: string;
  scope: ReviewScope;
  paths?: string[];
  baseRef?: string;
}

export interface MutateReviewDiffInput extends GetReviewDiffInput {
  action: ReviewAction;
  target: ReviewTarget;
  recoveryRoot: string;
}

export interface MutateReviewDiffResult {
  recoveryPath?: string;
}

interface InternalReviewHunk extends ReviewHunk {
  patch: string;
}

interface InternalReviewFile extends Omit<ReviewFile, "hunks"> {
  patch: string;
  hunks: InternalReviewHunk[];
}

interface InternalReviewDiff extends ReviewDiff {
  files: InternalReviewFile[];
}

interface GitFailure extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeGitPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function assertRelativePath(path: string): string {
  const normalized = normalizeGitPath(path);
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error(`Git returned an unsafe path: ${path}`);
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
    throw new Error(`Review path escapes the repository: ${path}`);
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
      timeout: 20_000,
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

async function repositoryRoot(workspace: string): Promise<string> {
  const root = (
    await runGit(workspace, ["rev-parse", "--show-toplevel"])
  ).trim();
  if (!root) {
    throw new Error("The selected project is not a Git repository.");
  }
  return resolve(root);
}

function toRepositoryPaths(
  root: string,
  workspace: string,
  paths: string[] | undefined,
): string[] {
  if (!paths?.length) return [];
  const workspacePrefix = relative(
    canonicalizeFileSystemPath(root),
    canonicalizeFileSystemPath(workspace),
  );
  if (
    workspacePrefix === ".." ||
    workspacePrefix.startsWith(`..${sep}`) ||
    isAbsolute(workspacePrefix)
  ) {
    throw new Error("The selected project is outside its Git repository.");
  }
  return [
    ...new Set(
      paths.map((path) =>
        assertRelativePath(
          normalizeGitPath(
            workspacePrefix ? `${workspacePrefix}/${path}` : path,
          ),
        ),
      ),
    ),
  ];
}

function pathArguments(paths: string[]): string[] {
  return paths.length ? ["--", ...paths] : ["--"];
}

async function resolveBaseRef(
  root: string,
  requested: string | undefined,
): Promise<string> {
  const candidates: string[] = [];
  if (requested?.trim()) {
    candidates.push(requested.trim());
  } else {
    try {
      const symbolic = (
        await runGit(root, [
          "symbolic-ref",
          "--quiet",
          "--short",
          "refs/remotes/origin/HEAD",
        ])
      ).trim();
      if (symbolic) candidates.push(symbolic);
    } catch {
      // A local-only repository normally has no origin/HEAD.
    }
    candidates.push("main", "master");
  }

  for (const candidate of candidates) {
    try {
      await runGit(root, ["check-ref-format", "--branch", candidate]);
      await runGit(root, [
        "rev-parse",
        "--verify",
        "--quiet",
        "--end-of-options",
        `${candidate}^{commit}`,
      ]);
      return candidate;
    } catch {
      // Try the next conventional base.
    }
  }
  throw new Error(
    requested
      ? `Base ref does not exist: ${requested}`
      : "No branch base was found. Enter a base ref.",
  );
}

async function currentTreeBase(root: string): Promise<string> {
  try {
    await runGit(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    return "HEAD";
  } catch {
    return emptyTree;
  }
}

const diffPrefix = [
  "-c",
  "core.quotePath=false",
  "diff",
  "--no-ext-diff",
  "--binary",
  "--full-index",
  "--no-renames",
  "--unified=3",
];

async function untrackedPaths(
  root: string,
  paths: string[],
): Promise<string[]> {
  const output = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    ...pathArguments(paths),
  ]);
  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => assertRelativePath(path));
}

async function diffUntrackedFile(root: string, path: string): Promise<string> {
  return runGit(
    root,
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-index",
      "--full-index",
      "--unified=3",
      "--",
      "/dev/null",
      path,
    ],
    [0, 1],
  );
}

function parseMarkerPath(line: string): string | undefined {
  const raw = line.slice(4).split("\t", 1)[0]!;
  if (raw === "/dev/null") return undefined;
  const withoutPrefix =
    raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw;
  return assertRelativePath(withoutPrefix);
}

function parseDiffHeaderPath(line: string): string | undefined {
  if (!line.startsWith("diff --git a/")) return undefined;
  const value = line.slice("diff --git ".length);
  let separator = value.indexOf(" b/");
  while (separator >= 0) {
    const oldPath = value.slice(0, separator);
    const newPath = value.slice(separator + 1);
    if (
      oldPath.startsWith("a/") &&
      newPath.startsWith("b/") &&
      oldPath.slice(2) === newPath.slice(2)
    ) {
      return assertRelativePath(newPath.slice(2));
    }
    separator = value.indexOf(" b/", separator + 1);
  }
  return undefined;
}

function lineChanges(lines: string[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function parseHunkLines(
  scope: ReviewScope,
  path: string,
  hunkLines: string[],
): ReviewHunk["lines"] {
  const header = hunkLines[0] ?? "";
  const coordinates = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(header);
  if (!coordinates) {
    return [];
  }
  let oldLine = Number.parseInt(coordinates[1]!, 10);
  let newLine = Number.parseInt(coordinates[2]!, 10);
  const result: ReviewHunk["lines"] = [];
  for (const rawLine of hunkLines.slice(1)) {
    if (rawLine.startsWith("\\ No newline at end of file")) {
      continue;
    }
    const prefix = rawLine[0] ?? " ";
    const text = rawLine.slice(1);
    const kind =
      prefix === "+"
        ? ("addition" as const)
        : prefix === "-"
          ? ("deletion" as const)
          : ("context" as const);
    const anchor = {
      ...(kind !== "addition" ? { oldLine } : {}),
      ...(kind !== "deletion" ? { newLine } : {}),
    };
    result.push({
      id: digest(
        `${scope}\0${path}\0${header}\0${kind}\0${anchor.oldLine ?? ""}\0${anchor.newLine ?? ""}\0${text}`,
      ),
      kind,
      text,
      ...anchor,
    });
    if (kind !== "addition") oldLine += 1;
    if (kind !== "deletion") newLine += 1;
  }
  return result;
}

function parseDiff(
  scope: ReviewScope,
  text: string,
  untracked: ReadonlySet<string>,
): InternalReviewFile[] {
  const blocks = text
    .replaceAll("\r\n", "\n")
    .split(/(?=^diff --git )/m)
    .filter((block) => block.startsWith("diff --git "));

  return blocks.map((block) => {
    const lines = block.split("\n");
    const oldPath = lines
      .find((line) => line.startsWith("--- "))
      ?.replace(/^--- /, "");
    const newPath = lines
      .find((line) => line.startsWith("+++ "))
      ?.replace(/^\+\+\+ /, "");
    const path =
      (newPath ? parseMarkerPath(`+++ ${newPath}`) : undefined) ??
      (oldPath ? parseMarkerPath(`--- ${oldPath}`) : undefined) ??
      parseDiffHeaderPath(lines[0] ?? "");
    if (!path) {
      throw new Error("Git diff did not contain a reviewable file path.");
    }

    const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
    const headerLines = firstHunk >= 0 ? lines.slice(0, firstHunk) : lines;
    const hunkStarts = lines
      .map((line, index) => (line.startsWith("@@ ") ? index : -1))
      .filter((index) => index >= 0);
    const hunks = hunkStarts.map((start, index) => {
      const end = hunkStarts[index + 1] ?? lines.length;
      const hunkLines = lines.slice(start, end);
      const patch = `${[...headerLines, ...hunkLines].join("\n")}\n`;
      return {
        id: digest(`${scope}\0${path}\0${patch}`),
        header: hunkLines[0] ?? "@@",
        ...lineChanges(hunkLines),
        lines: parseHunkLines(scope, path, hunkLines),
        patch,
      };
    });
    const changes = lineChanges(lines);
    const untrackedFile = untracked.has(path);
    const status = lines.some((line) => line.startsWith("deleted file mode"))
      ? "deleted"
      : untrackedFile || lines.some((line) => line.startsWith("new file mode"))
        ? "added"
        : "modified";

    return {
      id: digest(`${scope}\0${path}\0${block}`),
      path,
      status,
      ...changes,
      binary: lines.some(
        (line) =>
          line.startsWith("Binary files ") ||
          line.startsWith("GIT binary patch"),
      ),
      untracked: untrackedFile,
      patch: block.endsWith("\n") ? block : `${block}\n`,
      hunks,
    };
  });
}

export function reviewDiffFromText(
  scope: ReviewScope,
  text: string,
): ReviewDiff {
  return {
    available: true,
    scope,
    text,
    files: parseDiff(scope, text, new Set()).map(
      ({ patch: _patch, hunks, ...file }) => ({
        ...file,
        hunks: hunks.map(({ patch: _hunkPatch, ...hunk }) => hunk),
      }),
    ),
  };
}

async function loadReviewDiff(
  input: GetReviewDiffInput,
): Promise<InternalReviewDiff> {
  const root = await repositoryRoot(input.workspace);
  const paths = toRepositoryPaths(root, input.workspace, input.paths);
  if (input.scope === "last-turn" && input.paths?.length === 0) {
    return {
      available: true,
      scope: input.scope,
      text: "",
      files: [],
    };
  }
  let text = "";
  let baseRef: string | undefined;
  let untracked: string[] = [];

  switch (input.scope) {
    case "turn":
      throw new Error("Turn review must use its persisted immutable diff.");
    case "unstaged":
      [text, untracked] = await Promise.all([
        runGit(root, [...diffPrefix, ...pathArguments(paths)]),
        untrackedPaths(root, paths),
      ]);
      break;
    case "staged":
      text = await runGit(root, [
        ...diffPrefix,
        "--cached",
        ...pathArguments(paths),
      ]);
      break;
    case "last-turn": {
      const base = await currentTreeBase(root);
      [text, untracked] = await Promise.all([
        runGit(root, [...diffPrefix, base, ...pathArguments(paths)]),
        untrackedPaths(root, paths),
      ]);
      break;
    }
    case "branch": {
      baseRef = await resolveBaseRef(root, input.baseRef);
      const mergeBase = (
        await runGit(root, ["merge-base", baseRef, "HEAD"])
      ).trim();
      text = await runGit(root, [
        ...diffPrefix,
        mergeBase,
        "HEAD",
        ...pathArguments(paths),
      ]);
      break;
    }
  }

  for (let index = 0; index < untracked.length; index += 4) {
    text += (
      await Promise.all(
        untracked
          .slice(index, index + 4)
          .map((path) => diffUntrackedFile(root, path)),
      )
    ).join("");
  }
  const untrackedSet = new Set(untracked);
  const files = parseDiff(input.scope, text, untrackedSet);
  return {
    available: true,
    scope: input.scope,
    text,
    files,
    ...(baseRef ? { baseRef } : {}),
  };
}

export async function getReviewDiff(
  input: GetReviewDiffInput,
): Promise<ReviewDiff> {
  const result = await loadReviewDiff(input);
  return {
    ...result,
    files: result.files.map(({ patch: _patch, hunks, ...file }) => ({
      ...file,
      hunks: hunks.map(({ patch: _hunkPatch, ...hunk }) => hunk),
    })),
  };
}

function allowedAction(scope: ReviewScope, action: ReviewAction): boolean {
  return (
    (scope === "unstaged" && (action === "stage" || action === "revert")) ||
    (scope === "staged" && action === "unstage")
  );
}

async function applyPatch(
  root: string,
  patch: string,
  flags: string[],
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "git",
      ["apply", "--whitespace=nowarn", ...flags, "-"],
      {
        cwd: root,
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

async function backUpFile(
  root: string,
  path: string,
  recoveryRoot: string,
  action: ReviewAction,
): Promise<string> {
  const recoveryPath = resolve(
    recoveryRoot,
    `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`,
  );
  await mkdir(recoveryPath, { recursive: true });
  const source = resolveInside(root, path);
  try {
    const sourceStat = await lstat(source);
    if (sourceStat.isFile()) {
      const destination = resolveInside(recoveryPath, path);
      await mkdir(resolve(destination, ".."), { recursive: true });
      await copyFile(source, destination);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(
    resolve(recoveryPath, "manifest.json"),
    `${JSON.stringify(
      {
        workspace: root,
        path,
        action,
        createdAt: new Date().toISOString(),
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
  return recoveryPath;
}

export async function mutateReviewDiff(
  input: MutateReviewDiffInput,
): Promise<MutateReviewDiffResult> {
  if (!allowedAction(input.scope, input.action)) {
    throw new Error(`${input.scope} review is read-only for ${input.action}.`);
  }

  const root = await repositoryRoot(input.workspace);
  const current = await loadReviewDiff(input);
  let selectedFile: InternalReviewFile | undefined;
  let patch: string | undefined;

  if (input.target.kind === "file") {
    selectedFile = current.files.find((file) => file.id === input.target.id);
    patch = selectedFile?.patch;
  } else {
    for (const file of current.files) {
      const hunk = file.hunks.find((item) => item.id === input.target.id);
      if (hunk) {
        selectedFile = file;
        patch = hunk.patch;
        break;
      }
    }
  }
  if (!selectedFile || !patch) {
    throw new Error("Review target is stale. Refresh the diff and try again.");
  }

  let recoveryPath: string | undefined;
  if (input.action === "revert") {
    recoveryPath = await backUpFile(
      root,
      selectedFile.path,
      input.recoveryRoot,
      input.action,
    );
  }

  if (
    input.target.kind === "file" &&
    selectedFile.binary &&
    selectedFile.untracked
  ) {
    if (input.action === "stage") {
      await runGit(root, ["add", "--", selectedFile.path]);
    } else {
      await rm(resolveInside(root, selectedFile.path), { force: true });
    }
    return recoveryPath ? { recoveryPath } : {};
  }

  const flags =
    input.action === "stage"
      ? ["--cached"]
      : input.action === "unstage"
        ? ["--cached", "--reverse"]
        : ["--reverse"];
  await applyPatch(root, patch, flags);
  return recoveryPath ? { recoveryPath } : {};
}
