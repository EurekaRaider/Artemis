// im-bindings-store + im-service 集成测试（plan §6：假 host + 临时 SQLite）

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DummyAdapter, type InboundMessage } from "@artemis/im";

import { IMService, type IMServiceHost } from "../src/main/im-service.js";
import { AppStore } from "../src/main/store.js";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createStore(): Promise<AppStore> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-im-"));
  cleanup.push(directory);
  return new AppStore(join(directory, "state.sqlite"));
}

interface HostCall {
  kind: "submit" | "followUp" | "createThread" | "notifyPairing" | "resolveApproval";
  input: unknown;
}

function makeHost(opts?: { threadStatus?: string }): {
  host: IMServiceHost;
  calls: HostCall[];
} {
  const calls: HostCall[] = [];
  let threadSeq = 0;
  return {
    calls,
    host: {
      async submitTurn(input) {
        calls.push({ kind: "submit", input });
      },
      async followUp(input) {
        calls.push({ kind: "followUp", input });
      },
      async createThread(input) {
        calls.push({ kind: "createThread", input });
        return { threadId: `thread-im-${++threadSeq}` };
      },
      getThreadStatus(threadId) {
        if (threadId.startsWith("thread-im-")) return "idle";
        return (opts?.threadStatus as "running") ?? "idle";
      },
      notifyPairing(input) {
        calls.push({ kind: "notifyPairing", input });
      },
      resolveBrokerApproval(input) {
        calls.push({ kind: "resolveApproval", input });
      },
    },
  };
}

function setup(host: IMServiceHost, store: AppStore) {
  const service = new IMService({ store, host });
  const adapter = new DummyAdapter("feishu-main");
  service.registerAdapter(adapter);
  return { service, adapter };
}

function makeInbound(text: string, messageId?: string): InboundMessage {
  return {
    envelope: {
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      senderId: "ou_1",
      senderName: "张三",
      messageId: messageId ?? `om_${Math.random().toString(36).slice(2)}`,
      receivedAt: new Date().toISOString(),
    },
    text,
    attachments: [],
  };
}

async function pairChannel(service: IMService, store: AppStore) {
  // 配对：首消息 → 挑战 → 回码 → 桌面批准（经 manager.approvePairing）
  await service.manager.handleInbound(makeInbound("hi"));
  const challenge = service.manager.status().pairingChallenge;
  expect(challenge).not.toBeNull();
  await service.manager.handleInbound(makeInbound(challenge!.code));
  const binding = service.manager.approvePairing({
    workspaceKey: "ws1",
    threadId: "thread-existing-1",
    adapter: "feishu-main",
    platform: "feishu",
    channelId: "oc_a",
    outputMode: "summary",
  });
  expect(binding).not.toBeNull();
  // 绑定落库验证
  expect(store.getImBinding("feishu-main", "oc_a")).toMatchObject({
    threadId: "thread-existing-1",
    outputMode: "summary",
    muted: false,
  });
  return binding!;
}

describe("im-bindings-store（plan §1.3，内存 SQLite）", () => {
  it("upsert/get/list/update/delete 全链路", async () => {
    const store = await createStore();
    store.upsertImBinding({
      workspaceKey: "ws1",
      threadId: "t1",
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      outputMode: "summary",
      muted: false,
      boundAt: new Date().toISOString(),
    });
    expect(store.getImBinding("feishu-main", "oc_a")?.threadId).toBe("t1");
    expect(store.listImBindings()).toHaveLength(1);

    expect(
      store.updateImBinding("feishu-main", "oc_a", { outputMode: "verbose" }),
    ).toBe(true);
    expect(store.getImBinding("feishu-main", "oc_a")?.outputMode).toBe("verbose");

    // upsert 同 key 覆盖
    store.upsertImBinding({
      workspaceKey: "ws2",
      threadId: "t2",
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      outputMode: "quiet",
      muted: true,
      boundAt: new Date().toISOString(),
      lastInboundMessageId: "om_x",
    });
    const after = store.getImBinding("feishu-main", "oc_a");
    expect(after).toMatchObject({
      workspaceKey: "ws2",
      outputMode: "quiet",
      muted: true,
      lastInboundMessageId: "om_x",
    });
    expect(store.listImBindings()).toHaveLength(1);

    expect(store.deleteImBinding("feishu-main", "oc_a")).toBe(true);
    expect(store.deleteImBinding("feishu-main", "oc_a")).toBe(false);
  });

  it("重启恢复语义：新 AppStore 实例读同库文件绑定仍在", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-im-"));
    cleanup.push(directory);
    const dbPath = join(directory, "state.sqlite");
    const store1 = new AppStore(dbPath);
    store1.upsertImBinding({
      workspaceKey: "ws1",
      threadId: "t1",
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      outputMode: "summary",
      muted: false,
      boundAt: new Date().toISOString(),
    });
    store1.close();

    const store2 = new AppStore(dbPath);
    expect(store2.getImBinding("feishu-main", "oc_a")?.threadId).toBe("t1");
    store2.close();
  });
});

