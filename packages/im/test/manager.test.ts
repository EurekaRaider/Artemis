import { describe, expect, it } from "vitest";

import { DummyAdapter } from "../src/adapters/dummy.js";
import { MemoryBindingStore } from "../src/bindings.js";
import { IMManager, type InboundResult } from "../src/manager.js";
import type { ChannelBinding, InboundMessage, OutboundEvent } from "../src/types.js";

function makeMessage(overrides?: Partial<InboundMessage["envelope"]> & { text?: string }): InboundMessage {
  return {
    envelope: {
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      senderId: "ou_1",
      senderName: "张三",
      messageId: `om_${Math.random().toString(36).slice(2)}`,
      receivedAt: new Date().toISOString(),
      ...overrides,
    },
    text: overrides?.text ?? "你好",
    attachments: [],
  };
}

function setup(opts?: {
  generatePairingCode?: () => string;
  onInboundAccepted?: (msg: InboundMessage, binding: ChannelBinding) => void;
  onApprovalResolved?: (id: string, approved: boolean, by: string) => void;
}) {
  const bindings = new MemoryBindingStore();
  const adapter = new DummyAdapter("feishu-main");
  const replies: { binding: ChannelBinding; event: OutboundEvent }[] = [];
  const manager = new IMManager({
    bindings,
    ...(opts?.generatePairingCode ? { generatePairingCode: opts.generatePairingCode } : {}),
    ...(opts?.onInboundAccepted ? { onInboundAccepted: opts.onInboundAccepted } : {}),
    ...(opts?.onApprovalResolved ? { onApprovalResolved: opts.onApprovalResolved } : {}),
    onReply: (binding, event) => replies.push({ binding, event }),
  });
  manager.registerAdapter(adapter);
  return { manager, adapter, bindings, replies };
}

async function pairChannel(
  manager: IMManager,
  channelId: string,
  code = "1234",
): Promise<ChannelBinding> {
  await manager.handleInbound(makeMessage({ channelId, text: "hi" }));
  await manager.handleInbound(makeMessage({ channelId, text: code }));
  const binding = manager.approvePairing({
    workspaceKey: "ws1",
    threadId: "thread-1",
    adapter: "feishu-main",
    platform: "feishu",
    channelId,
    outputMode: "summary",
  });
  if (!binding) throw new Error("pairing failed");
  return binding;
}

