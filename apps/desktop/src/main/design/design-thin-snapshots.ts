// Bounded workspace HTML history. File mutations and cursor updates serialize
// per path; snapshots use the exact bytes read before each replacement.
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readWorkspaceFileBytes } from "./design-plugin-project-files.js";

const MAX_PER_FILE = 50;
const MAX_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_NAME = /^(\d+)-([0-9a-f]{16})\.html$/;
const tails = new Map<string, Promise<unknown>>();
type Authorize = () => void | Promise<void>;

async function serialized<T>(
  workspace: string,
  path: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = resolve(await realpath(workspace), path);
  const previous = tails.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  tails.set(key, next);
  try {
    return await next;
  } finally {
    if (tails.get(key) === next) tails.delete(key);
  }
}

export const designThinSnapshotRoot = (workspace: string): string =>
  join(workspace, ".artemis", "versions");

export function designThinSnapshotDir(
  workspace: string,
  path: string,
): string | undefined {
  const rel = relative(resolve(workspace), resolve(workspace, path)).replaceAll(
    "\\",
    "/",
  );
  if (!rel || rel === ".." || rel.startsWith("../") || !/\.html?$/i.test(rel))
    return undefined;
  return join(
    designThinSnapshotRoot(workspace),
    createHash("sha256").update(rel).digest("hex").slice(0, 16),
  );
}

// Reject symlinks at every component, including the history store. Canonical
// workspace roots may themselves be aliases (e.g. /tmp on macOS).
export async function resolveDesignWorkspacePath(
  workspace: string,
  path: string,
): Promise<string> {
  if (!designThinSnapshotDir(workspace, path))
    throw new Error("Only workspace .html/.htm paths are supported.");
  return checkedPath(workspace, resolve(workspace, path));
}

async function checkedPath(
  workspace: string,
  candidate: string,
): Promise<string> {
  const root = await realpath(workspace);
  const fromAlias = relative(resolve(workspace), candidate);
  const rel =
    fromAlias === ".." || fromAlias.startsWith(".." + sep)
      ? relative(root, candidate)
      : fromAlias;
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("Path escapes the workspace.");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new Error("Symlinks are not allowed in design file paths.");
  }
  return current;
}

async function historyDir(workspace: string, path: string): Promise<string> {
  const dir = designThinSnapshotDir(workspace, path);
  if (!dir) throw new Error("Invalid design path.");
  return checkedPath(workspace, dir);
}

async function readCurrent(
  workspace: string,
  path: string,
): Promise<Buffer | undefined> {
  const abs = await resolveDesignWorkspacePath(workspace, path);
  const info = await lstat(abs).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info) return undefined;
  const read = await readWorkspaceFileBytes(
    await realpath(workspace),
    abs,
    MAX_BYTES,
  );
  if (!read) throw new Error("Design file is unreadable or exceeds 4 MiB.");
  return read.bytes;
}

async function snapshotFiles(dir: string): Promise<string[]> {
  return (
    await readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    })
  )
    .filter((file) => SNAPSHOT_NAME.test(file))
    .sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
}

const digest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 16);

async function saveSnapshot(
  workspace: string,
  path: string,
  bytes: Buffer,
  authorize?: Authorize,
) {
  const dir = await historyDir(workspace, path);
  const files = await snapshotFiles(dir);
  const revision = digest(bytes);
  if (SNAPSHOT_NAME.exec(files.at(-1) ?? "")?.[2] === revision)
    return { revision, occurredAt: new Date().toISOString() };
  await authorize?.();
  await mkdir(dir, { recursive: true });
  await historyDir(workspace, path);
  await authorize?.();
  const stamp = Math.max(
    Date.now(),
    Number(files.at(-1)?.split("-")[0] ?? 0) + 1,
  );
  const file = join(dir, `${stamp}-${revision}.html`);
  const handle = await open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  for (const old of files.slice(
    0,
    Math.max(0, files.length + 1 - MAX_PER_FILE),
  ))
    await unlink(join(dir, old));
  await writeCursor(workspace, path, 0, authorize);
  return { revision, occurredAt: new Date(stamp).toISOString() };
}

