// S0 design-plugin runtime worker host (proposal §9 slice).
//
// Spawns a plugin's runtime entry as a child process over the stdio frame
// protocol, performs the hello/ready handshake, dispatches tool invocations,
// and guarantees teardown of the whole process tree on dispose.
//
// Process isolation (PR #245 review items):
//   - The runtime launches through the packaged native OS sandbox: Seatbelt
//     (sandbox-exec) on macOS via @artemis/platform's buildSeatbeltLaunch,
//     the same helper/profile family the MCP stdio servers use. Writes are
//     confined to the task-private scratch directory; reads cover the
//     scratch, the plugin runtime directory that ships the entry, and the
//     interpreter's own install roots; network and child-process creation
//     are denied. The bundled design runtime only needs in-process tools.
//   - Sandbox failure REFUSES the launch. There is no unsandboxed fallback
//     path on any platform: platforms without a wired sandbox throw, and a
//     missing/unusable sandbox-exec wrapper throws before any spawn.
//   - The child is spawned as its own process-group leader (detached) and
//     dispose() SIGKILLs that group. Forking is denied because descendants
//     could otherwise detach into a new group and evade teardown.
//
// S0 scope: single in-flight request per runtime, host-side timeout, no
// generation/revision negotiation yet (those land with S2 trust wiring).

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildSeatbeltLaunch,
  buildWindowsAppContainerLaunch,
  type SandboxLaunch,
} from "@artemis/platform";

import {
  FrameDecoder,
  RUNTIME_PROTOCOL_VERSION,
  encodeFrame,
  type ReadyMessage,
  type RuntimeToHostMessage,
  type ToolResultMessage,
} from "./design-plugin-runtime-protocol.js";
import { macosAppRuntimeReadOnlyPaths } from "../platform/macos-app-runtime.js";

const SEATBELT_EXECUTABLE = "/usr/bin/sandbox-exec";

export interface RuntimeSpawnOptions {
  /** Absolute path to the runtime entry (.mjs). */
  entry: string;
  windowsHelperPath?: string | undefined;
  pluginId: string;
  contentHash: string;
  /** Working directory for the runtime process (its private scratch). */
  cwd: string;
  /** Handshake deadline; default 10s. */
  readyTimeoutMs?: number;
  /** Per-invocation deadline; default 30s (proposal §9.4). */
  invokeTimeoutMs?: number;
  /**
   * Diagnostics/tests only: alternative sandbox-exec wrapper path, used to
   * exercise the refusal path when the wrapper is missing. The wrapper must
   * still enforce the generated Seatbelt profile — there is deliberately
   * no option to disable sandboxing.
   */
  sandboxExecutable?: string;
}

