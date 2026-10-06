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
  return { revision, occurredAt };
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
  return files.map((file, index) => ({
    revision: /^\d+-([0-9a-f]{16})\.html$/.exec(file)?.[1] ?? "",
    path: rel,
    bytes: 0,
    occurredAt: new Date(
      Number(/^\d+/.exec(file)?.[0] ?? 0) || 0,
    ).toISOString(),
    sequence: index + 1,
    file,
  }));
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
