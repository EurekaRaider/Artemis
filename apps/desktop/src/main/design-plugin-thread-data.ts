// Design-plugin thread data root: version history binds to the THREAD and
// its documents, never to the plugin revision's content hash. The revision
// hash gates CODE trust (manifest verification in the dispatch chain); data
// must survive plugin upgrades, so it lives in a hash-free directory.
//
// Layout (per thread):
//   <scratchRoot>/<threadId>/data/
//     design-documents.jsonl          — append-only artifact ledger
//     documents/<documentId>/         — v<N>-<revision>.html + HEAD marker
//
// Legacy dev builds (S2–S4) stored the same contents under
// <scratchRoot>/<threadId>/<contentHash>/. ensureThreadDataRoot() moves the
// newest legacy directory into data/ exactly once per process; older legacy
// directories are left untouched (dev-only artifacts, never produced by a
// build that ships this module).

import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR_NAME = "data";
const LEGACY_HASH_DIR = /^[0-9a-f]{64}$/;

/**
 * Design-plugin revision store root. Deliberately OUTSIDE userData/plugins:
 * v1.6.18 claims plugins/ for native plugins (and runs a one-shot legacy
 * rename into it that refuses any pre-existing destination), so sharing the
 * namespace with the native plugin service would break either side.
 */
export function designPluginRevisionsRoot(userDataRoot: string): string {
  return join(userDataRoot, "design-plugins", "revisions");
}

/**
 * One-shot relocation of the S1 revisions directory (userData/plugins/
 * plugin-revisions) into the design-plugin namespace. Must run BEFORE the
 * native plugin-format migration: the legacy parent directory plugins/ is
 * that migration's destination, and any leftover inside it blocks startup.
 */
export async function migrateLegacyDesignPluginRevisions(
  userDataRoot: string,
): Promise<void> {
  const pluginsRoot = join(userDataRoot, "plugins");
  const legacy = join(pluginsRoot, "plugin-revisions");
  const next = designPluginRevisionsRoot(userDataRoot);
  // An empty plugins/ shell (ours was moved out, or a partial run left one)
  // would still block the native migration's destination check; anything
  // non-empty is real native data and is left alone.
  const freeEmptyPluginsDir = async () => {
    const entries = await readdir(pluginsRoot).catch(() => null);
    if (entries && entries.length === 0)
      await rm(pluginsRoot, { recursive: true, force: true }).catch(() => {});
  };
  const legacyEntries = await readdir(legacy).catch(() => null);
  if (!legacyEntries) {
    await freeEmptyPluginsDir();
    return;
  }
  const nextExists = (await readdir(next).catch(() => null)) !== null;
  if (!nextExists) {
    await mkdir(join(next, ".."), { recursive: true });
    await rename(legacy, next);
  } else {
    // Both exist (should not happen): keep the live store, park the stale
    // copy aside so the legacy plugins/ parent can be freed either way.
    await rename(legacy, join(next, `..`, `revisions-legacy-${Date.now()}`));
  }
  await freeEmptyPluginsDir();
}

/** Hash-free, per-thread data root (the plugin runtime's cwd). */
export function threadDataRoot(scratchRoot: string, threadId: string): string {
  return join(scratchRoot, threadId, DATA_DIR_NAME);
}

// Coalesce concurrent callers (panel open + first dispatch race) so the
// migration decision is made against a stable filesystem state.
const inflight = new Map<string, Promise<string>>();

export async function ensureThreadDataRoot(
  scratchRoot: string,
  threadId: string,
): Promise<string> {
  const pending = inflight.get(threadId);
  if (pending) return pending;
  const promise = doEnsureThreadDataRoot(scratchRoot, threadId).finally(() => {
    inflight.delete(threadId);
  });
  inflight.set(threadId, promise);
  return promise;
}

async function doEnsureThreadDataRoot(
  scratchRoot: string,
  threadId: string,
): Promise<string> {
  const dataRoot = threadDataRoot(scratchRoot, threadId);
  const existing = await readdir(dataRoot).catch(() => null);
  if (existing && existing.length > 0) return dataRoot;

  const threadRoot = join(scratchRoot, threadId);
  const entries = await readdir(threadRoot).catch(() => []);
  const legacy: { dir: string; mtimeMs: number }[] = [];
  for (const entry of entries) {
    if (!LEGACY_HASH_DIR.test(entry)) continue;
    const dir = join(threadRoot, entry);
    const info = await stat(dir).catch(() => null);
    if (info?.isDirectory()) legacy.push({ dir, mtimeMs: info.mtimeMs });
  }
  if (legacy.length === 0) {
    await mkdir(dataRoot, { recursive: true });
    return dataRoot;
  }

  // Newest legacy directory holds the thread's latest state: each hash
  // change previously started a fresh store, so the newest one is current.
  legacy.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = legacy.at(0);
  if (!newest) {
    await mkdir(dataRoot, { recursive: true });
    return dataRoot;
  }
  const source = newest.dir;
  await mkdir(dataRoot, { recursive: true });
  for (const item of await readdir(source)) {
    // A conflicting target can only come from a concurrent writer that
    // started after our readdir; keep the fresh file, leave the legacy
    // copy in place rather than overwrite either.
    await rename(join(source, item), join(dataRoot, item)).catch(() => {});
  }
  const leftover = await readdir(source).catch(() => ["non-empty"]);
  if (leftover.length === 0) {
    await rm(source, { recursive: true, force: true }).catch(() => {});
  }
  return dataRoot;
}