export async function recordDesignThinSnapshot(
  workspace: string,
  path: string,
  _opts: { source?: string; operationId?: string } = {},
) {
  if (!designThinSnapshotDir(workspace, path)) return undefined;
  return serialized(workspace, path, async () => {
    const bytes = await readCurrent(workspace, path);
    return bytes === undefined
      ? undefined
      : saveSnapshot(workspace, path, bytes);
  });
}

async function readCursor(workspace: string, path: string): Promise<number> {
  const dir = await historyDir(workspace, path);
  const read = await readWorkspaceFileBytes(
    await realpath(workspace),
    join(dir, "cursor.json"),
    1024,
  );
  if (!read) return 0;
  const undone: unknown = JSON.parse(read.bytes.toString("utf8")).undone;
  if (!Number.isSafeInteger(undone) || (undone as number) < 0)
    throw new Error("Invalid history cursor.");
  return undone as number;
}

async function writeCursor(
  workspace: string,
  path: string,
  undone: number,
  authorize?: Authorize,
): Promise<void> {
  const dir = await historyDir(workspace, path);
  await atomicReplace(
    workspace,
    join(dir, "cursor.json"),
    Buffer.from(JSON.stringify({ undone }) + "\n"),
    authorize,
  );
}

async function atomicReplace(
  workspace: string,
  candidate: string,
  bytes: Buffer,
  authorize?: Authorize,
): Promise<void> {
  let abs = await checkedPath(workspace, candidate);
  await authorize?.();
  await mkdir(dirname(abs), { recursive: true });
  abs = await checkedPath(workspace, candidate);
  const temporary = join(dirname(abs), `.artemis-${randomUUID()}.tmp`);
  const handle = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.close();
    await checkedPath(workspace, candidate);
    await authorize?.();
    await rename(temporary, abs);
  } finally {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export async function writeWorkspaceFileChecked(
  workspace: string,
  path: string,
  content: string,
  authorize?: Authorize,
): Promise<void> {
  await resolveDesignWorkspacePath(workspace, path);
  if (Buffer.byteLength(content) > MAX_BYTES)
    throw new Error("Design page exceeds 4 MiB.");
  await atomicReplace(
    workspace,
    resolve(workspace, path),
    Buffer.from(content),
    authorize,
  );
}

export async function writeDesignWorkspacePage(
  workspace: string,
  path: string,
  content: string,
  find?: string,
  authorize?: Authorize,
) {
  return serialized(workspace, path, async () => {
    await authorize?.();
    const before = await readCurrent(workspace, path);
    let result = content;
    if (find !== undefined) {
      if (!find)
        throw new Error("apply_edit requires a non-empty find string.");
      if (before === undefined)
        throw new Error("apply_edit requires an existing page.");
      const current = before.toString("utf8");
      const at = current.indexOf(find);
      if (at < 0 || current.indexOf(find, at + 1) >= 0)
        throw new Error(
          "find must match exactly once; use the smallest unique snippet.",
        );
      result = current.slice(0, at) + content + current.slice(at + find.length);
    }
    if (Buffer.byteLength(result) > MAX_BYTES)
      throw new Error("Design page exceeds 4 MiB.");
    if (before !== undefined)
      await saveSnapshot(workspace, path, before, authorize);
    const fresh = await readCurrent(workspace, path);
    if (before === undefined ? fresh !== undefined : !fresh?.equals(before))
      throw new Error("Page changed during editing; read it again.");
    await writeWorkspaceFileChecked(workspace, path, result, authorize);
    const saved = await saveSnapshot(
      workspace,
      path,
      Buffer.from(result),
      authorize,
    );
    await writeCursor(workspace, path, 0, authorize);
    return {
      path: relative(resolve(workspace), resolve(workspace, path)).replaceAll(
        "\\",
        "/",
      ),
      bytes: Buffer.byteLength(result),
      revision: saved.revision,
    };
  });
}

async function navigate(
  workspace: string,
  path: string,
  step: 1 | -1,
  authorize?: Authorize,
) {
  return serialized(workspace, path, async () => {
    await authorize?.();
    const before = await readCurrent(workspace, path);
    if (before === undefined) return { error: "Page does not exist." };
    let files = await snapshotFiles(await historyDir(workspace, path));
    let undone = await readCursor(workspace, path);
    const active = files[files.length - 1 - undone];
    if (SNAPSHOT_NAME.exec(active ?? "")?.[2] !== digest(before)) {
      await saveSnapshot(workspace, path, before, authorize);
      files = await snapshotFiles(await historyDir(workspace, path));
      undone = 0;
    }
    const next = undone + step;
    const file = next >= 0 ? files[files.length - 1 - next] : undefined;
    if (!file)
      return { error: step === 1 ? "Nothing to undo." : "Nothing to redo." };
    const content = await readDesignThinVersion(workspace, path, file);
    if (content === undefined) return { error: "Snapshot is unreadable." };
    const fresh = await readCurrent(workspace, path);
    if (!fresh?.equals(before))
      throw new Error("Page changed during history navigation.");
    await writeWorkspaceFileChecked(workspace, path, content, authorize);
    await writeCursor(workspace, path, next, authorize);
    return { revision: SNAPSHOT_NAME.exec(file)![2]!, content };
  });
}

export const undoDesignThinVersion = (
  workspace: string,
  path: string,
  authorize?: Authorize,
) => navigate(workspace, path, 1, authorize);
export const redoDesignThinVersion = (
  workspace: string,
  path: string,
  authorize?: Authorize,
) => navigate(workspace, path, -1, authorize);

export interface DesignThinVersion {
  revision: string;
  path: string;
  bytes: number;
  occurredAt: string;
  sequence: number;
  file: string;
  current: boolean;
}

export async function listDesignThinVersions(
  workspace: string,
  path: string,
): Promise<DesignThinVersion[]> {
  await resolveDesignWorkspacePath(workspace, path);
  const dir = await historyDir(workspace, path);
  const files = await snapshotFiles(dir);
  const out: DesignThinVersion[] = [];
  const live = await readCurrent(workspace, path);
  const cursor = await readCursor(workspace, path);
  const activeIndex = files.length - 1 - cursor;
  for (const [index, file] of files.entries()) {
    const read = await readWorkspaceFileBytes(
      await realpath(workspace),
      join(dir, file),
      MAX_BYTES,
    );
    if (!read || digest(read.bytes) !== SNAPSHOT_NAME.exec(file)![2]) continue;
    out.push({
      revision: SNAPSHOT_NAME.exec(file)![2]!,
      path: relative(workspace, resolve(workspace, path)).replaceAll("\\", "/"),
      bytes: read.size,
      occurredAt: new Date(Number(file.split("-")[0])).toISOString(),
      sequence: index + 1,
      file,
      current:
        index === activeIndex &&
        live !== undefined &&
        digest(live) === SNAPSHOT_NAME.exec(file)![2],
    });
  }
  return out;
}

export async function readDesignThinVersion(
  workspace: string,
  path: string,
  file: string,
): Promise<string | undefined> {
  if (!SNAPSHOT_NAME.test(file)) return undefined;
  await resolveDesignWorkspacePath(workspace, path);
  const dir = await historyDir(workspace, path);
  const read = await readWorkspaceFileBytes(
    await realpath(workspace),
    join(dir, file),
    MAX_BYTES,
  );
  if (!read || digest(read.bytes) !== SNAPSHOT_NAME.exec(file)![2])
    return undefined;
  return read.bytes.toString("utf8");
}

export async function restoreDesignThinVersion(
  workspace: string,
  path: string,
  file: string,
  authorize?: Authorize,
): Promise<string | undefined> {
  return serialized(workspace, path, async () => {
    await authorize?.();
    const content = await readDesignThinVersion(workspace, path, file);
    if (content === undefined) return undefined;
    const before = await readCurrent(workspace, path);
    if (before !== undefined)
      await saveSnapshot(workspace, path, before, authorize);
    const fresh = await readCurrent(workspace, path);
    if (before === undefined ? fresh !== undefined : !fresh?.equals(before))
      throw new Error("Page changed during restoration.");
    await writeWorkspaceFileChecked(workspace, path, content, authorize);
    await saveSnapshot(workspace, path, Buffer.from(content), authorize);
    await writeCursor(workspace, path, 0, authorize);
    return content;
  });
}
