// S2 design-plugin runtime lifecycle (proposal §8).
//
// Binds PluginRuntimeWorker instances to thread lifecycles:
//   - lazy spawn on the thread's first plugin tool call,
//   - reuse one instance per (thread, plugin, contentHash),
//   - queue concurrent invocations (single in-flight stays in the worker;
//     the manager serializes callers above it),
//   - idle reaping and deterministic disposal on thread close/archive,
//   - refuse to spawn when the platform sandbox is unavailable — the
//     runtime never runs unsandboxed (S2 "sandbox failure refuses").
//
// macOS sandboxing reuses the packaged Seatbelt launcher from
// @artemis/platform with a policy whose writable surface is exactly the
// thread's private scratch directory.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { PluginRuntimeWorker } from "./design-plugin-runtime-worker.js";
import { ensureThreadDataRoot } from "./design-plugin-thread-data.js";

export type SandboxProbe =
  | { ok: true; implementation: "macos-seatbelt" | "none-required" }
  | { ok: false; reason: string };

export interface ThreadRuntimeOptions {
  threadId: string;
  /** Per-thread private scratch; the runtime's cwd and only writable path. */
  scratchRoot: string;
  /** Parent of all revision roots (plugin-revisions). */
  revisionsRoot: string;
  /** Force the sandbox probe result (tests / dev-instance evidence). */
  sandboxProbe?: () => SandboxProbe;
  /** Idle reaper delay; default 5 minutes (proposal §8). */
  idleReapMs?: number;
}

interface QueuedInvoke {
  toolName: string;
  args: Record<string, unknown>;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface LiveRuntime {
  worker: PluginRuntimeWorker;
  entry: string;
  pluginId: string;
  contentHash: string;
  scratch: string;
  childPid: number | undefined;
  queue: QueuedInvoke[];
  draining: boolean;
  idleTimer: NodeJS.Timeout | undefined;
  lastUsedAt: number;
}

/** Sandbox unavailable: spawn is refused before any child exists. */
export class SandboxUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(
      `Design-plugin runtime requires a sandbox but none is available: ${reason}`,
    );
    this.name = "SandboxUnavailableError";
  }
}

/**
 * Probe platform sandbox availability without side effects.
 * On macOS we require /usr/bin/sandbox-exec; the probe runs a trivial
 * sandboxed true(1) so a policy-level failure is caught here, not at the
 * first plugin spawn.
 */
export function probeMacOsSeatbelt(): SandboxProbe {
  const check = spawnSync("/usr/bin/sandbox-exec", [
    "-p",
    "(version 1)(allow default)",
    "/usr/bin/true",
  ]);
  if (check.error) {
    return { ok: false, reason: `sandbox-exec probe failed: ${String(check.error)}` };
  }
  if (check.status !== 0) {
    return {
      ok: false,
      reason: `sandbox-exec probe exited with status ${String(check.status)}`,
    };
  }
  return { ok: true, implementation: "macos-seatbelt" };
}

export class ThreadRuntimeManager {
  private readonly runtimes = new Map<string, LiveRuntime>();
  private readonly closedThreads = new Set<string>();
  private readonly options: ThreadRuntimeOptions;
  private readonly probe: () => SandboxProbe;

  constructor(options: ThreadRuntimeOptions) {
    this.options = options;
    this.probe = options.sandboxProbe ?? defaultProbe;
  }

  /**
   * S3 hot reload: the live-worker key is (thread, plugin) — NOT the
   * content hash. A dispatch with a different hash finds the existing
   * worker under the same key, kills it, and spawns the new revision in
   * one motion, so no stale code serves a rebound thread.
   */
  private key(pluginId: string): string {
    return `${this.options.threadId}\0${pluginId}`;
  }

