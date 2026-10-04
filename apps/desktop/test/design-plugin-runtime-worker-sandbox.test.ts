// PR #245 review-item acceptance suite: real-spawn verification of the
// design-plugin runtime worker's sandbox and process-tree lifecycle.
//
// Review item 1 (P1) — the runtime must actually run inside the native OS
// sandbox. On darwin this suite spawns REAL Seatbelt-protected workers
// (sandbox-exec + packaged @artemis/platform profile; no mocks at the
// boundary) and asserts:
//   ① reading a synthesized file outside the task-private directory fails
//   ② writing outside the task-private directory fails
//   ③ connecting to a 127.0.0.1 listener is denied
//   ④ reads/writes inside the task-private directory keep working
//   ⑤ the real packaged plugin runtime (resources/s0-plugins) still works
//   ⑥ a missing sandbox-exec wrapper REFUSES startup — no unsandboxed
//      fallback, and no child process is created
//
// Review item 2 (P2) — closing the runtime must reclaim the whole process
// tree, not just the direct child (verified with real long-lived
// grandchildren spawned by the runtime itself):
//   ① normal task close (dispose) kills the runtime and its grandchild
//   ② plugin unload / hot reload retires the previous revision's tree
//   ③ abnormal worker exit still reaps leftover grandchildren, and a later
//     dispose() is a safe no-op
//
// Skip conditions: every case needs /usr/bin/sandbox-exec (macOS). On any
// other platform the describes skip — the worker refuses to spawn there by
// design, which is the behavior under review. The network case ③ needs
// nothing beyond a loopback listener (always available); if a host blocks
// loopback listeners the beforeAll setup fails loudly instead of silently
// passing.

import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PluginRuntimeWorker } from "../src/main/design-plugin-runtime-worker.js";
import { ThreadRuntimeManager } from "../src/main/design-plugin-thread-runtime.js";

const darwin = process.platform === "darwin";
// Skip (not fake-pass) the whole real-spawn suite off macOS.
const describeDarwin = darwin ? describe : describe.skip;

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const packagedNotesEntry = join(
  desktopRoot,
  "resources",
  "s0-plugins",
  "test-notes",
  "runtime",
  "index.mjs",
);

// ---------------------------------------------------------------------------
// Minimal protocol runtimes used as probe payloads. They speak the S0
// length-prefixed JSON frame protocol so the real worker handshake and
// invoke paths are exercised, then attempt the operation under test from
// INSIDE the sandbox.
// ---------------------------------------------------------------------------

// Probe runtime: generic fs/net probes reporting permission outcomes as
// tool results. No backslashes anywhere in this source on purpose.
const PROBE_RUNTIME_SOURCE = `
import { readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

const codeOf = (error) => String(error && error.code ? error.code : error);

const tools = {
  async fs_probe(args) {
    const path = String(args.path ?? "");
    try {
      if (args.mode === "write") {
        await writeFile(path, "sandbox-out-of-bounds-write");
        return { status: "succeeded", output: "written" };
      }
      const data = await readFile(path, "utf8");
      return { status: "succeeded", output: data.slice(0, 128) };
    } catch (error) {
      return { status: "failed", error: codeOf(error) };
    }
  },
  async net_probe(args) {
    const host = String(args.host ?? "127.0.0.1");
    const port = Number(args.port ?? 80);
    return await new Promise((resolve) => {
      const socket = connect(port, host);
      const done = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.once("error", (error) => done({ status: "failed", error: codeOf(error) }));
      socket.once("connect", () => done({ status: "succeeded", output: "connected" }));
    });
  },
};

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    if (buffer.length < 4) break;
    const length = buffer.readUInt32BE(0);
    if (buffer.length < 4 + length) break;
    const payload = buffer.subarray(4, 4 + length).toString("utf8");
    buffer = buffer.subarray(4 + length);
    const message = JSON.parse(payload);
    if (message.type === "hello") {
      send({ type: "ready", protocolVersion: message.protocolVersion, pluginId: message.pluginId });
    } else if (message.type === "tool.invoke") {
      Promise.resolve(tools[message.toolName](message.arguments)).then((result) => {
        send({ type: "tool.result", requestId: message.requestId, status: result.status, output: result.output, error: result.error });
      }, (error) => {
        send({ type: "tool.result", requestId: message.requestId, status: "failed", error: codeOf(error) });
      });
    }
  }
});
`;

