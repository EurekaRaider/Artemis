import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import type {
  ComputerAction,
  ComputerFrame,
  ComputerNativeReadiness,
  ComputerOpen,
  ComputerTarget,
} from "@artemis/protocol";
import type { ComputerContext, ComputerDriver } from "./service.js";

export interface ComputerHelperLease {
  path: string;
  previewPath?: string;
  release(): void;
}
export class ComputerNativeDriver implements ComputerDriver {
  private child: ChildProcess | undefined;
  private starting: Promise<ChildProcess> | undefined;
  private lease: ComputerHelperLease | undefined;
  private generation = 0;
  private previewIdentitySupported = false;
  private readonly retiring = new Set<Promise<void>>();
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      cleanup(): void;
    }
  >();
  constructor(
    private readonly source: string | (() => Promise<ComputerHelperLease>),
    private readonly takeover: (reason: string) => void,
    private readonly stopLabel: () => string = () => "Stop",
    private readonly darkAppearance?: () => boolean,
    private readonly diagnostics?: (event: Record<string, unknown>) => void,
  ) {}
  private start(): Promise<ChildProcess> {
    if (this.starting) return this.starting;
    if (this.child) return Promise.resolve(this.child);
    const generation = this.generation;
    this.starting = (async () => {
      if (!["darwin", "win32"].includes(process.platform))
        throw new Error("Desktop Computer Use requires macOS or Windows 11.");
      const lease =
        typeof this.source === "string"
          ? { path: this.source, release() {} }
          : await this.source();
      if (generation !== this.generation) {
        lease.release();
        throw new Error("Computer Use cancelled.");
      }
      this.lease = lease;
      const child = spawn(lease.path, [], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        env: {
          ...(process.platform === "win32"
            ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
            : { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" }),
          ARTEMIS_COMPUTER_PARENT: process.execPath,
          ...(this.diagnostics ? { ARTEMIS_COMPUTER_DIAGNOSTICS: "1" } : {}),
        },
      });
      this.child = child;
      this.diagnostics?.({ event: "helper-start", pid: child.pid });
      let buffer = Buffer.alloc(0);
      const failed = (
        error = new Error(
          "Computer Use helper stopped. Reopen the target and check native permissions.",
        ),
      ) => {
        if (this.child !== child) return;
        this.dispose(error);
        this.takeover("Native helper exited unexpectedly");
      };
      (child.stdio[1] as Readable).on("data", (chunk: Buffer) => {
        if (this.child !== child) return;
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          const newline = buffer.indexOf(10);
          if (newline < 0) break;
          if (newline > 2 * 1024 * 1024) {
            failed();
            return;
          }
          const line = buffer.subarray(0, newline).toString("utf8");
          buffer = buffer.subarray(newline + 1);
          try {
            const message = JSON.parse(line);
            if (!message || typeof message !== "object")
              throw new Error("Invalid helper message");
            if (message.event === "input-diagnostic") {
              this.diagnostics?.(message);
              continue;
            }
            if (message.event === "takeover") {
              this.diagnostics?.(message);
              this.takeover(
                typeof message.reason === "string"
                  ? message.reason.slice(0, 300)
                  : "Native control was stopped",
              );
              continue;
            }
            const request = this.pending.get(message.id);
            if (!request) continue;
            this.pending.delete(message.id);
            request.cleanup();
            if (typeof message.error === "string")
              request.reject(new Error(message.error));
            else request.resolve(message.result);
          } catch {
            failed();
            return;
          }
        }
        if (buffer.length > 2 * 1024 * 1024) failed();
      });
      child.once("error", (error) => failed(error));
      child.once("exit", (code, signal) => {
        this.diagnostics?.({ event: "helper-exit", code, signal });
        failed();
      });
      (child.stdio[0] as Writable).on("error", (error) => failed(error));
      (child.stdio[1] as Readable).on("error", (error) => failed(error));
      const hello = await this.send<{
        helperProtocol: number;
        platform: string;
        previewIdentity?: number;
      }>(child, "hello", {});
      if (hello.helperProtocol !== 1 || hello.platform !== process.platform)
        throw new Error("Computer Use helper protocol or platform mismatch.");
      this.previewIdentitySupported = hello.previewIdentity === 1;
      return child;
    })()
      .catch((error) => {
        if (generation === this.generation)
          this.dispose(
            error instanceof Error ? error : new Error(String(error)),
          );
        throw error;
      })
      .finally(() => {
        if (generation === this.generation) this.starting = undefined;
      });
    return this.starting;
  }
  private send<T>(
    child: ChildProcess,
    method: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const abort = () => this.dispose();
      const timer = setTimeout(() => {
        const reason =
          "Native helper " + method + " request timed out after 20 seconds";
        this.dispose(new Error(reason));
        this.takeover(reason);
      }, 20000);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup,
      });
      signal?.addEventListener("abort", abort, { once: true });
      const encoded = JSON.stringify({ id, method, args }) + "\n";
      if (Buffer.byteLength(encoded) > 131072) {
        this.pending.delete(id);
        cleanup();
        reject(new Error("Native request is too large"));
        return;
      }
      (child.stdio[0] as Writable).write(encoded);
    });
  }
  async request<T>(
    method: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const abort = () => this.dispose();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await this.send<T>(await this.start(), method, args, signal);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  permissions(request = false, signal?: AbortSignal) {
    return this.request<ComputerNativeReadiness>(
      request ? "permissions" : "status",
      {},
      signal,
    );
  }
  targets(_context: ComputerContext) {
    return this.request<ComputerTarget[]>("targets", {});
  }
  open(input: ComputerOpen, _context: ComputerContext, signal: AbortSignal) {
    return this.request<ComputerTarget>("open", input, signal);
  }
  observe(
    target: ComputerTarget,
    image: boolean,
    signal: AbortSignal,
    allowForeground = false,
  ) {
    return this.request<ComputerFrame>(
      "observe",
      {
        id: target.id,
        image,
        allowForeground,
        stopLabel: this.stopLabel(),
        darkAppearance: this.darkAppearance?.(),
      },
      signal,
    );
  }
  async act(
    target: ComputerTarget,
    action: ComputerAction,
    signal: AbortSignal,
    allowForeground = false,
  ) {
    await this.request(
      "act",
      { id: target.id, action, allowForeground },
      signal,
    );
  }
  async release(target: ComputerTarget) {
    if (this.child) await this.request("release", { id: target.id });
  }
  async previewIdentity(target: ComputerTarget) {
    const child = await this.start();
    if (!this.previewIdentitySupported)
      throw new Error(
        "Update the Computer Use capability pack for live preview.",
      );
    // Preview cancellation is local to the stream; it must not abort the control helper.
    return this.send<import("./native-preview.js").NativeWindowIdentity>(
      child,
      "preview-identity",
      { id: target.id },
    );
  }
  async close(): Promise<void> {
    this.dispose();
    if (!this.retiring.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...this.retiring]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Computer Use helper did not close; runtime switch was deferred.",
                ),
              ),
            5000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  dispose(error = new Error("Computer Use cancelled.")) {
    this.generation++;
    const child = this.child;
    const lease = this.lease;
    this.child = undefined;
    this.lease = undefined;
    this.starting = undefined;
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
    if (child) {
      const closed = new Promise<void>((resolve) => {
        child.once("close", () => {
          lease?.release();
          resolve();
        });
      });
      this.retiring.add(closed);
      void closed.then(() => this.retiring.delete(closed));
      child.kill("SIGKILL");
    } else lease?.release();
  }
}