describe("IMManager 状态流转（plan §0.7/§2.4）", () => {
  it("未绑定渠道消息进入配对流程", async () => {
    const { manager } = setup({ generatePairingCode: () => "1234" });
    const r = await manager.handleInbound(makeMessage());
    expect(r.handled).toBe("pairing_flow");
    expect(r.replyText).toContain("配对码");
    expect(manager.status().pairingChallenge?.code).toBe("1234");
  });

  it("配对成功后有绑定，消息进入 onInboundAccepted", async () => {
    const accepted: InboundMessage[] = [];
    const { manager } = setup({
      generatePairingCode: () => "1234",
      onInboundAccepted: (msg) => accepted.push(msg),
    });
    await pairChannel(manager, "oc_a");
    const r = await manager.handleInbound(makeMessage({ text: "列出当前目录" }));
    expect(r.handled).toBe("message");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.text).toBe("列出当前目录");
  });

  it("重复 messageId 只处理一次（dedup）", async () => {
    const accepted: InboundMessage[] = [];
    const { manager } = setup({
      generatePairingCode: () => "1234",
      onInboundAccepted: (msg) => accepted.push(msg),
    });
    await pairChannel(manager, "oc_a");
    const msg = makeMessage({ messageId: "om_dup", text: "hello" });
    await manager.handleInbound(msg);
    const r2 = await manager.handleInbound(msg);
    expect(r2.handled).toBe("dropped");
    expect(accepted).toHaveLength(1);
  });

  it("单活跃绑定守卫：muted 绑定消息被拒并提示", async () => {
    const { manager, bindings } = setup({ generatePairingCode: () => "1234" });
    const binding = await pairChannel(manager, "oc_a");
    bindings.update("feishu-main", "oc_a", { muted: true });
    const r: InboundResult = await manager.handleInbound(makeMessage({ text: "hi" }));
    expect(r.handled).toBe("dropped");
    expect(r.replyText).toContain("解绑");
    void binding;
  });

  it("审批生命周期：注册 → 文本批准 → onApprovalResolved", async () => {
    const resolutions: { id: string; approved: boolean }[] = [];
    const { manager } = setup({
      generatePairingCode: () => "1234",
      onApprovalResolved: (id, approved) => resolutions.push({ id, approved }),
    });
    const binding = await pairChannel(manager, "oc_a");
    manager.registerPendingApproval({
      approvalId: "ap-1",
      adapter: binding.adapter,
      channelId: binding.channelId,
      toolName: "shell",
      summary: "rm -rf /tmp/x",
      risk: "high",
    });
    const r = await manager.handleInbound(makeMessage({ text: "y" }));
    expect(r.handled).toBe("approval");
    expect(resolutions).toEqual([{ id: "ap-1", approved: true }]);
    expect(manager.pendingApprovalCount()).toBe(0);
  });

  it("审批决议重复提交安全返回 false", async () => {
    const { manager } = setup({ generatePairingCode: () => "1234" });
    await pairChannel(manager, "oc_a");
    expect(manager.resolveApproval("ap-x", true, "tester")).toBe(false);
  });

  it("slash 命令：/verbose 切输出模式并持久化", async () => {
    const { manager, bindings } = setup({ generatePairingCode: () => "1234" });
    await pairChannel(manager, "oc_a");
    await manager.handleInbound(makeMessage({ text: "/verbose" }));
    expect(bindings.get("feishu-main", "oc_a")?.outputMode).toBe("verbose");
  });

  it("/unbind 删除绑定", async () => {
    const { manager, bindings } = setup({ generatePairingCode: () => "1234" });
    await pairChannel(manager, "oc_a");
    await manager.handleInbound(makeMessage({ text: "/unbind" }));
    expect(bindings.get("feishu-main", "oc_a")).toBeUndefined();
  });

  it("muted 适配器消息静默丢弃", async () => {
    const accepted: InboundMessage[] = [];
    const { manager } = setup({
      generatePairingCode: () => "1234",
      onInboundAccepted: (msg) => accepted.push(msg),
    });
    await pairChannel(manager, "oc_a");
    await manager.setMuted("feishu-main", true);
    const r = await manager.handleInbound(makeMessage({ text: "hi" }));
    expect(r.handled).toBe("dropped");
    expect(accepted).toHaveLength(0);
  });

  it("muted 适配器 startAdapter 硬拒", async () => {
    const { manager } = setup();
    await manager.setMuted("feishu-main", true);
    await expect(manager.startAdapter("feishu-main")).rejects.toThrow("muted");
  });
});

describe("配对回复出口（真机缺陷回归：回复必须发回渠道）", () => {
  it("配对流程回复经 onReplyToChannel 发出", async () => {
    const channelReplies: { channelId: string; text: string }[] = [];
    const bindings = new MemoryBindingStore();
    const manager = new IMManager({
      bindings,
      generatePairingCode: () => "1234",
      onReplyToChannel: (envelope, text) =>
        channelReplies.push({ channelId: envelope.channelId, text }),
    });
    manager.registerAdapter(new DummyAdapter("feishu-main"));

    const r = await manager.handleInbound(makeMessage());
    expect(r.handled).toBe("pairing_flow");
    expect(channelReplies).toHaveLength(1);
    expect(channelReplies[0]?.channelId).toBe("oc_a");
    expect(channelReplies[0]?.text).toContain("配对码");
  });

  it("配对成功后绑定落库（经 approvePairing）", async () => {
    const bindings = new MemoryBindingStore();
    const manager = new IMManager({
      bindings,
      generatePairingCode: () => "1234",
      onReplyToChannel: () => {},
    });
    manager.registerAdapter(new DummyAdapter("feishu-main"));
    await manager.handleInbound(makeMessage());
    await manager.handleInbound(makeMessage({ text: "1234" }));
    const binding = manager.approvePairing({
      workspaceKey: "",
      threadId: "t1",
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      outputMode: "summary",
    });
    expect(binding).not.toBeNull();
    expect(bindings.get("feishu-main", "oc_a")?.threadId).toBe("t1");
  });
});
