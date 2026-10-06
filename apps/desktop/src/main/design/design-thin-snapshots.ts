// Design thin snapshots: file-change-triggered version history for workspace
// design targets (.html/.htm). The hosted-document ledger is gone; history
// lives beside the workspace in <workspace>/.artemis/versions/<path hash>/
// as timestamped copies. Append-only, bounded per file, never written on
// restore (restore copies snapshot content back to the workspace, which then
// records its own new snapshot via the normal change pipeline).
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, copyFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const VERSIONS_DIR = ".artemis/versions";
const MAX_PER_FILE = 50;
const MIN_BYTES_DELTA = 1; // every observed change snapshots

const isHtmlPath = (path: string): boolean =>
  /\.(html?|htm)$/i.test(path);

export const designThinSnapshotRoot = (workspacePath: string): string =>
  join(workspacePath, VERSIONS_DIR);

export function designThinSnapshotDir(
  workspacePath: string,
  requestedPath: string,
): string | undefined {
  const rel = relative(workspacePath, resolve(workspacePath, requestedPath))
    .replaceAll("\\", "/");
  if (!rel || rel.startsWith("..") || resolve(workspacePath, requestedPath) === resolve(workspacePath))
    return undefined;
  if (!isHtmlPath(rel)) return undefined;
  const id = createHash("sha256").update(rel).digest("hex").slice(0, 16);
  return join(designThinSnapshotRoot(workspacePath), id);
}

/** Record a snapshot of one workspace file after a change. Snapshots carry
 * the full file copy plus sidecar meta (path/bytes/occurredAt) so the panel
 * can render labels without a lookup table. Failures are non-fatal. */
export async function recordDesignThinSnapshot(
  workspacePath: string,
  requestedPath: string,
  opts: { source?: string; operationId?: string } = {},
): Promise<{ revision: string; occurredAt: string } | undefined> {
  const abs = resolve(workspacePath, requestedPath);
  if (!abs.startsWith(resolve(workspacePath) + sep) && abs !== resolve(workspacePath))
    return undefined;
  const rel = relative(workspacePath, abs).replaceAll("\\", "/");
  if (!isHtmlPath(rel)) return undefined;
  const dir = designThinSnapshotDir(workspacePath, rel);
  if (!dir) return undefined;
  let bytes: Buffer;
  let mtime: Date;
  try {
    const info = await stat(abs);
    if (!info.isFile()) return undefined;
    bytes = await readFile(abs);
    mtime = info.mtime;
  } catch {
    return undefined;
  }
  const occurredAt = new Date().toISOString();
  const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  await mkdir(dir, { recursive: true });
  // 内容去重：最新一份与本次内容一致（重复写同内容/恢复后重记）则跳过
  const existing = (await readdir(dir).catch(() => []))
    .filter((f) => /^\d+-[0-9a-f]{16}\.html$/.test(f))
    .sort();
  const newestRev = /^(\d+)-([0-9a-f]{16})\.html$/.exec(existing.at(-1) ?? "");
  if (newestRev && newestRev[2] === revision) {
    await resetDesignThinCursor(dir);
    return { revision, occurredAt };
  }
  const target = join(dir, `${Date.now()}-${revision}.html`);
  await copyFile(abs, target).catch(() => undefined);
  await writeFile(
    join(dir, "meta.jsonl"),
    JSON.stringify({
      revision,
      path: rel,
      bytes: bytes.length,
      occurredAt,
      mtime: mtime.toISOString(),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.operationId ? { operationId: opts.operationId } : {}),
    }) + "\n",
    { flag: "a" },
  ).catch(() => undefined);
  await pruneDesignThinSnapshots(dir).catch(() => undefined);
  await resetDesignThinCursor(dir);
  return { revision, occurredAt };
}

// ---- undo/redo cursor（游标 = 距最新快照的回退步数；真实新状态归零）----

interface ThinCursor {
  undone: number;
}

async function readDesignThinCursor(dir: string): Promise<ThinCursor> {
  try {
    const parsed = JSON.parse(await readFile(join(dir, "cursor.json"), "utf8"));
    if (typeof parsed.undone === "number" && parsed.undone >= 0)
      return { undone: parsed.undone };
  } catch {
    /* 无游标 = 处于最新 */
  }
  return { undone: 0 };
}

async function writeDesignThinCursor(
  dir: string,
  cursor: ThinCursor,
): Promise<void> {
  await writeFile(join(dir, "cursor.json"), JSON.stringify(cursor) + "\n");
}

async function resetDesignThinCursor(dir: string): Promise<void> {
  await writeFile(join(dir, "cursor.json"), '{"undone":0}\n').catch(
    () => undefined,
  );
}

async function snapshotFileAt(
  dir: string,
  indexFromHead: number,
): Promise<string | undefined> {
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => /^\d+-[0-9a-f]{16}\.html$/.test(f))
    .sort(
      (a, b) =>
        Number(/^\d+/.exec(a)?.[0] ?? 0) - Number(/^\d+/.exec(b)?.[0] ?? 0),
    );
  if (files.length === 0) return undefined;
  const target = files.length - 1 - indexFromHead;
  return target >= 0 ? files[target] : undefined;
}

/** undo：回退一步（游标 +1），把对应快照内容写回工作区。
 * 游标移动不追加快照（历史保持纯时间序）；已到最早一份时报错。 */