  /**
   * Invoke a plugin tool on this thread's runtime. Spawns on first use,
   * queues concurrent callers, and reaps the worker after the idle window.
   */
  async invoke(input: {
    entry: string;
    pluginId: string;
    contentHash: string;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<unknown> {
    if (this.closedThreads.has(this.options.threadId)) {
      throw new Error(
        `Thread ${this.options.threadId} is closed; plugin runtime refuses new work.`,
      );
    }
    const live = await this.ensureRuntime(input);
    this.touch(live);
    return new Promise<unknown>((resolve, reject) => {
      live.queue.push({
        toolName: input.toolName,
        args: input.args,
        resolve,
        reject,
      });
      void this.drain(live);
    });
  }

  private async ensureRuntime(input: {
    entry: string;
    pluginId: string;
    contentHash: string;
  }): Promise<LiveRuntime> {
    const key = this.key(input.pluginId);
    // Coalesce concurrent spawns for the same plugin: the panel snapshot
    // push and a model turn can both dispatch on first open, and the
    // registry entry is set BEFORE start() completes — without this,
    // the second caller gets a live whose worker is not ready yet and
    // invoke() rejects with "Worker not ready".
    const pending = this.pendingEnsures.get(key);
    if (pending) return pending;
    const promise = this.doEnsureRuntime(input).finally(() => {
      this.pendingEnsures.delete(key);
    });
    this.pendingEnsures.set(key, promise);
    return promise;
  }

  private pendingEnsures = new Map<string, Promise<LiveRuntime>>();

  private async doEnsureRuntime(input: {
    entry: string;
    pluginId: string;
    contentHash: string;
  }): Promise<LiveRuntime> {
    const key = this.key(input.pluginId);
    const existing = this.runtimes.get(key);
    if (existing && !existing.worker.isDisposed()) {
      if (existing.contentHash === input.contentHash) return existing;
      // Hot reload: same plugin, new revision — retire the old worker
      // before its replacement exists (no overlap serving requests).
      this.disposeRuntime(existing);
    }

    const probeResult = this.probe();
    if (!probeResult.ok) {
      // Refuse BEFORE any spawn: no child process may exist when the
      // sandbox cannot be verified (S2 acceptance).
      throw new SandboxUnavailableError(probeResult.reason);
    }

    // Data root is hash-free: documents and the ledger bind to the thread,
    // so plugin revision upgrades (new content hash) keep the history.
    // The revision hash still gates code trust in the dispatch chain.
    const scratch = await ensureThreadDataRoot(
      this.options.scratchRoot,
      this.options.threadId,
    );
    await mkdir(scratch, { recursive: true });

    const worker = new PluginRuntimeWorker({
      entry: input.entry,
      pluginId: input.pluginId,
      contentHash: input.contentHash,
      cwd: scratch,
    });
    const live: LiveRuntime = {
      worker,
      entry: input.entry,
      pluginId: input.pluginId,
      contentHash: input.contentHash,
      scratch,
      childPid: undefined,
      queue: [],
      draining: false,
      idleTimer: undefined,
      lastUsedAt: Date.now(),
    };
    this.runtimes.set(key, live);
    await worker.start();
    live.childPid = worker.childPid();
    return live;
  }

  /** Serialized dispatch: one in-flight request per worker (§9.4). */
  private async drain(live: LiveRuntime): Promise<void> {
    if (live.draining) return;
    live.draining = true;
    try {
      while (live.queue.length > 0 && !live.worker.isDisposed()) {
        const next = live.queue.shift()!;
        try {
          const result = await live.worker.invoke(next.toolName, next.args);
          next.resolve(result);
        } catch (error) {
          next.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      live.draining = false;
      this.scheduleIdleReap(live);
    }
  }

  private touch(live: LiveRuntime): void {
    live.lastUsedAt = Date.now();
    if (live.idleTimer) {
      clearTimeout(live.idleTimer);
      live.idleTimer = undefined;
    }
  }

  private scheduleIdleReap(live: LiveRuntime): void {
    if (live.idleTimer) return;
    const delayMs = this.options.idleReapMs ?? 300_000;
    live.idleTimer = setTimeout(() => {
      live.idleTimer = undefined;
      if (live.queue.length === 0) {
        this.disposeRuntime(live);
      }
    }, delayMs);
    live.idleTimer.unref?.();
  }

  private disposeRuntime(live: LiveRuntime): void {
    const key = this.key(live.pluginId);
    this.runtimes.delete(key);
    if (live.idleTimer) clearTimeout(live.idleTimer);
    live.worker.dispose();
  }

  /** Thread closed or archived: kill every runtime tree and refuse reuse. */
  closeThread(): number {
    this.closedThreads.add(this.options.threadId);
    let count = 0;
    for (const live of [...this.runtimes.values()]) {
      this.disposeRuntime(live);
      count += 1;
    }
    return count;
  }

  /** Test/telemetry access: is a live worker present for this binding? */
  hasRuntime(pluginId: string, contentHash: string): boolean {
    const live = this.runtimes.get(this.key(pluginId));
    return !!live && !live.worker.isDisposed();
  }

  childPidOf(pluginId: string, contentHash: string): number | undefined {
    return this.runtimes.get(this.key(pluginId))?.childPid;
  }

  pendingCount(pluginId: string, contentHash: string): number {
    return (
      this.runtimes.get(this.key(pluginId))?.queue.length ?? 0
    );
  }

  dispose(): void {
    this.closeThread();
  }
}

function defaultProbe(): SandboxProbe {
  if (process.platform === "darwin") return probeMacOsSeatbelt();
  // Non-mac platforms have no verified sandbox path in S2: refuse rather
  // than run unsandboxed. Windows AppContainer lands with its own slice.
  return {
    ok: false,
    reason: `no verified sandbox implementation for platform ${process.platform}`,
  };
}

/** Test helper: spawn a sleep child so "no child on probe failure" has a
 *  comparable negative case with observable PIDs. */
export function spawnProbeChild(label: string): ChildProcess {
  return spawn("/usr/bin/true", [], { env: { PROBE_LABEL: label } });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
