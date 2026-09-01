import { describe, expect, it, vi } from "vitest";

import {
  FEISHU_MAX_TEXT_BYTES,
  FeishuAdapter,
  buildApprovalCard,
  sniffImageMime,
  type FeishuChannelLike,
  type LarkCardActionEvent,
  type LarkNormalizedMessage,
} from "../src/adapters/feishu.js";
import type { ChannelBinding, InboundMessage } from "../src/types.js";

/** 假 LarkChannel：记录调用 + 可注入消息（不触网） */
class FakeChannel implements FeishuChannelLike {
  botIdentity = { openId: "ou_bot", name: "artemis" };
  connected = false;
  sent: { to: string; input: unknown }[] = [];
  updatedCards: { messageId: string; card: object }[] = [];
  reactions: { messageId: string; emojiType: string }[] = [];
  /** 注入下载失败（模拟缺 im:resource 权限等真实错误） */
  downloadError: Error | null = null;
  private handlers: {
    message?: (msg: LarkNormalizedMessage) => void | Promise<void>;
    cardAction?: (evt: LarkCardActionEvent) => void | Promise<void>;
  } = {};

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  on(handlers: typeof this.handlers): unknown {
    this.handlers = handlers;
    return () => {};
  }
  async send(to: string, input: unknown): Promise<{ messageId: string }> {
    this.sent.push({ to, input });
    return { messageId: `om_fake_${this.sent.length}` };
  }
  async updateCard(messageId: string, card: object): Promise<void> {
    this.updatedCards.push({ messageId, card });
  }
  async addReaction(messageId: string, emojiType: string): Promise<string> {
    this.reactions.push({ messageId, emojiType });
    return "reaction_1";
  }
  async downloadResource(_fileKey: string, _type: string): Promise<Buffer> {
    if (this.downloadError) throw this.downloadError;
    // PNG magic header + payload
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("fake-png-data"),
    ]);
  }

  emitMessage(msg: LarkNormalizedMessage): void {
    void this.handlers.message?.(msg);
  }
  emitCardAction(evt: LarkCardActionEvent): void {
    void this.handlers.cardAction?.(evt);
  }
}

function makeAdapter(fake: FakeChannel): FeishuAdapter {
  return new FeishuAdapter("feishu-main", {
    appId: "cli_a",
    appSecret: "secret",
    channelFactory: () => fake,
  });
}

