// S0 design-plugin runtime worker host (proposal §9 slice).
//
// Spawns a plugin's runtime entry as a child process over the stdio frame
// protocol, performs the hello/ready handshake, dispatches tool invocations,
// and guarantees teardown of the whole process tree on dispose.
//
// S0 scope: single in-flight request per runtime, host-side timeout, no
// generation/revision negotiation yet (those land with S2 trust wiring).

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  FrameDecoder,
  RUNTIME_PROTOCOL_VERSION,
  encodeFrame,
  type ReadyMessage,
  type RuntimeToHostMessage,
  type ToolResultMessage,
} from "./design-plugin-runtime-protocol.js";

export interface RuntimeSpawnOptions {
  /** Absolute path to the runtime entry (.mjs). */
  entry: string;
  pluginId: string;
  contentHash: string;
  /** Working directory for the runtime process (its private scratch). */
  cwd: string;
  /** Handshake deadline; default 10s. */
  readyTimeoutMs?: number;
  /** Per-invocation deadline; default 30s (proposal §9.4). */
  invokeTimeoutMs?: number;
}

interface PendingInvoke {
  resolve: (result: ToolResultMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PluginRuntimeWorker {
  private child: ChildProcess | undefined;
  private decoder = new FrameDecoder();
  private ready: ReadyMessage | undefined;
  private readyWaiters: {
    resolve: (ready: ReadyMessage) => void;
    reject: (error: Error) => void;
  }[] = [];
  private pending = new Map<string, PendingInvoke>();
  private disposed = false;
  private stdoutClosed = false;

  constructor(private readonly options: RuntimeSpawnOptions) {}

  /** Spawn and complete the hello/ready handshake. No business calls before. */
  async start(): Promise<ReadyMessage> {
    if (this.disposed) throw new Error("Worker already disposed.");
    if (this.ready) return this.ready;
    this.child = spawn(process.execPath, [this.options.entry], {
      cwd: this.options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // Minimal environment: the runtime must not inherit host credentials.
      // ELECTRON_RUN_AS_NODE is required because process.execPath is the
      // Electron binary — without it each worker launches as a new app
      // instance (second Dock icon, full app lifecycle) instead of running
      // the runtime script as plain Node.
      env: { NODE_OPTIONS: "", ELECTRON_RUN_AS_NODE: "1" },
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
        this.failAll(new Error("Runtime stdout closed before completion."));
      }
    });
    this.child.on("exit", (code, signal) => {
      if (!this.disposed) {
        this.failAll(
          new Error(`Runtime exited early (code=${code} signal=${signal}).`),
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

    const timeoutMs = this.options.readyTimeoutMs ?? 10_000;
    const handshake = new Promise<ReadyMessage>((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
    const timeout = delay(timeoutMs).then(() => {
      throw new Error(
        `Runtime ${this.options.pluginId} did not complete the ready handshake in ${timeoutMs}ms.`,
      );
    });
    return Promise.race([handshake, timeout]);
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
        this.pending.delete(requestId);
        reject(new Error(`Runtime invoke "${toolName}" timed out.`));
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

  /** Kill the whole process and reject everything in flight. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Runtime disposed."));
    }
    this.pending.clear();
    // SIGKILL: the runtime has no shutdown work worth coordinating in S0,
    // and the host must reclaim the process tree deterministically.
    this.child?.kill("SIGKILL");
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  /** Host-side PID of the runtime child; undefined before start(). */
  childPid(): number | undefined {
    return this.child?.pid;
  }

  stdoutEnded(): boolean {
    return this.stdoutClosed;
  }

  private handleMessage(message: RuntimeToHostMessage) {
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