export async function undoDesignThinVersion(
  workspacePath: string,
  requestedPath: string,
): Promise<{ revision: string; content: string } | { error: string }> {
  const dir = designThinSnapshotDir(workspacePath, requestedPath);
  if (!dir) return { error: "此文件没有快照历史。" };
  const cursor = await readDesignThinCursor(dir);
  const nextUndone = cursor.undone + 1;
  const file = await snapshotFileAt(dir, nextUndone);
  if (!file) return { error: "已经回到最早的快照，无可撤销的修改。" };
  const revision = /^(\d+)-([0-9a-f]{16})\.html$/.exec(file)?.[2] ?? "";
  const content = await readDesignThinVersion(workspacePath, requestedPath, file);
  if (content === undefined) return { error: "快照不可读。" };
  await writeDesignThinCursor(dir, { undone: nextUndone });
  return { revision, content };
}

/** redo：重做一步（游标 -1，下限 0=最新）。 */
export async function redoDesignThinVersion(
  workspacePath: string,
  requestedPath: string,
): Promise<{ revision: string; content: string } | { error: string }> {
  const dir = designThinSnapshotDir(workspacePath, requestedPath);
  if (!dir) return { error: "此文件没有快照历史。" };
  const cursor = await readDesignThinCursor(dir);
  if (cursor.undone <= 0)
    return { error: "没有可重做的修改（已在最新状态）。" };
  const nextUndone = cursor.undone - 1;
  const file = await snapshotFileAt(dir, nextUndone);
  if (!file) return { error: "重做目标不存在。" };
  const revision = /^(\d+)-([0-9a-f]{16})\.html$/.exec(file)?.[2] ?? "";
  const content = await readDesignThinVersion(workspacePath, requestedPath, file);
  if (content === undefined) return { error: "快照不可读。" };
  await writeDesignThinCursor(dir, { undone: nextUndone });
  return { revision, content };
}

/** 写入工作区（undo/redo/restore 共用）：包含校验后落盘。 */
export async function writeWorkspaceFileChecked(
  workspacePath: string,
  requestedPath: string,
  content: string,
): Promise<void> {
  const abs = resolve(workspacePath, requestedPath);
  if (
    !abs.startsWith(resolve(workspacePath) + sep) ||
    abs === resolve(workspacePath)
  )
    throw new Error("路径越出工作区。");
  const { writeFile: fsWriteFile, mkdir: fsMkdir } = await import(
    "node:fs/promises"
  );
  await fsMkdir(abs.slice(0, abs.lastIndexOf(sep)), { recursive: true });
  await fsWriteFile(abs, content, "utf8");
}

async function writeFile(path: string, data: string, opts?: { flag: string }) {
  const { writeFile: fsWriteFile } = await import("node:fs/promises");
  await fsWriteFile(path, data, opts as never);
}

async function pruneDesignThinSnapshots(dir: string): Promise<void> {
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => /^\d+-[0-9a-f]{16}\.html$/.test(f))
    .sort();
  if (files.length <= MAX_PER_FILE) return;
  const { unlink } = await import("node:fs/promises");
  for (const file of files.slice(0, files.length - MAX_PER_FILE))
    await unlink(join(dir, file)).catch(() => undefined);
}

export interface DesignThinVersion {
  revision: string;
  path: string;
  bytes: number;
  occurredAt: string;
  sequence: number;
  file: string;
}

/** List snapshots for one workspace file, oldest → newest. */
export async function listDesignThinVersions(
  workspacePath: string,
  requestedPath: string,
): Promise<DesignThinVersion[]> {
  const dir = designThinSnapshotDir(workspacePath, requestedPath);
  if (!dir) return [];
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => /^\d+-[0-9a-f]{16}\.html$/.test(f))
    .sort(
      (a, b) =>
        Number(/^\d+/.exec(a)?.[0] ?? 0) - Number(/^\d+/.exec(b)?.[0] ?? 0),
    );
  const rel = relative(
    workspacePath,
    resolve(workspacePath, requestedPath),
  ).replaceAll("\\", "/");
  const { stat: fsStat } = await import("node:fs/promises");
  const out: DesignThinVersion[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    const full = join(dir, file);
    const size = await fsStat(full)
      .then((i) => i.size)
      .catch(() => 0);
    out.push({
      revision: /^\d+-([0-9a-f]{16})\.html$/.exec(file)?.[1] ?? "",
      path: rel,
      bytes: size,
      occurredAt: new Date(
        Number(/^\d+/.exec(file)?.[0] ?? 0) || 0,
      ).toISOString(),
      sequence: index + 1,
      file,
    });
  }
  return out;
}

/** Read one snapshot's content. */
export async function readDesignThinVersion(
  workspacePath: string,
  requestedPath: string,
  file: string,
): Promise<string | undefined> {
  const dir = designThinSnapshotDir(workspacePath, requestedPath);
  if (!dir || !/^\d+-[0-9a-f]{16}\.html$/.test(file)) return undefined;
  try {
    return (await readFile(join(dir, file))).toString("utf8");
  } catch {
    return undefined;
  }
}

/** Restore: copy a snapshot back to the workspace file. Returns the content
 * written; the workspace change pipeline then records a fresh snapshot. */
export async function restoreDesignThinVersion(
  workspacePath: string,
  requestedPath: string,
  file: string,
): Promise<string | undefined> {
  const content = await readDesignThinVersion(workspacePath, requestedPath, file);
  if (content === undefined) return undefined;
  const abs = resolve(workspacePath, requestedPath);
  if (!abs.startsWith(resolve(workspacePath) + sep)) return undefined;
  const { writeFile: fsWriteFile, mkdir: fsMkdir } = await import(
    "node:fs/promises"
  );
  await fsMkdir(abs.slice(0, abs.lastIndexOf(sep)), { recursive: true });
  await fsWriteFile(abs, content, "utf8");
  return content;
}

/** Trace id for tests/diagnostics. */
export const designThinSnapshotTraceId = (): string => randomUUID();
