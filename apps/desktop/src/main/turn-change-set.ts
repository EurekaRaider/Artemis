import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type {
  TurnChangeFile,
  TurnChangeSetUpdatedPayload,
} from "@artemis/protocol";

import type { ReviewDiff, UndoTurnChangesResult } from "../shared/api.js";
import { reviewDiffFromText } from "./git-review.js";
import { AppStore, type TurnChangeSetRecord } from "./store.js";

const execFileAsync = promisify(execFile);
const MAX_SNAPSHOT_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SNAPSHOT_TOTAL_BYTES = 512 * 1024 * 1024;

type SnapshotKind = "file" | "symlink" | "missing" | "unsupported";

interface SnapshotEntry {
  path: string;
  kind: SnapshotKind;
  hash: string;
  mode: number;
  size: number;
  linkTarget?: string;
  reason?: string;
}

interface SnapshotManifest {
  repositoryRoot: string;
  head: string;
  index: string;
  entries: SnapshotEntry[];
  capturedAt: string;
}

interface ActiveCheckpoint {
  threadId: string;
  turnId: string;
  workspacePath: string;
  snapshotPath: string;
  before: SnapshotManifest;
}

function safeSegment(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(value)) {
    throw new Error("Snapshot identifier contains unsafe characters.");
  }
  return value;
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function resolveInside(root: string, path: string): string {
  const target = resolve(root, path);
  const relation = relative(root, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new Error(`Snapshot path escapes the repository: ${path}`);
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
      maxBuffer: 128 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const failure = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    if (
      typeof failure.code === "number" &&
      acceptedExitCodes.includes(failure.code)
    ) {
      return failure.stdout ?? "";
    }
    throw new Error((failure.stderr ?? failure.message).trim());
  }
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

function valueHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function repositoryMetadata(root: string): Promise<{
  head: string;
  index: string;
}> {
  const [head, index] = await Promise.all([
    runGit(root, ["rev-parse", "--verify", "HEAD"], [0, 128]).then(
      (value) => value.trim() || "UNBORN",
    ),
    runGit(root, ["ls-files", "--stage", "-z"]).then(valueHash),
  ]);
  return { head, index };
}

function submodulePaths(indexOutput: string): Set<string> {
  const result = new Set<string>();
  for (const record of indexOutput.split("\0")) {
    if (!record.startsWith("160000 ")) continue;
    const tab = record.indexOf("\t");
    if (tab >= 0) result.add(normalizedPath(record.slice(tab + 1)));
  }
  return result;
}

async function snapshotEntry(
  repositoryRoot: string,
  contentRoot: string,
  objectRoot: string,
  path: string,
  totalBytes: { value: number },
): Promise<SnapshotEntry> {
  const source = resolveInside(repositoryRoot, path);
  let sourceStat: Awaited<ReturnType<typeof lstat>>;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, kind: "missing", hash: "missing", mode: 0, size: 0 };
    }
    throw error;
  }
  const mode = sourceStat.mode & 0o777;
  if (sourceStat.isSymbolicLink()) {
    const linkTarget = await readlink(source);
    const destination = resolveInside(contentRoot, path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    await symlink(linkTarget, destination);
    return {
      path,
      kind: "symlink",
      hash: valueHash(linkTarget),
      mode,
      size: Buffer.byteLength(linkTarget),
      linkTarget,
    };
  }
  if (!sourceStat.isFile()) {
    return {
      path,
      kind: "unsupported",
      hash: valueHash(
        `${sourceStat.mode}:${sourceStat.size}:${sourceStat.mtimeMs}`,
      ),
      mode,
      size: sourceStat.size,
      reason: "Special files cannot be restored safely.",
    };
  }
  if (
    sourceStat.size > MAX_SNAPSHOT_FILE_BYTES ||
    totalBytes.value + sourceStat.size > MAX_SNAPSHOT_TOTAL_BYTES
  ) {
    return {
      path,
      kind: "unsupported",
      hash: await fileHash(source),
      mode,
      size: sourceStat.size,
      reason: "The file exceeds the safe snapshot size limit.",
    };
  }
  totalBytes.value += sourceStat.size;
  const hash = await fileHash(source);
  const objectPath = join(objectRoot, hash.slice(0, 2), hash);
  try {
    await lstat(objectPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(resolve(objectPath, ".."), { recursive: true });
    await copyFile(source, objectPath);
  }
  const destination = resolveInside(contentRoot, path);
  await mkdir(resolve(destination, ".."), { recursive: true });
  await copyFile(objectPath, destination);
  await chmod(destination, mode);
  return {
    path,
    kind: "file",
    hash,
    mode,
    size: sourceStat.size,
  };
}

async function captureSnapshot(
  workspacePath: string,
  snapshotPath: string,
  name: "before" | "after" | "recovery",
  onlyPaths?: readonly string[],
): Promise<SnapshotManifest> {
  const repositoryRoot = await realpath(
    resolve(
      (await runGit(workspacePath, ["rev-parse", "--show-toplevel"])).trim(),
    ),
  );
  if ((await realpath(resolve(workspacePath))) !== repositoryRoot) {
    throw new Error("Turn snapshots require the project Git root.");
  }
  const [listed, staged, metadata] = await Promise.all([
    onlyPaths
      ? Promise.resolve(onlyPaths.join("\0"))
      : runGit(repositoryRoot, ["ls-files", "-co", "--exclude-standard", "-z"]),
    runGit(repositoryRoot, ["ls-files", "--stage", "-z"]),
    repositoryMetadata(repositoryRoot),
  ]);
  const submodules = submodulePaths(staged);
  const paths = [
    ...new Set(
      listed
        .split("\0")
        .map(normalizedPath)
        .filter(Boolean)
        .filter((path) => !submodules.has(path)),
    ),
  ].sort();
  const contentRoot = join(snapshotPath, name);
  const objectRoot = join(snapshotPath, "objects");
  await rm(contentRoot, { recursive: true, force: true });
  await mkdir(contentRoot, { recursive: true });
  const totalBytes = { value: 0 };
  const entries: SnapshotEntry[] = [];
  for (const path of paths) {
    entries.push(
      await snapshotEntry(
        repositoryRoot,
        contentRoot,
        objectRoot,
        path,
        totalBytes,
      ),
    );
  }
  const manifest: SnapshotManifest = {
    repositoryRoot,
    ...metadata,
    entries,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(
    join(snapshotPath, `${name}.json`),
    JSON.stringify(manifest),
    "utf8",
  );
  return manifest;
}

function entryMap(manifest: SnapshotManifest): Map<string, SnapshotEntry> {
  return new Map(manifest.entries.map((entry) => [entry.path, entry]));
}

function entriesEqual(
  left: SnapshotEntry | undefined,
  right: SnapshotEntry | undefined,
): boolean {
  const leftKind = left?.kind ?? "missing";
  const rightKind = right?.kind ?? "missing";
  if (leftKind === "missing" && rightKind === "missing") return true;
  return (
    leftKind === rightKind &&
    left?.hash === right?.hash &&
    left?.mode === right?.mode
  );
}

function changedSnapshotEntries(
  before: SnapshotManifest,
  after: SnapshotManifest,
): Array<{
  path: string;
  before?: SnapshotEntry;
  after?: SnapshotEntry;
}> {
  const beforeEntries = entryMap(before);
  const afterEntries = entryMap(after);
  const paths = [
    ...new Set([...beforeEntries.keys(), ...afterEntries.keys()]),
  ].sort();
  return paths.flatMap((path) => {
    const beforeEntry = beforeEntries.get(path);
    const afterEntry = afterEntries.get(path);
    return entriesEqual(beforeEntry, afterEntry)
      ? []
      : [
          {
            path,
            ...(beforeEntry ? { before: beforeEntry } : {}),
            ...(afterEntry ? { after: afterEntry } : {}),
          },
        ];
  });
}

function normalizeSnapshotDiff(
  text: string,
  beforePath: string,
  afterPath: string,
): string {
  const beforePrefix = normalizedPath(beforePath).replace(/^\/+/, "");
  const afterPrefix = normalizedPath(afterPath).replace(/^\/+/, "");
  return text
    .replaceAll(`a/${beforePrefix}/`, "a/")
    .replaceAll(`b/${beforePrefix}/`, "b/")
    .replaceAll(`a/${afterPrefix}/`, "a/")
    .replaceAll(`b/${afterPrefix}/`, "b/");
}

async function snapshotDiff(snapshotPath: string): Promise<string> {
  const beforePath = join(snapshotPath, "before");
  const afterPath = join(snapshotPath, "after");
  const raw = await runGit(
    snapshotPath,
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-index",
      "--binary",
      "--full-index",
      "--no-renames",
      "--unified=3",
      "--",
      beforePath,
      afterPath,
    ],
    [0, 1],
  );
  return normalizeSnapshotDiff(raw, beforePath, afterPath);
}

function payloadFromRecord(
  record: TurnChangeSetRecord,
): TurnChangeSetUpdatedPayload {
  return {
    type: "turn.change-set.updated",
    status: record.status,
    files: record.files,
    additions: record.additions,
    deletions: record.deletions,
    undoAvailable: record.undoAvailable,
    ...(record.message ? { message: record.message } : {}),
  };
}

function unsupportedChangeFile(
  path: string,
  before: SnapshotEntry | undefined,
  after: SnapshotEntry | undefined,
): TurnChangeFile {
  return {
    path,
    status:
      !before || before.kind === "missing"
        ? "added"
        : !after || after.kind === "missing"
          ? "deleted"
          : "modified",
    additions: 0,
    deletions: 0,
    binary: true,
  };
}

async function restoreFromManifest(
  workspacePath: string,
  snapshotPath: string,
  sourceName: "before" | "recovery",
  manifest: SnapshotManifest,
  paths: readonly string[],
): Promise<void> {
  const entries = entryMap(manifest);
  for (const path of paths) {
    const destination = resolveInside(workspacePath, path);
    const entry = entries.get(path);
    if (!entry || entry.kind === "missing") {
      await rm(destination, { recursive: true, force: true });
      continue;
    }
    if (entry.kind === "unsupported") {
      throw new Error(`Cannot safely restore ${path}.`);
    }
    await rm(destination, { recursive: true, force: true });
    await mkdir(resolve(destination, ".."), { recursive: true });
    if (entry.kind === "symlink") {
      await symlink(entry.linkTarget!, destination);
    } else {
      await copyFile(join(snapshotPath, sourceName, path), destination);
      await chmod(destination, entry.mode);
    }
  }
}

export class TurnChangeSetService {
  private readonly active = new Map<string, ActiveCheckpoint>();

  constructor(
    private readonly root: string,
    private readonly store: AppStore,
  ) {}

  async begin(input: {
    threadId: string;
    turnId: string;
    workspacePath: string;
  }): Promise<void> {
    const threadId = safeSegment(input.threadId);
    const turnId = safeSegment(input.turnId);
    const snapshotPath = join(this.root, "checkpoints", threadId, turnId);
    await rm(snapshotPath, { recursive: true, force: true });
    await mkdir(snapshotPath, { recursive: true });
    const before = await captureSnapshot(
      input.workspacePath,
      snapshotPath,
      "before",
    );
    this.active.set(input.turnId, {
      ...input,
      snapshotPath,
      before,
    });
  }

  async complete(
    threadId: string,
    turnId: string,
    backgroundProcessesRunning = false,
  ): Promise<TurnChangeSetUpdatedPayload | undefined> {
    const checkpoint = this.active.get(turnId);
    if (!checkpoint || checkpoint.threadId !== threadId) return undefined;
    const after = await captureSnapshot(
      checkpoint.workspacePath,
      checkpoint.snapshotPath,
      "after",
    );
    const changed = changedSnapshotEntries(checkpoint.before, after);
    const diffText = await snapshotDiff(checkpoint.snapshotPath);
    const review = reviewDiffFromText("turn", diffText);
    const reviewByPath = new Map(review.files.map((file) => [file.path, file]));
    const unsupported = changed.filter(
      (change) =>
        change.before?.kind === "unsupported" ||
        change.after?.kind === "unsupported",
    );
    const files: TurnChangeFile[] = changed.map((change) => {
      const parsed = reviewByPath.get(change.path);
      return parsed
        ? {
            path: parsed.path,
            status: parsed.status,
            additions: parsed.additions,
            deletions: parsed.deletions,
            binary: parsed.binary,
          }
        : unsupportedChangeFile(change.path, change.before, change.after);
    });
    const additions = files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
    const stableGitState =
      checkpoint.before.head === after.head &&
      checkpoint.before.index === after.index;
    const undoAvailable =
      files.length > 0 &&
      unsupported.length === 0 &&
      stableGitState &&
      !backgroundProcessesRunning;
    const message = backgroundProcessesRunning
      ? "A shell process from this turn is still running, so the snapshot is review-only."
      : unsupported.length > 0
        ? "Some changed files can be reviewed but cannot be restored safely."
        : !stableGitState && files.length > 0
          ? "HEAD or the Git index changed during this turn, so undo is disabled."
          : undefined;
    const now = new Date().toISOString();
    const record = this.store.upsertTurnChangeSet({
      threadId,
      turnId,
      status: "ready",
      files,
      additions,
      deletions,
      undoAvailable,
      ...(message ? { message } : {}),
      diffText,
      ...(undoAvailable ? { snapshotPath: checkpoint.snapshotPath } : {}),
      workspacePath: checkpoint.workspacePath,
      startHead: checkpoint.before.head,
      startIndex: checkpoint.before.index,
      endHead: after.head,
      endIndex: after.index,
      createdAt: now,
      updatedAt: now,
    });
    for (const path of this.store.releaseOlderTurnChangeSetUndo(
      threadId,
      turnId,
    )) {
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    }
    if (!undoAvailable) {
      await rm(checkpoint.snapshotPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    this.active.delete(turnId);
    return payloadFromRecord(record);
  }

  async discard(turnId: string): Promise<void> {
    const checkpoint = this.active.get(turnId);
    if (!checkpoint) return;
    this.active.delete(turnId);
    await rm(checkpoint.snapshotPath, { recursive: true, force: true });
  }

  review(threadId: string, turnId: string): ReviewDiff {
    const record = this.store.getTurnChangeSet(threadId, turnId);
    if (!record) {
      return {
        available: false,
        scope: "turn",
        text: "",
        files: [],
        message: "This turn does not have a persisted change set.",
      };
    }
    const review = reviewDiffFromText("turn", record.diffText);
    const parsed = new Set(review.files.map((file) => file.path));
    return {
      ...review,
      files: [
        ...review.files,
        ...record.files
          .filter((file) => !parsed.has(file.path))
          .map((file) => ({
            id: valueHash(`turn\0${file.path}\0unsupported`),
            ...file,
            untracked: file.status === "added",
            hunks: [],
          })),
      ],
      ...(record.message ? { message: record.message } : {}),
    };
  }

  async undo(
    threadId: string,
    turnId: string,
  ): Promise<{
    result: UndoTurnChangesResult;
    payload: TurnChangeSetUpdatedPayload;
  }> {
    const record = this.store.getTurnChangeSet(threadId, turnId);
    const latest = this.store.getLatestTurnChangeSet(threadId);
    if (!record || latest?.turnId !== turnId) {
      throw new Error("Only the latest completed turn can be undone.");
    }
    if (
      record.status !== "ready" ||
      !record.undoAvailable ||
      !record.snapshotPath
    ) {
      throw new Error(record.message ?? "This turn cannot be undone safely.");
    }
    const metadata = await repositoryMetadata(record.workspacePath);
    if (
      metadata.head !== record.endHead ||
      metadata.index !== record.endIndex
    ) {
      throw new Error("HEAD or the Git index changed after this turn.");
    }
    const before = JSON.parse(
      await readFile(join(record.snapshotPath, "before.json"), "utf8"),
    ) as SnapshotManifest;
    const after = JSON.parse(
      await readFile(join(record.snapshotPath, "after.json"), "utf8"),
    ) as SnapshotManifest;
    const paths = record.files.map((file) => file.path);
    const currentPath = join(record.snapshotPath, "current-validation");
    const current = await captureSnapshot(
      record.workspacePath,
      currentPath,
      "recovery",
      paths,
    );
    const expected = entryMap(after);
    const actual = entryMap(current);
    const conflict = paths.find(
      (path) => !entriesEqual(expected.get(path), actual.get(path)),
    );
    await rm(currentPath, { recursive: true, force: true });
    if (conflict) {
      throw new Error(
        `The current file no longer matches this turn: ${conflict}`,
      );
    }

    const recoveryPath = join(
      this.root,
      "recovery",
      safeSegment(threadId),
      `${Date.now()}-${randomUUID()}`,
    );
    await mkdir(recoveryPath, { recursive: true });
    const recovery = await captureSnapshot(
      record.workspacePath,
      recoveryPath,
      "recovery",
      paths,
    );
    let updated: TurnChangeSetRecord;
    try {
      await restoreFromManifest(
        record.workspacePath,
        record.snapshotPath,
        "before",
        before,
        paths,
      );
      const now = new Date().toISOString();
      const { snapshotPath: _snapshotPath, ...recordWithoutSnapshot } = record;
      updated = this.store.upsertTurnChangeSet({
        ...recordWithoutSnapshot,
        status: "undone",
        undoAvailable: false,
        message: "The task-period workspace changes were undone.",
        updatedAt: now,
      });
    } catch (error) {
      await restoreFromManifest(
        record.workspacePath,
        recoveryPath,
        "recovery",
        recovery,
        paths,
      );
      throw error;
    }
    await rm(record.snapshotPath, { recursive: true, force: true });
    return {
      result: { turnId, restoredFiles: paths, recoveryPath },
      payload: payloadFromRecord(updated),
    };
  }

  async deleteThread(threadId: string): Promise<void> {
    for (const [turnId, checkpoint] of this.active) {
      if (checkpoint.threadId === threadId) this.active.delete(turnId);
    }
    for (const path of this.store.listTurnChangeSetSnapshotPaths(threadId)) {
      await rm(path, { recursive: true, force: true });
    }
    await rm(join(this.root, "checkpoints", safeSegment(threadId)), {
      recursive: true,
      force: true,
    });
    await rm(join(this.root, "recovery", safeSegment(threadId)), {
      recursive: true,
      force: true,
    });
  }
}
