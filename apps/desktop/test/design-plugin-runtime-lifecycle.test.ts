import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const workers = vi.hoisted(() => ({
  instances: [] as any[],
  starts: [] as (() => Promise<void>)[],
}));
vi.mock("../src/main/design-plugin-runtime-worker.js", () => ({
  PluginRuntimeWorker: class {
    disposed = false;
    rejectInvoke?: (error: Error) => void;
    constructor(readonly options: { contentHash: string }) {
      workers.instances.push(this);
    }
    async start() {
      await workers.starts.shift()?.();
    }
    childPid() {
      return 123;
    }
    isDisposed() {
      return this.disposed;
    }
    invoke(tool: string) {
      if (tool === "hang")
        return new Promise((_, reject) => {
          this.rejectInvoke = reject;
        });
      return Promise.resolve(this.options.contentHash);
    }
    dispose() {
      this.disposed = true;
      this.rejectInvoke?.(new Error("disposed"));
    }
  },
}));
import { ThreadRuntimeManager } from "../src/main/design-plugin-thread-runtime.js";

const roots: string[] = [];
const managers: ThreadRuntimeManager[] = [];
afterEach(async () => {
  managers.splice(0).forEach((manager) => manager.dispose());
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  workers.instances.length = 0;
  workers.starts.length = 0;
});
async function manager() {
  const root = await mkdtemp(join(tmpdir(), "design-lifecycle-"));
  roots.push(root);
  const value = new ThreadRuntimeManager({
    threadId: "thread",
    scratchRoot: root,
    revisionsRoot: root,
    sandboxProbe: () => ({ ok: true, implementation: "none-required" }),
  });
  managers.push(value);
  return value;
}
const input = {
  entry: "runtime.mjs",
  pluginId: "plugin",
  contentHash: "first",
  toolName: "read",
  args: {},
};
const bounded = <T>(promise: Promise<T>) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve("unsettled"), 100)),
  ]);

describe("runtime ownership across asynchronous lifecycle changes", () => {
  it("settles both the in-flight and queued requests on close", async () => {
    const host = await manager();
    const first = host
      .invoke({ ...input, toolName: "hang" })
      .catch(() => "rejected");
    await vi.waitFor(() =>
      expect(workers.instances[0]?.rejectInvoke).toBeTypeOf("function"),
    );
    const second = host.invoke(input).catch(() => "rejected");
    await vi.waitFor(() =>
      expect(host.pendingCount("plugin", "first")).toBe(1),
    );
    host.closeThread();
    expect(await bounded(Promise.all([first, second]))).toEqual([
      "rejected",
      "rejected",
    ]);
  });

  it("does not spawn when the thread closes while preparing its data root", async () => {
    const host = await manager();
    const result = host.invoke(input).catch(() => "rejected");
    host.closeThread();
    expect(await bounded(result)).toBe("rejected");
    expect(workers.instances.every((worker) => worker.disposed)).toBe(true);
  });

  it("disposes a failed startup and permits a fresh retry", async () => {
    const host = await manager();
    workers.starts.push(async () => {
      throw new Error("handshake failed");
    });
    await expect(host.invoke(input)).rejects.toThrow("handshake failed");
    expect(workers.instances[0].disposed).toBe(true);
    expect(await host.invoke(input)).toBe("first");
    expect(workers.instances).toHaveLength(2);
  });

  it("does not coalesce different revisions into the first startup", async () => {
    const host = await manager();
    let release!: () => void;
    workers.starts.push(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = host.invoke(input).catch(() => "rejected");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = host.invoke({ ...input, contentHash: "second" });
    release();
    await first;
    expect(await second).toBe("second");
    expect(workers.instances[0].disposed).toBe(true);
  });
});
