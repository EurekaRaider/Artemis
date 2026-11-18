import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  chmod,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rename,
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

import type { ReviewDiff, UndoTurnChangesResult } from "../../shared/api.js";
import { reviewDiffFromText } from "./git-review.js";
import { AppStore, type TurnChangeSetRecord } from "../settings/store.js";

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
  packedOffset?: number;
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

async function repositoryMetadata(
  root: string,
  staged?: string,
): Promise<{
  head: string;
  index: string;
}> {
  const [head, index] = await Promise.all([
    runGit(root, ["rev-parse", "--verify", "HEAD"], [0, 128]).then(
      (value) => value.trim() || "UNBORN",
    ),
    staged === undefined
      ? runGit(root, ["ls-files", "--stage", "-z"]).then(valueHash)
      : valueHash(staged),
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

interface SmallFilePack {
  path: string;
  nextOffset: number;
  pending: Buffer[];
  pendingBytes: number;
}
async function flushPack(pack: SmallFilePack): Promise<void> {
  if (!pack.pendingBytes) return;
  await appendFile(pack.path, Buffer.concat(pack.pending, pack.pendingBytes));
  pack.pending = [];
  pack.pendingBytes = 0;
}

async function snapshotEntry(
  repositoryRoot: string,
  objectRoot: string,
  objects: Map<string, number | undefined>,
  pack: SmallFilePack,
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
  // Hash the captured bytes so an external editor cannot change them between hashing and saving.
  // Keep large files off the JS heap. Entries are captured sequentially in this private directory.
  const pending = join(objectRoot, "pending");
  const bytes =
    sourceStat.size <= 1024 * 1024 ? await readFile(source) : undefined;
  if (!bytes) await copyFile(source, pending);
  const size = bytes?.byteLength ?? (await lstat(pending)).size;
  const hash = bytes
    ? createHash("sha256").update(bytes).digest("hex")
    : await fileHash(pending);
  if (
    size > MAX_SNAPSHOT_FILE_BYTES ||
    totalBytes.value + size > MAX_SNAPSHOT_TOTAL_BYTES
  ) {
    if (!bytes) await rm(pending);
    return {
      path,
      kind: "unsupported",
      hash,
      mode,
      size,
      reason: "The file exceeds the safe snapshot size limit.",
    };
  }
  totalBytes.value += size;
  let packedOffset = objects.get(hash);
  if (!objects.has(hash)) {
    if (bytes) {
      packedOffset = pack.nextOffset;
      pack.nextOffset += size;
      if (size) {
        pack.pending.push(bytes);
        pack.pendingBytes += size;
      }
      if (pack.pendingBytes >= 1024 * 1024) await flushPack(pack);
    } else {
      await rename(pending, join(objectRoot, hash));
    }
    objects.set(hash, packedOffset);
  } else if (!bytes) {
    await rm(pending);
  }
  return {
    path,
    kind: "file",
    hash,
    mode,
    size,
    ...(packedOffset === undefined ? {} : { packedOffset }),
  };
}

async function materializeEntries(
  snapshotPath: string,
  name: string,
  entries: readonly (SnapshotEntry | undefined)[],
) {
  const root = join(snapshotPath, name);
  await mkdir(root, { recursive: true });
  for (const entry of entries) {
    if (!entry || (entry.kind !== "file" && entry.kind !== "symlink")) continue;
    const destination = resolveInside(root, entry.path);
    await mkdir(resolve(destination, ".."), { recursive: true });
    if (entry.kind === "symlink") await symlink(entry.linkTarget!, destination);
    else {
      if (entry.packedOffset === undefined) {
        await copyFile(join(snapshotPath, "objects", entry.hash), destination);
      } else {
        const bytes = Buffer.alloc(entry.size);
        if (entry.size) {
          const pack = await open(
            join(snapshotPath, "objects", "small.pack"),
            "r",
          );
          try {
            let read = 0;
            while (read < bytes.length) {
              const { bytesRead } = await pack.read(
                bytes,
                read,
                bytes.length - read,
                entry.packedOffset + read,
              );
              if (!bytesRead) throw new Error("Incomplete turn snapshot.");
              read += bytesRead;
            }
          } finally {
            await pack.close();
          }
        }
        await writeFile(destination, bytes);
      }
      await chmod(destination, entry.mode);
    }
  }
}

async function captureSnapshot(
  workspacePath: string,
  snapshotPath: string,
  name: "before" | "after" | "recovery",
  onlyPaths?: readonly string[],
  previousEntries: readonly SnapshotEntry[] = [],
): Promise<SnapshotManifest> {
  const repositoryRoot = await realpath(
    resolve(
      (await runGit(workspacePath, ["rev-parse", "--show-toplevel"])).trim(),
    ),
  );
  if ((await realpath(resolve(workspacePath))) !== repositoryRoot) {
    throw new Error("Turn snapshots require the project Git root.");
  }
  const [listed, staged] = await Promise.all([
    onlyPaths
      ? Promise.resolve(onlyPaths.join("\0"))
      : runGit(repositoryRoot, ["ls-files", "-co", "--exclude-standard", "-z"]),
    runGit(repositoryRoot, ["ls-files", "--stage", "-z"]),
  ]);
  const metadata = await repositoryMetadata(repositoryRoot, staged);
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
  const objectRoot = join(snapshotPath, "objects");
  await mkdir(objectRoot, { recursive: true });
  const objects = new Map<string, number | undefined>();
  const pack: SmallFilePack = {
    path: join(objectRoot, "small.pack"),
    nextOffset: 0,
    pending: [],
    pendingBytes: 0,
  };
  for (const entry of previousEntries) {
    if (entry.kind !== "file") continue;
    objects.set(entry.hash, entry.packedOffset);
    if (entry.packedOffset !== undefined)
      pack.nextOffset = Math.max(
        pack.nextOffset,
        entry.packedOffset + entry.size,
      );
  }
  const totalBytes = { value: 0 };
  const entries: SnapshotEntry[] = [];
  for (const path of paths) {
    entries.push(
      await snapshotEntry(
        repositoryRoot,
        objectRoot,
        objects,
        pack,
        path,
        totalBytes,
      ),
    );
  }
  await flushPack(pack);
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
  if (name === "recovery") {
    await materializeEntries(snapshotPath, name, entries);
    await rm(objectRoot, { recursive: true, force: true });
  }
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

function normalizeSnapshotDiff(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      /^(?:diff --git |--- |\+\+\+ |Binary files )/u.test(line)
        ? line
            .replaceAll("a/before/", "a/")
            .replaceAll("b/before/", "b/")
            .replaceAll("a/after/", "a/")
            .replaceAll("b/after/", "b/")
        : line,
    )
    .join("\n");
}

async function snapshotDiff(snapshotPath: string): Promise<string> {
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
      "before",
      "after",
    ],
    [0, 1],
  );
  return normalizeSnapshotDiff(raw);
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
    let before: SnapshotManifest;
    try {
      before = await captureSnapshot(
        input.workspacePath,
        snapshotPath,
        "before",
      );
    } catch (error) {
      await rm(snapshotPath, { recursive: true, force: true });
      throw error;
    }
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
      undefined,
      checkpoint.before.entries,
    );
    const changed = changedSnapshotEntries(checkpoint.before, after);
    let diffText = "";
    if (changed.length) {
      await materializeEntries(
        checkpoint.snapshotPath,
        "before",
        changed.map((change) => change.before),
      );
      await materializeEntries(
        checkpoint.snapshotPath,
        "after",
        changed.map((change) => change.after),
      );
      diffText = await snapshotDiff(checkpoint.snapshotPath);
      // The persisted undo format still uses before/<path> and the original manifests.
      await rm(join(checkpoint.snapshotPath, "objects"), {
        recursive: true,
        force: true,
      });
    }
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