interface PendingInvoke {
  resolve: (result: ToolResultMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Install-prefix root for an interpreter path, following the MCP stdio
 * sandbox derivation (mcp-client-manager.ts). Homebrew builds keep the
 * binary's dylibs (libnode, icu4c, openssl, …) across the whole prefix, so
 * a bare binary directory is not enough; version managers get their
 * versioned root. Keep both call sites in sync.
 */
function posixRuntimeReadRoot(path: string): string {
  if (path === "/opt/homebrew" || path.startsWith("/opt/homebrew/")) {
    return "/opt/homebrew";
  }
  if (path === "/usr/local" || path.startsWith("/usr/local/")) {
    return "/usr/local";
  }
  for (const managed of [
    join(homedir(), ".volta"),
    join(homedir(), ".local"),
  ]) {
    if (path === managed || path.startsWith(`${managed}/`)) return managed;
  }
  const nvmVersion = path.match(/^(.+?\/\.nvm\/versions\/[^/]+\/[^/]+)/u);
  return nvmVersion?.[1] ?? path;
}

/**
 * Read-only roots the sandboxed runtime needs to boot: the interpreter
 * (Node under vitest, the Electron binary in the packaged app — plus its
 * bundle frameworks) and the plugin runtime directory that ships the entry.
 * The entry's directory stays READ-ONLY: a writable code directory would
 * let a runtime rewrite trusted, content-hashed code.
 */
function darwinRuntimeReadRoots(entry: string): string[] {
  const roots = new Set<string>();
  for (const candidate of [process.execPath, entry]) {
    for (const path of [candidate, realpathOrSelf(candidate)]) {
      roots.add(posixRuntimeReadRoot(dirname(path)));
    }
  }
  for (const appPath of macosAppRuntimeReadOnlyPaths(
    "darwin",
    process.execPath,
  )) {
    roots.add(posixRuntimeReadRoot(appPath));
  }
  return [...roots];
}

export class PluginRuntimeWorker {
  private child: ChildProcess | undefined;
  private decoder = new FrameDecoder();
  private ready: ReadyMessage | undefined;
  private starting: Promise<ReadyMessage> | undefined;
  private readyWaiters: {
    resolve: (ready: ReadyMessage) => void;
    reject: (error: Error) => void;
  }[] = [];
  private pending = new Map<string, PendingInvoke>();
  private disposed = false;
  private stdoutClosed = false;
  /** Tail of the runtime's stderr; surfaces sandbox/profile failures. */
  private stderrTail = "";
  /**
   * Exactly-once guard for the process-group SIGKILL. Firing at the
   * earliest of dispose() and the child's exit bounds the pid-reuse window:
   * after the group is empty, a later kill(-pid) could only hit a recycled
   * process-group id.
   */
  private groupKillIssued = false;

  constructor(private readonly options: RuntimeSpawnOptions) {}

  /** Spawn and complete the hello/ready handshake. No business calls before. */
  async start(): Promise<ReadyMessage> {
    if (this.disposed) throw new Error("Worker already disposed.");
    if (this.ready) return this.ready;
    this.starting ??= this.spawnAndHandshake().catch((error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.failAll(failure);
      throw failure;
    });
    return this.starting;
  }

  private async spawnAndHandshake(): Promise<ReadyMessage> {
    // Throws (refuses) on unsupported platforms and when the sandbox
    // wrapper is unavailable — the runtime never spawns unsandboxed.
    const launch = this.buildSandboxedLaunch();
    this.child = spawn(launch.executable, launch.args, {
      cwd: launch.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // Minimal environment: the runtime must not inherit host credentials.
      // ELECTRON_RUN_AS_NODE is required because the interpreter is the
      // Electron binary in the packaged app — without it each worker
      // launches as a new app instance (second Dock icon, full app
      // lifecycle) instead of running the runtime script as plain Node.
      // TMPDIR pins any temp use into the writable task-private scratch.
      env: launch.env,
      // Own process group: sandbox-exec execs the runtime in place, so the
      // spawned pid stays the group leader and killProcessTree() can
      // reclaim the whole tree with kill(-pid) even when the runtime has
      // spawned helpers of its own.
      detached: process.platform !== "win32",
    });
    this.child.on("error", (error) => {
      this.failAll(
        new Error(`Runtime process failed to start: ${error.message}`),
      );
    });
    this.child.stdin?.on("error", (error) => this.failAll(error));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(
        -8_192,
      );
    });
    this.child.stdout?.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.decoder.push(chunk)) {
          this.handleMessage(message);
        }
      } catch (error) {
        this.failAll(error instanceof Error ? error : new Error(String(error)));
      }
    });
    this.child.stdout?.on("close", () => {
      this.stdoutClosed = true;
      if (!this.disposed) {
        this.failAll(
          new Error(
            `Runtime stdout closed before completion.${this.stderrTail ? ` Stderr: ${this.stderrTail}` : ""}`,
          ),
        );
      }
    });
    this.child.on("exit", (code, signal) => {
      // Crash path: the runtime died while its grandchildren may still be
      // running. Reap the rest of the process group immediately (ESRCH
      // just means the group is already empty).
      this.killProcessTree();
      if (!this.disposed) {
        this.failAll(
          new Error(
            `Runtime exited early (code=${code} signal=${signal})${
              this.stderrTail ? `; stderr: ${this.stderrTail}` : ""
            }.`,
          ),
        );
      }
    });

    this.child.stdin?.write(
      encodeFrame({
        type: "hello",
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        pluginId: this.options.pluginId,
        contentHash: this.options.contentHash,
      }),
    );

    const timeoutMs =
      this.options.readyTimeoutMs ??
      (process.platform === "win32" ? 60_000 : 10_000);
    const handshake = new Promise<ReadyMessage>((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
    const timeout = setTimeout(() => {
      this.failAll(
        new Error(
          `Runtime ${this.options.pluginId} did not complete the ready handshake in ${timeoutMs}ms.${this.stderrTail ? ` stderr: ${this.stderrTail}` : ""}`,
        ),
      );
    }, timeoutMs);
    try {
      return await handshake;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Build the sandboxed launch for this runtime.
   *
   * darwin: Seatbelt via the packaged @artemis/platform helper — the same
   * profile family the MCP stdio servers run under. Writable surface is
   * exactly the task-private scratch (cwd); the plugin runtime directory
   * and interpreter roots are read-only; network and process forks are denied.
   *
   * Every other platform refuses: Windows AppContainer infrastructure
   * exists in the repo but is not wired into the design-plugin chain yet
   * (it needs the packaged helper path from the Electron main process).
   * Refusing beats shipping an unsandboxed path.
   */
  private buildSandboxedLaunch(): SandboxLaunch {
    if (process.platform === "win32" && process.arch === "x64") {
      const helperPath = this.options.windowsHelperPath;
      if (!helperPath)
        throw new Error("Windows AppContainer helper is required.");
      accessSync(helperPath, constants.R_OK);
      const cwd = realpathSync(this.options.cwd);
      const entry = realpathSync(this.options.entry);
      const identity =
        "Artemis.Design." +
        createHash("sha256")
          .update(
            `${cwd}\0${this.options.pluginId}\0${this.options.contentHash}`,
          )
          .digest("hex")
          .slice(0, 32);
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      return buildWindowsAppContainerLaunch(
        {
          executable: process.execPath,
          // Resolve the trusted entry on the host. AppContainer need not
          // read metadata from every ancestor of an already canonical path.
          args: [
            // AppContainer denies Electron's NUL-device initialization; use
            // the inherited protocol pipes without changing sandbox policy.
            ...(process.versions.electron ? ["--no-stdio-init"] : []),
            "--preserve-symlinks",
            "--preserve-symlinks-main",
            "--entry-url",
            pathToFileURL(entry).href,
          ],
          cwd,
          env: {
            SystemRoot: systemRoot,
            WINDIR: systemRoot,
            ComSpec: join(systemRoot, "System32", "cmd.exe"),
            PATH: join(systemRoot, "System32"),
            USERPROFILE: cwd,
            APPDATA: cwd,
            LOCALAPPDATA: cwd,
            ARTEMIS_WINDOWS_SANDBOX_DIAGNOSTICS: "1",
            NODE_OPTIONS: "",
            ELECTRON_RUN_AS_NODE: "1",
            TEMP: cwd,
            TMP: cwd,
          },
        },
        {
          workspacePath: cwd,
          mode: "work",
          network: "deny",
          writablePaths: [cwd],
          readOnlyPaths: [dirname(entry), dirname(process.execPath)],
        },
        {
          helperPath,
          identity,
          runtimePath: cwd,
          hostAccessPath: cwd,
          hostTempPath: tmpdir(),
          denyChildProcesses: true,
        },
      );
    }
    if (process.platform !== "darwin" || process.arch !== "arm64") {
      throw new Error(
        `Design-plugin runtime requires the native OS sandbox; platform ${process.platform} has no wired sandbox implementation yet . Refusing to start unsandboxed.`,
      );
    }
    const sandboxExecutable =
      this.options.sandboxExecutable ?? SEATBELT_EXECUTABLE;
    try {
      accessSync(sandboxExecutable, constants.X_OK);
    } catch {
      throw new Error(
        `Seatbelt wrapper ${sandboxExecutable} is unavailable; refusing to start design-plugin runtime ${this.options.pluginId} without a sandbox.`,
      );
    }
    // Seatbelt subpath filters match the KERNEL-RESOLVED path, and macOS
    // hands out symlinked aliases (/var/folders -> /private/var/folders).
    // Canonicalize like the MCP stdio sandbox does, or the writable grant
    // silently never matches.
    const cwd = realpathOrSelf(this.options.cwd);
    const launch = buildSeatbeltLaunch(
      {
        executable: realpathOrSelf(process.execPath),
        args: [this.options.entry],
        cwd,
        env: {
          NODE_OPTIONS: "",
          ELECTRON_RUN_AS_NODE: "1",
          TMPDIR: cwd,
        },
      },
      {
        workspacePath: cwd,
        mode: "work",
        network: "deny",
        readOnlyPaths: darwinRuntimeReadRoots(this.options.entry),
      },
    );
    // Scope this restriction to design plugins; MCP servers keep their own
    // policy. A detached helper would escape kill(-pid), so this runtime
    // contract permits only the host-owned process and its in-process tools.
    launch.args[1] += "\n(deny process-fork)\n";
    // buildSeatbeltLaunch hardcodes the system wrapper; the override only
    // redirects to a different sandbox-exec-compatible wrapper for
    // diagnostics — the profile is always applied.
    launch.executable = sandboxExecutable;
    return launch;
  }

  /** Invoke a tool by name; resolves with the runtime's terminal result. */
  async invoke(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResultMessage> {
    if (!this.ready) throw new Error("Worker not ready; call start() first.");
    if (this.disposed) throw new Error("Worker disposed.");
    const requestId = randomUUID();
    const timeoutMs = this.options.invokeTimeoutMs ?? 30_000;
    const promise = new Promise<ToolResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failAll(new Error(`Runtime invoke "${toolName}" timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    this.child?.stdin?.write(
      encodeFrame({
        type: "tool.invoke",
        requestId,
        toolName,
        arguments: args,
      }),
    );
    return promise;
  }

  /** Kill the whole process tree and reject everything in flight. */
  dispose(): void {
    this.failAll(new Error("Runtime disposed."));
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Host-side PID of the runtime child; undefined before start(). The
   * sandbox wrapper and the runtime share it: sandbox-exec execs the
   * command in place, so this PID is also the process-group leader.
   */
  childPid(): number | undefined {
    return this.child?.pid;
  }

  stdoutEnded(): boolean {
    return this.stdoutClosed;
  }

  /**
   * Reclaim the entire process tree exactly once, at the earliest of
   * dispose() and the child's exit event.
   *
   * POSIX/macOS: the child was spawned detached, so it leads its own
   * process group and kill(-pid, SIGKILL) reaches every member, including
   * grandchildren the runtime spawned. The direct child itself is reaped by
   * libuv's waitpid (the exit event); orphaned grandchildren are re-parented
   * to launchd after the group kill. ESRCH means the group is already
   * empty. The groupKillIssued guard plus try/catch is the pid-reuse
   * protection: we never signal a stale pgid twice.
   *
   * Windows: taskkill /T walks the tree; /F matches the SIGKILL semantics.
   */
  private killProcessTree(): void {
    const child = this.child;
    if (this.groupKillIssued || !child || child.pid === undefined) return;
    const pid = child.pid;
    this.groupKillIssued = true;
    if (process.platform === "win32") {
      const killer = spawn(
        join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32",
          "taskkill.exe",
        ),
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.once("error", () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      });
      killer.once("exit", (code) => {
        if (code !== 0) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already gone.
          }
        }
      });
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      }
    }
  }

  private handleMessage(message: RuntimeToHostMessage) {
    if (this.disposed) return;
    if (message.type === "ready") {
      if (this.ready) return;
      this.ready = message;
      for (const waiter of this.readyWaiters.splice(0)) {
        waiter.resolve(message);
      }
      return;
    }
    if (message.type === "tool.result") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.requestId);
      pending.resolve(message);
      return;
    }
    // Protocol-level error frames abort everything: the stream is untrusted
    // after the runtime reports corruption.
    this.failAll(new Error(`Runtime error frame: ${message.message}`));
  }

  private failAll(error: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = undefined;
    this.killProcessTree();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.readyWaiters.splice(0)) {
      waiter.reject(error);
    }
  }
}