function makeBinding(overrides?: Partial<ChannelBinding>): ChannelBinding {
  return {
    workspaceKey: "ws1",
    threadId: "thread-1",
    adapter: "feishu-main",
    platform: "feishu",
    channelId: "oc_a",
    outputMode: "summary",
    muted: false,
    boundAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<LarkNormalizedMessage>): LarkNormalizedMessage {
  return {
    messageId: "om_1",
    chatId: "oc_a",
    chatType: "p2p",
    senderId: "ou_user1",
    senderName: "张三",
    content: "你好",
    rawContentType: "text",
    resources: [],
    ...overrides,
  };
}

describe("FeishuAdapter（plan §2.7 / Phase 1.1-1.2）", () => {
  it("缺 appId/appSecret 构造即抛错（对齐 [G] newFeishuAdapter）", () => {
    expect(() => new FeishuAdapter("x", { appId: "", appSecret: "s" })).toThrow("app_id");
    expect(() => new FeishuAdapter("x", { appId: "a", appSecret: " " })).toThrow("app_secret");
  });

  it("start → connect，stop → disconnect；AbortSignal 触发 stop", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    const controller = new AbortController();
    await adapter.start({ signal: controller.signal }, () => {});
    expect(fake.connected).toBe(true);
    controller.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.connected).toBe(false);
  });

  it("文本消息 → InboundMessage（envelope 字段完整映射）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    const inbound: InboundMessage[] = [];
    await adapter.start({ signal: new AbortController().signal }, (m) => inbound.push(m));
    fake.emitMessage(makeMessage());
    await new Promise((r) => setTimeout(r, 0));
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.envelope).toMatchObject({
      adapter: "feishu-main",
      platform: "feishu",
      channelId: "oc_a",
      senderId: "ou_user1",
      senderName: "张三",
      messageId: "om_1",
    });
    expect(inbound[0]?.text).toBe("你好");
  });

  it("图片消息 → 下载 + base64 + MIME 嗅探（E7）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    const inbound: InboundMessage[] = [];
    await adapter.start({ signal: new AbortController().signal }, (m) => inbound.push(m));
    fake.emitMessage(
      makeMessage({
        content: "",
        rawContentType: "image",
        resources: [{ type: "image", fileKey: "img_v3_x" }],
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(inbound).toHaveLength(1);
    const att = inbound[0]?.attachments[0];
    expect(att?.kind).toBe("image");
    expect(att?.mime).toBe("image/png"); // 嗅探出 fake PNG header
    expect(att?.dataBase64.length).toBeGreaterThan(0);
  });

  it("图片占位符清洗：SDK 归一化的 ![image](key) 不得进入提交文本（用户症状回归）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    const inbound: InboundMessage[] = [];
    await adapter.start({ signal: new AbortController().signal }, (m) => inbound.push(m));
    // 真实 SDK 形状（lib/index.js postToPlainText/image 分支）：content 带 markdown 占位符
    fake.emitMessage(
      makeMessage({
        content: "![image](img_v3_x)",
        rawContentType: "image",
        resources: [{ type: "image", fileKey: "img_v3_x" }],
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.text).not.toContain("img_v3_x");
    expect(inbound[0]?.text).not.toContain("![image]");
    expect(inbound[0]?.text).toBe("[图片]");
    expect(inbound[0]?.attachments).toHaveLength(1);
  });

  it("图片下载失败：记日志 + 文本标记失败 + 消息仍投递（不静默吞错，对齐 [G] debug.Log）", async () => {
    const fake = new FakeChannel();
    fake.downloadError = new Error("feishu code 99991400: permission denied (im:resource)");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const adapter = makeAdapter(fake);
      const inbound: InboundMessage[] = [];
      await adapter.start({ signal: new AbortController().signal }, (m) => inbound.push(m));
      fake.emitMessage(
        makeMessage({
          content: "![image](img_v3_x)",
          rawContentType: "image",
          resources: [{ type: "image", fileKey: "img_v3_x" }],
        }),
      );
      await new Promise((r) => setTimeout(r, 10));
      // 消息不丢，文本明确标记失败，附件为空
      expect(inbound).toHaveLength(1);
      expect(inbound[0]?.text).toBe("[图片下载失败]");
      expect(inbound[0]?.attachments).toHaveLength(0);
      // 失败必须可见（可诊断性）
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("img_v3_x"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("空文本且无附件 → 丢弃", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    const inbound: InboundMessage[] = [];
    await adapter.start({ signal: new AbortController().signal }, (m) => inbound.push(m));
    fake.emitMessage(makeMessage({ content: "  " }));
    await new Promise((r) => setTimeout(r, 0));
    expect(inbound).toHaveLength(0);
  });

  it("send(text) → markdown 发送；超长文本按字节分片兜底（E13）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    const long = "汉".repeat(FEISHU_MAX_TEXT_BYTES); // ≈84KB
    await adapter.send(makeBinding(), { kind: "text", text: long });
    expect(fake.sent.length).toBeGreaterThanOrEqual(3);
    expect(fake.sent.every((s) => (s.input as { markdown: string }).markdown !== undefined)).toBe(true);
  });

  it("send(tool_summary) → 汇总文案", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.send(makeBinding(), { kind: "tool_summary", total: 3, failures: 1 });
    const input = fake.sent[0]?.input as { markdown: string };
    expect(input.markdown).toContain("3 个工具");
    expect(input.markdown).toContain("1 个失败");
  });

  it("审批卡片：buildApprovalCard 结构 + sendApprovalButtons 返回 messageId", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    const event = {
      kind: "approval_request" as const,
      approvalId: "ap-1",
      toolName: "shell",
      summary: "rm -rf /tmp/x",
      risk: "high",
    };
    const card = buildApprovalCard(event) as { schema: string; body: { elements: unknown[] } };
    expect(card.schema).toBe("2.0");
    const json = JSON.stringify(card);
    expect(json).toContain('"appr":"ap-1"');
    expect(json).toContain('"decision":"y"');
    expect(json).toContain('"decision":"n"');

    const msgId = await adapter.sendApprovalButtons(makeBinding(), event);
    expect(msgId).toBe("om_fake_1");
    expect((fake.sent[0]?.input as { card: object }).card).toBeDefined();
  });

  it("卡片回调：合法 {appr, decision} 触发 onApprovalCallback；非法值忽略", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    const callbacks: { approvalId: string; approved: boolean; messageId: string }[] = [];
    adapter.onApprovalCallback((e) => callbacks.push(e));
    await adapter.start({ signal: new AbortController().signal }, () => {});

    fake.emitCardAction({
      messageId: "om_9",
      chatId: "oc_a",
      operator: { openId: "ou_user1" },
      action: { tag: "button", value: { appr: "ap-1", decision: "y" } },
    });
    expect(callbacks).toEqual([{ approvalId: "ap-1", approved: true, messageId: "om_9" }]);

    // 非法：无 appr
    fake.emitCardAction({
      messageId: "om_10",
      chatId: "oc_a",
      operator: { openId: "ou_user1" },
      action: { tag: "button", value: { decision: "y" } },
    });
    // 非法：decision 非 y/n
    fake.emitCardAction({
      messageId: "om_11",
      chatId: "oc_a",
      operator: { openId: "ou_user1" },
      action: { tag: "button", value: { appr: "ap-1", decision: "maybe" } },
    });
    expect(callbacks).toHaveLength(1);
  });

  it("审批终态回写原卡片（按钮移除）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.updateCardForResolution("om_9", {
      kind: "approval_resolved",
      approvalId: "ap-1",
      approved: false,
      respondedBy: "张三",
    });
    expect(fake.updatedCards).toHaveLength(1);
    const card = fake.updatedCards[0]?.card as { body: { elements: { tag: string; content?: string }[] } };
    expect(card.body.elements).toHaveLength(1); // 只剩 markdown，无按钮列
    expect(card.body.elements[0]?.content).toContain("❌ 已拒绝");
    expect(card.body.elements[0]?.content).toContain("张三");
  });

  it("triggerTyping：加 Typing 表情且同一条消息只加一次（E24）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    const binding = makeBinding({ lastInboundMessageId: "om_user_msg" });
    await adapter.triggerTyping(binding);
    await adapter.triggerTyping(binding);
    expect(fake.reactions).toEqual([{ messageId: "om_user_msg", emojiType: "Typing" }]);
  });

  it("triggerTyping：无 lastInboundMessageId 时 no-op", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.triggerTyping(makeBinding());
    expect(fake.reactions).toHaveLength(0);
  });

  it("sniffImageMime 魔数识别", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(Buffer.from("GIF89a...."))).toBe("image/gif");
    expect(sniffImageMime(Buffer.from("RIFFxxxxWEBP"))).toBe("image/webp");
    expect(sniffImageMime(Buffer.from("unknown"))).toBe("image/jpeg");
  });
});