// Tree runtime: spawns a REAL long-lived grandchild (marker string lets the
// suite's safety net reap stragglers) and can crash itself on demand.
const TREE_RUNTIME_SOURCE = `
import { spawn } from "node:child_process";

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

const tools = {
  async spawn_child() {
    const child = spawn(process.execPath, [
      "-e",
      "process.stdout.write('artemis-dp-treechild-alive'); setInterval(function () {}, 1000);",
    ]);
    return { status: "succeeded", output: String(child.pid) };
  },
  async crash() {
    // Let the tool.result frame flush, then die abnormally.
    setTimeout(() => process.exit(87), 50);
    return { status: "succeeded", output: "crashing" };
  },
};

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    if (buffer.length < 4) break;
    const length = buffer.readUInt32BE(0);
    if (buffer.length < 4 + length) break;
    const payload = buffer.subarray(4, 4 + length).toString("utf8");
    buffer = buffer.subarray(4 + length);
    const message = JSON.parse(payload);
    if (message.type === "hello") {
      send({ type: "ready", protocolVersion: message.protocolVersion, pluginId: message.pluginId });
    } else if (message.type === "tool.invoke") {
      Promise.resolve(tools[message.toolName](message.arguments)).then((result) => {
        send({ type: "tool.result", requestId: message.requestId, status: result.status, output: result.output, error: result.error });
      }, (error) => {
        send({ type: "tool.result", requestId: message.requestId, status: "failed", error: String(error) });
      });
    }
  }
});
`;

// ---------------------------------------------------------------------------
// Suite fixtures
// ---------------------------------------------------------------------------

let root: string;
let pluginDir: string; // plays the role of the plugin runtime directory
let outsideDir: string; // outside BOTH the task-private scratch and plugin dir
let outsideSecret: string;
let probeEntry: string;
let treeEntry: string;
let scratchCounter = 0;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "dp-worker-sandbox-"));
  pluginDir = join(root, "plugin");
  outsideDir = await mkdtemp(join(tmpdir(), "dp-worker-outside-"));
  await mkdir(pluginDir, { recursive: true });
  probeEntry = join(pluginDir, "dp-sandbox-probe-runtime.mjs");
  treeEntry = join(pluginDir, "dp-sandbox-tree-runtime.mjs");
  await writeFile(probeEntry, PROBE_RUNTIME_SOURCE, "utf8");
  await writeFile(treeEntry, TREE_RUNTIME_SOURCE, "utf8");
  outsideSecret = join(outsideDir, "outside-secret.txt");
  await writeFile(outsideSecret, "TOPSECRET-token-245", "utf8");
  // Control: the outside file is readable from the (unsandboxed) host, so a
  // later denial can only come from the sandbox.
  expect(await readFile(outsideSecret, "utf8")).toContain("TOPSECRET");
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
});

// Safety net: nothing this suite spawned may outlive it.
process.on("exit", () => {
  if (!darwin) return;
  spawn("pkill", ["-f", "artemis-dp-treechild-alive"]);
  spawn("pkill", ["-f", "dp-sandbox-probe-runtime.mjs"]);
  spawn("pkill", ["-f", "dp-sandbox-tree-runtime.mjs"]);
});

