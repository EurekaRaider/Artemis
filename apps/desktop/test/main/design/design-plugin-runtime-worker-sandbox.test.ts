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
// Review item 2 (P2): child creation is denied so helpers cannot detach
// from host ownership. Close, hot reload and crashes reap the worker.
//
// Runs on real macOS Seatbelt and Windows AppContainer; other platforms skip.
// Packaged Windows verification runs this suite with the installed Electron
// executable in Node mode and the final installed sandbox helper.

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

import { PluginRuntimeWorker } from "../../../src/main/design/design-plugin-runtime-worker.js";
import { ThreadRuntimeManager } from "../../../src/main/design/design-plugin-thread-runtime.js";

const darwin = process.platform === "darwin";
// Unsupported platforms skip explicitly.
const describeDarwin =
  darwin || process.platform === "win32" ? describe : describe.skip;

const desktopRoot = fileURLToPath(new URL("../../..", import.meta.url));
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

// Lifecycle probe: attempts normal/detached child creation and can crash itself.
const TREE_RUNTIME_SOURCE = `
import { spawn } from "node:child_process";

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

const tools = {
  async spawn_child(args) {
    const child = spawn(process.execPath, [
      "-e",
      "process.stdout.write('artemis-dp-treechild-alive'); setInterval(function () {}, 1000);",
    ], { detached: Boolean(args.detached), stdio: "ignore" });
    return await new Promise(resolve => {
      child.once("error", error => resolve({ status: "failed", error: String(error.code) }));
      child.once("spawn", () => resolve({ status: "succeeded", output: String(child.pid) }));
    });
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

const liveWorkers = new Set<PluginRuntimeWorker>();
function trackedWorker(
  options: ConstructorParameters<typeof PluginRuntimeWorker>[0],
) {
  const worker = new PluginRuntimeWorker({
    windowsHelperPath:
      process.env.ARTEMIS_DESIGN_TEST_HELPER ??
      join(desktopRoot, "resources", "windows-sandbox.ps1"),
    ...options,
  });
  liveWorkers.add(worker);
  return worker;
}

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
  for (const worker of liveWorkers) worker.dispose();
  await rm(root, { recursive: true, force: true });
  await rm(outsideDir, { recursive: true, force: true });
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
  return trackedWorker({
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
    const worker = trackedWorker({
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
    const worker = trackedWorker({
      entry: probeEntry,
      pluginId: "com.artemis.sandbox.probe",
      contentHash: "sandbox-suite",
      cwd: await freshScratch("refusal"),
      sandboxExecutable: "/nonexistent/sandbox-exec-dp-test",
      windowsHelperPath: "/nonexistent/windows-sandbox.ps1",
    });
    await expect(worker.start()).rejects.toThrow(/refusing|sandbox/i);
    // Refusal happened BEFORE any spawn: no child ever existed.
    expect(worker.childPid()).toBeUndefined();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Process lifecycle: design runtimes cannot fork helpers that detach from
// the host-owned process group. Their own process is reaped on every exit.
// ---------------------------------------------------------------------------

describeDarwin("design-plugin runtime process ownership (real spawn)", () => {
  it.each([false, true])(
    "refuses child creation (detached=%s) and remains usable",
    async (detached) => {
      const worker = trackedWorker({
        entry: treeEntry,
        pluginId: "com.artemis.sandbox.tree",
        contentHash: "tree-deny",
        cwd: await freshScratch("tree-deny"),
      });
      let escapedPid;
      try {
        await worker.start();
        const spawned = await worker.invoke("spawn_child", { detached });
        if (spawned.status === "succeeded") escapedPid = Number(spawned.output);
        expect(spawned.status).toBe("failed");
        expect(spawned.error).toMatch(/EPERM|EACCES/);
        expect(worker.isDisposed()).toBe(false);
      } finally {
        worker.dispose();
        if (escapedPid) {
          try {
            process.kill(escapedPid, "SIGKILL");
          } catch {}
        }
      }
    },
  );

  it("normal close kills the runtime and hot reload replaces it", async () => {
    const manager = new ThreadRuntimeManager({
      windowsHelperPath:
        process.env.ARTEMIS_DESIGN_TEST_HELPER ??
        join(desktopRoot, "resources", "windows-sandbox.ps1"),
      threadId: "t-sandbox-unload",
      scratchRoot: join(root, "mgr-scratch"),
      revisionsRoot: root,
      sandboxProbe: () => ({ ok: true, implementation: "macos-seatbelt" }),
    });
    const base = {
      entry: treeEntry,
      pluginId: "com.artemis.sandbox.tree",
      toolName: "spawn_child",
      args: {},
    };
    let newPid;
    try {
      await manager.invoke({ ...base, contentHash: "old" });
      const oldPid = manager.childPidOf(base.pluginId, "old");
      expect(alive(oldPid)).toBe(true);
      await manager.invoke({ ...base, contentHash: "new" });
      newPid = manager.childPidOf(base.pluginId, "new");
      expect(newPid).not.toBe(oldPid);
      expect(await until(5000, () => !alive(oldPid))).toBe(true);
      expect(alive(newPid)).toBe(true);
    } finally {
      manager.closeThread();
    }
    expect(await until(5000, () => !alive(newPid))).toBe(true);
  });

  it("abnormal exit disposes the worker and refuses stale reuse", async () => {
    const worker = trackedWorker({
      entry: treeEntry,
      pluginId: "com.artemis.sandbox.tree",
      contentHash: "tree-crash",
      cwd: await freshScratch("tree-crash"),
    });
    try {
      await worker.start();
      const pid = worker.childPid();
      await worker.invoke("crash", {}).catch(() => undefined);
      expect(await until(5000, () => !alive(pid))).toBe(true);
      expect(worker.isDisposed()).toBe(true);
      await expect(worker.invoke("spawn_child", {})).rejects.toThrow(
        /disposed|not ready/,
      );
    } finally {
      worker.dispose();
    }
  });
});
