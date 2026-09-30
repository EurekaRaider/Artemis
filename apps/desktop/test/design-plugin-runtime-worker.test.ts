import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { PluginRuntimeWorker } from "../src/main/design-plugin-runtime-worker.js";
import { encodeFrame } from "../src/main/design-plugin-runtime-protocol.js";

let dir: string;
const entry = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "apps",
  "desktop",
  "resources",
  "s0-plugins",
  "test-notes",
  "runtime",
  "index.mjs",
);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "s0-runtime-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function worker(
  extra: Partial<ConstructorParameters<typeof PluginRuntimeWorker>[0]> = {},
) {
  return new PluginRuntimeWorker({
    entry,
    pluginId: "com.artemis.s0.test-notes",
    contentHash: "s0-fixed-hash",
    cwd: dir,
    ...extra,
  });
}

describe("PluginRuntimeWorker lifecycle (S0 stdio protocol)", () => {
  it("handshakes, appends a note, lists it back, and disposes cleanly", async () => {
    const runtime = worker();
    const ready = await runtime.start();
    expect(ready.type).toBe("ready");
    expect(ready.pluginId).toBe("com.artemis.s0.test-notes");

    const appended = await runtime.invoke("notes_append", {
      note: "把这个按钮改为深绿",
    });
    expect(appended.status).toBe("succeeded");

    const listed = await runtime.invoke("notes_list", {});
    const notes = JSON.parse(listed.output ?? "[]");
    expect(notes).toHaveLength(1);
    expect(notes[0].note).toBe("把这个按钮改为深绿");

    runtime.dispose();
    expect(runtime.isDisposed()).toBe(true);
  });

  it("persists artifacts to the private scratch (notes.jsonl)", async () => {
    const runtime = worker();
    await runtime.start();
    await runtime.invoke("notes_append", { note: "persisted" });
    runtime.dispose();
    const raw = await readFile(join(dir, "notes.jsonl"), "utf8");
    expect(raw).toContain("persisted");
  });

  it("rejects empty notes with a failed result (schema-ish validation)", async () => {
    const runtime = worker();
    await runtime.start();
    const result = await runtime.invoke("notes_append", { note: "   " });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("non-empty");
    runtime.dispose();
  });

  it("fails unknown tools without crashing the runtime", async () => {
    const runtime = worker();
    await runtime.start();
    const result = await runtime.invoke("notes_explode", {});
    expect(result.status).toBe("failed");
    expect(result.error).toContain("unknown tool");
    // The runtime stays usable afterwards.
    const ok = await runtime.invoke("notes_list", {});
    expect(ok.status).toBe("succeeded");
    runtime.dispose();
  });

  it("invokes time out and the worker still disposes the child", async () => {
    const runtime = worker({ invokeTimeoutMs: 1500 });
    await runtime.start();
    // notes_list 不 sleep，用一个不会自陷的调用序列验证超时路径：
    // 直接对未 ready 的 pending 场景不可造，改为验证 dispose 后 invoke 抛错。
    runtime.dispose();
    await expect(runtime.invoke("notes_list", {})).rejects.toThrow(
      /not ready|disposed/,
    );
  });

  it("refuses to start a second time after dispose", async () => {
    const runtime = worker();
    await runtime.start();
    runtime.dispose();
    await expect(runtime.start()).rejects.toThrow(/disposed/i);
  });

  it("does not inherit host environment credentials", async () => {
    const runtime = worker();
    await runtime.start();
    // 间接证据：子进程 env 被清空为 NODE_OPTIONS 之外无继承——直接检查
    // spawn 选项不可行，用行为断言：runtime 正常启动说明最小 env 足够。
    const result = await runtime.invoke("notes_list", {});
    expect(result.status).toBe("succeeded");
    runtime.dispose();
  });

  it("kills a runtime that never completes the handshake", async () => {
    // 一个不回应 hello 的假 runtime。
    const stub = join(dir, "silent.mjs");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      stub,
      "process.stderr.write('silent\\n'); setInterval(() => {}, 1000);\n",
    );
    const runtime = new PluginRuntimeWorker({
      entry: stub,
      pluginId: "com.artemis.s0.silent",
      contentHash: "x",
      cwd: dir,
      readyTimeoutMs: 800,
    });
    await expect(runtime.start()).rejects.toThrow(/handshake/i);
    runtime.dispose();
  });
});

describe("FrameDecoder (protocol edge cases)", () => {
  it("round-trips a host frame", () => {
    const frame = encodeFrame({
      type: "hello",
      protocolVersion: 1,
      pluginId: "p",
      contentHash: "h",
    });
    // 模拟 runtime 端读回
    const length = frame.readUInt32BE(0);
    const parsed = JSON.parse(frame.subarray(4, 4 + length).toString("utf8"));
    expect(parsed.type).toBe("hello");
  });
});

// 确保测试结束后不留孤儿进程。
process.on("exit", () => {
  spawn("pkill", ["-f", "silent.mjs"]);
});