function alive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(
  deadlineMs: number,
  predicate: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

/** Fresh task-private scratch per case, exactly like the thread manager. */
async function freshScratch(label: string): Promise<string> {
  scratchCounter += 1;
  const dir = join(root, `scratch-${label}-${scratchCounter}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function probeWorker(cwd: string): PluginRuntimeWorker {
  return new PluginRuntimeWorker({
    entry: probeEntry,
    pluginId: "com.artemis.sandbox.probe",
    contentHash: "sandbox-suite",
    cwd,
  });
}

// ---------------------------------------------------------------------------
// Review item 1 (P1): the runtime really is sandboxed.
// ---------------------------------------------------------------------------

describeDarwin("design-plugin runtime sandbox (real Seatbelt spawn)", () => {
  it("① denies reading a file outside the task-private directory", async () => {
    const worker = probeWorker(await freshScratch("outside-read"));
    try {
      await worker.start();
      const result = await worker.invoke("fs_probe", {
        path: outsideSecret,
        mode: "read",
      });
      expect(result.status).toBe("failed");
      expect(result.error ?? "").toMatch(
        /EPERM|EACCES|operation not permitted/i,
      );
    } finally {
      worker.dispose();
    }
  }, 30_000);

  it("② denies writing outside the task-private directory", async () => {
    const worker = probeWorker(await freshScratch("outside-write"));
    const escapePath = join(outsideDir, "escape.txt");
    try {
      await worker.start();
      const result = await worker.invoke("fs_probe", {
        path: escapePath,
        mode: "write",
      });
      expect(result.status).toBe("failed");
      expect(result.error ?? "").toMatch(
        /EPERM|EACCES|operation not permitted/i,
      );
      // Host-side proof: nothing leaked onto disk outside the scratch.
      await expect(stat(escapePath)).rejects.toThrow();
    } finally {
      worker.dispose();
    }
  }, 30_000);

  it("③ denies network access to a 127.0.0.1 listener", async () => {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const worker = probeWorker(await freshScratch("net"));
    try {
      await worker.start();
      const result = await worker.invoke("net_probe", {
        host: "127.0.0.1",
        port,
      });
      // The listener is up, so a "failed" here can only be the sandbox.
      expect(result.status).toBe("failed");
      expect(result.error ?? "").toMatch(
        /EPERM|EACCES|operation not permitted/i,
      );
    } finally {
      worker.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);

  it("④ allows reads and writes inside the task-private directory", async () => {
    const scratch = await freshScratch("inside");
    const worker = probeWorker(scratch);
    try {
      await worker.start();
      const written = await worker.invoke("fs_probe", {
        path: join(scratch, "inside.txt"),
        mode: "write",
      });
      expect(written.status).toBe("succeeded");
      const read = await worker.invoke("fs_probe", {
        path: join(scratch, "inside.txt"),
        mode: "read",
      });
      expect(read.status).toBe("succeeded");
      expect(read.output).toContain("sandbox-out-of-bounds-write");
      // Host sees the same artifact — real file, real sandbox allow rule.
      expect(await readFile(join(scratch, "inside.txt"), "utf8")).toContain(
        "sandbox-out-of-bounds-write",
      );
    } finally {
      worker.dispose();
    }
  }, 30_000);

  it("⑤ keeps the real packaged plugin runtime working under the sandbox", async () => {
    const scratch = await freshScratch("packaged");
    const worker = new PluginRuntimeWorker({
      entry: packagedNotesEntry,
      pluginId: "com.artemis.s0.test-notes",
      contentHash: "sandbox-suite-packaged",
      cwd: scratch,
    });
    try {
      const ready = await worker.start();
      expect(ready.type).toBe("ready");
      const appended = await worker.invoke("notes_append", {
        note: "沙箱内正常运行",
      });
      expect(appended.status).toBe("succeeded");
      expect(await readFile(join(scratch, "notes.jsonl"), "utf8")).toContain(
        "沙箱内正常运行",
      );
    } finally {
      worker.dispose();
    }
  }, 30_000);

  it("⑥ refuses to start when the seatbelt wrapper is missing (no fallback)", async () => {
    const worker = new PluginRuntimeWorker({
      entry: probeEntry,
      pluginId: "com.artemis.sandbox.probe",
      contentHash: "sandbox-suite",
      cwd: await freshScratch("refusal"),
      sandboxExecutable: "/nonexistent/sandbox-exec-dp-test",
    });
    await expect(worker.start()).rejects.toThrow(/refusing|sandbox/i);
    // Refusal happened BEFORE any spawn: no child ever existed.
    expect(worker.childPid()).toBeUndefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Review item 2 (P2): the whole tree dies, not just the direct child.
// ---------------------------------------------------------------------------

describeDarwin(
  "design-plugin runtime process-tree reclamation (real spawn)",
  () => {
    it("① normal task close: dispose kills the runtime and its grandchild", async () => {
      const worker = new PluginRuntimeWorker({
        entry: treeEntry,
        pluginId: "com.artemis.sandbox.tree",
        contentHash: "tree-normal",
        cwd: await freshScratch("tree-normal"),
      });
      await worker.start();
      const spawned = await worker.invoke("spawn_child", {});
      expect(spawned.status).toBe("succeeded");
      const grandchild = Number(spawned.output);
      const runtimePid = worker.childPid();
      expect(grandchild).toBeGreaterThan(0);
      expect(alive(grandchild)).toBe(true);
      expect(alive(runtimePid)).toBe(true);

      worker.dispose();
      expect(worker.isDisposed()).toBe(true);
      // The grandchild is NOT the worker's direct child — only a process-group
      // kill reaches it. Also verifies zombie reaping: alive() uses signal 0,
      // which still succeeds for unreaped zombies.
      expect(await until(5_000, () => !alive(runtimePid))).toBe(true);
      expect(await until(5_000, () => !alive(grandchild))).toBe(true);
    }, 30_000);

    it("② plugin unload (hot reload) retires the previous revision's tree", async () => {
      const manager = new ThreadRuntimeManager({
        threadId: "t-sandbox-unload",
        scratchRoot: join(root, "mgr-scratch"),
        revisionsRoot: join(root, "unused-revisions"),
      });
      try {
        const base = (contentHash: string) => ({
          entry: treeEntry,
          pluginId: "com.artemis.sandbox.tree",
          contentHash,
          toolName: "spawn_child",
          args: {},
        });
        const first = (await manager.invoke(base("hash-old"))) as {
          status: string;
          output?: string;
        };
        expect(first.status).toBe("succeeded");
        const oldPid = manager.childPidOf(
          "com.artemis.sandbox.tree",
          "hash-old",
        );
        const oldGrandchild = Number(first.output);
        expect(alive(oldPid)).toBe(true);
        expect(alive(oldGrandchild)).toBe(true);

        // Unload == hot reload to a new content hash: the old worker is
        // retired before its replacement serves anything.
        const second = (await manager.invoke(base("hash-new"))) as {
          status: string;
          output?: string;
        };
        expect(second.status).toBe("succeeded");
        const newPid = manager.childPidOf(
          "com.artemis.sandbox.tree",
          "hash-new",
        );
        expect(newPid).toBeTruthy();
        expect(newPid).not.toBe(oldPid);

        expect(
          await until(5_000, () => !alive(oldPid) && !alive(oldGrandchild)),
        ).toBe(true);
        expect(alive(newPid)).toBe(true);
      } finally {
        manager.closeThread();
      }
    }, 30_000);

    it("③ abnormal worker exit: leftover grandchildren are reaped and dispose stays safe", async () => {
      const worker = new PluginRuntimeWorker({
        entry: treeEntry,
        pluginId: "com.artemis.sandbox.tree",
        contentHash: "tree-crash",
        cwd: await freshScratch("tree-crash"),
      });
      await worker.start();
      const spawned = await worker.invoke("spawn_child", {});
      expect(spawned.status).toBe("succeeded");
      const grandchild = Number(spawned.output);
      const runtimePid = worker.childPid();
      expect(alive(grandchild)).toBe(true);

      // The crash tool replies and then exits(87). The invoke may resolve or
      // reject depending on frame flush timing; the cleanup guarantee is the
      // same either way.
      await worker.invoke("crash", {}).then(
        () => undefined,
        () => undefined,
      );
      expect(await until(5_000, () => !alive(runtimePid))).toBe(true);
      // Exit-path cleanup: the grandchild must die with the group even though
      // dispose() has not been called yet.
      expect(await until(5_000, () => !alive(grandchild))).toBe(true);
      // Post-crash dispose is a safe no-op (no stale-pid group kill, no throw).
      expect(() => worker.dispose()).not.toThrow();
      expect(worker.isDisposed()).toBe(true);
    }, 30_000);
  },
);
