import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  ComputerAction,
  ComputerFrame,
  ComputerOpen,
  ComputerTarget,
} from "@artemis/protocol";
import type { ComputerContext, ComputerDriver } from "./service.js";

export class ComputerNativeDriver implements ComputerDriver {
  private child: ChildProcess | undefined;
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      cleanup(): void;
    }
  >();
  constructor(
    private readonly path: string,
    private readonly takeover: (reason: string) => void,
    private readonly stopLabel: () => string = () => "Stop",
    private readonly darkAppearance?: () => boolean,
    private readonly diagnostics?: (event: Record<string, unknown>) => void,
  ) {}
  private start() {
    if (this.child) return this.child;
    if (process.platform !== "darwin")
      throw new Error("Desktop Computer Use currently requires macOS.");
    const child = spawn(this.path, [], {
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        ...(this.diagnostics ? { ARTEMIS_COMPUTER_DIAGNOSTICS: "1" } : {}),
      },
    });
    this.child = child;
    const lines = createInterface({ input: child.stdio[4] as Readable });
    lines.on("line", (line) => {
      if (this.child !== child) return;
      if (line.length > 2 * 1024 * 1024) {
        this.dispose();
        return;
      }
      try {
        const message = JSON.parse(line);
        if (message.event === "input-diagnostic") {
          this.diagnostics?.(message);
          return;
        }
        if (message.event === "takeover") {
          this.takeover(
            typeof message.reason === "string"
              ? message.reason.slice(0, 300)
              : "Native control was stopped",
          );
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        pending.cleanup();
        if (typeof message.error === "string")
          pending.reject(new Error(message.error));
        else pending.resolve(message.result);
      } catch {
        this.dispose();
      }
    });
    const failed = () => {
      if (this.child !== child) return;
      this.child = undefined;
      lines.close();
      child.kill("SIGKILL");
      for (const pending of this.pending.values()) {
        pending.cleanup();
        pending.reject(
          new Error(
            "Computer Use helper stopped. Reopen the target; check the signed app and macOS permissions.",
          ),
        );
      }
      this.pending.clear();
      this.takeover("Native helper exited unexpectedly");
    };
    child.once("error", failed);
    child.once("exit", failed);
    (child.stdio[3] as Writable).on("error", failed);
    (child.stdio[4] as Readable).on("error", failed);
    return child;
  }
  request<T>(
    method: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const child = this.start();
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const abort = () => this.dispose();
      const timer = setTimeout(() => {
        const reason = `Native helper ${method} request timed out after 20 seconds`;
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
      (child.stdio[3] as Writable).write(
        `${JSON.stringify({ id, method, args })}\n`,
      );
    });
  }
  async permissions(request = false, signal?: AbortSignal) {
    return this.request<{ accessibility: boolean; screenRecording: boolean }>(
      request ? "permissions" : "status",
      {},
      signal,
    );
  }
  async targets(_context: ComputerContext) {
    return this.request<ComputerTarget[]>("targets", {});
  }
  async open(
    input: ComputerOpen,
    _context: ComputerContext,
    signal: AbortSignal,
  ) {
    return this.request<ComputerTarget>("open", input, signal);
  }
  async observe(target: ComputerTarget, image: boolean, signal: AbortSignal) {
    return this.request<ComputerFrame>(
      "observe",
      {
        id: target.id,
        image,
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
  dispose(error = new Error("Computer Use cancelled.")) {
    const child = this.child;
    this.child = undefined;
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
    child?.kill("SIGKILL");
  }
}