describe("IMService 入站链路（plan §1.4/§3.1）", () => {
  it("配对流程：首消息触发 notifyPairing（含 4 位码）", async () => {
    const store = await createStore();
    const { host, calls } = makeHost();
    const { service } = setup(host, store);
    await service.manager.handleInbound(makeInbound("hi"));
    const notify = calls.find((c) => c.kind === "notifyPairing");
    expect(notify).toBeDefined();
    expect((notify!.input as { code: string }).code).toMatch(/^\d{4}$/);
  });

  it("已绑定 + 线程空闲 → submitTurn（E1 形状）", async () => {
    const store = await createStore();
    const { host, calls } = makeHost();
    const { service } = setup(host, store);
    await pairChannel(service, store);

    await service.manager.handleInbound(makeInbound("列出当前目录"));
    const submit = calls.find((c) => c.kind === "submit");
    expect(submit).toBeDefined();
    expect(submit!.input).toMatchObject({
      threadId: "thread-existing-1",
      text: "列出当前目录",
    });
  });

  it("已绑定 + 线程 running → followUp（queueTurn 路径）", async () => {
    const store = await createStore();
    const { host, calls } = makeHost({ threadStatus: "running" });
    const { service } = setup(host, store);
    await pairChannel(service, store);

    await service.manager.handleInbound(makeInbound("再跑一遍"));
    expect(calls.some((c) => c.kind === "followUp")).toBe(true);
    expect(calls.some((c) => c.kind === "submit")).toBe(false);
  });

  it("已绑定 + 线程不存在 → 重建 [FS] 线程后 submit", async () => {
    const store = await createStore();
    const { host, calls } = makeHost();
    const { service } = setup(host, store);
    await pairChannel(service, store);
    store.updateImBinding("feishu-main", "oc_a", { threadId: "thread-gone" });
    const host2 = makeHost();
    // 让 host 对 thread-gone 返回 not-found
    const origGet = host2.host.getThreadStatus;
    host2.host.getThreadStatus = (id) =>
      id === "thread-gone" ? "not-found" : origGet(id);
    const service2 = new IMService({ store, host: host2.host });
    service2.registerAdapter(new DummyAdapter("feishu-main"));

    await service2.manager.handleInbound(makeInbound("hello"));
    const created = host2.calls.find((c) => c.kind === "createThread");
    expect(created).toBeDefined();
    expect((created!.input as { title: string }).title).toContain("[FS]");
    const submit = host2.calls.find((c) => c.kind === "submit");
    expect(submit).toBeDefined();
    expect((submit!.input as { threadId: string }).threadId).toBe("thread-im-1");
    // 绑定 threadId 已更新落库
    expect(store.getImBinding("feishu-main", "oc_a")?.threadId).toBe("thread-im-1");
  });

  it("审批决议经 onApprovalResolved 回 broker 接缝", async () => {
    const store = await createStore();
    const { host, calls } = makeHost();
    const { service } = setup(host, store);
    await pairChannel(service, store);

    service.manager.registerPendingApproval({
      approvalId: "ap-1",
      adapter: "feishu-main",
      channelId: "oc_a",
      toolName: "shell",
      summary: "rm -rf /tmp/x",
      risk: "high",
    });
    await service.manager.handleInbound(makeInbound("y"));
    const resolved = calls.find((c) => c.kind === "resolveApproval");
    expect(resolved).toBeDefined();
    expect(resolved!.input).toMatchObject({ approvalId: "ap-1", approved: true });
  });

  it("出站事件：onAgentEvent 翻译后经 adapter.send 发出（E5 订阅路径）", async () => {
    const store = await createStore();
    const { host } = makeHost();
    const { service, adapter } = setup(host, store);
    const binding = await pairChannel(service, store);

    service.onAgentEvent(binding.threadId, { type: "turn.started" });
    service.onAgentEvent(binding.threadId, { type: "tool.call", toolName: "shell", detail: "ls" });
    service.onAgentEvent(binding.threadId, {
      type: "tool.result", toolName: "shell", detail: "ok",
    });
    service.onAgentEvent(binding.threadId, { type: "turn.completed", text: "完成" });
    await new Promise((r) => setTimeout(r, 10)); // deliver 是 async

    // summary 模式：tool_summary + text 两个事件
    expect(adapter.sent).toHaveLength(2);
    expect(adapter.sent[0]?.event).toEqual({ kind: "tool_summary", total: 1, failures: 0 });
    expect(adapter.sent[1]?.event).toEqual({ kind: "text", text: "完成" });
  });

  it("出站事件：无绑定线程的事件被忽略", async () => {
    const store = await createStore();
    const { host } = makeHost();
    const { service, adapter } = setup(host, store);
    service.onAgentEvent("thread-unrelated", { type: "turn.completed", text: "x" });
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.sent).toHaveLength(0);
  });

  it("出站事件：muted 绑定不发", async () => {
    const store = await createStore();
    const { host } = makeHost();
    const { service, adapter } = setup(host, store);
    const binding = await pairChannel(service, store);
    store.updateImBinding("feishu-main", "oc_a", { muted: true });
    service.onAgentEvent(binding.threadId, { type: "turn.completed", text: "x" });
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.sent).toHaveLength(0);
  });
});
