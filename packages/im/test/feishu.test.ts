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
  removedReactions: { messageId: string; emojiType: string }[] = [];
  /** 注入 addReaction 失败（模拟缺 im:message.reaction:write 权限） */
  addReactionError: Error | null = null;
  /** 注入下载失败（模拟缺 im:resource 权限等真实错误） */
  downloadError: Error | null = null;
  /** D16：消息内资源接口调用记录 + 可注入错误/空缓冲 */
  messageResourceCalls: { messageId: string; fileKey: string; type: string }[] = [];
  messageResourceError: Error | null = null;
  messageResourceEmpty = false;
  downloadCalls: { fileKey: string; type: string }[] = [];
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
    if (this.addReactionError) throw this.addReactionError;
    this.reactions.push({ messageId, emojiType });
    return "reaction_1";
  }
  async removeReactionByEmoji(messageId: string, emojiType: string): Promise<boolean> {
    this.removedReactions.push({ messageId, emojiType });
    return this.reactions.some((r) => r.messageId === messageId && r.emojiType === emojiType);
  }
  async downloadResource(fileKey: string, type: string): Promise<Buffer> {
    this.downloadCalls.push({ fileKey, type });
    if (this.downloadError) throw this.downloadError;
    // PNG magic header + payload
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("fake-png-data"),
    ]);
  }

  /** D16：实例级字段（测试可置 undefined 模拟旧 SDK 无此方法） */
  downloadMessageResource = async (
    messageId: string,
    fileKey: string,
    type: string,
  ): Promise<Buffer> => {
    this.messageResourceCalls.push({ messageId, fileKey, type });
    if (this.messageResourceError) throw this.messageResourceError;
    if (this.downloadError) throw this.downloadError;
    if (this.messageResourceEmpty) return Buffer.alloc(0);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("fake-png-data"),
    ]);
  };

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
    // 成功下载的图片在气泡内联展示，文本不留 [图片] 标记（纯图片消息文本为空）
    expect(inbound[0]?.text).toBe("");
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

  it("D16：用户图片优先走消息内资源接口（带 message_id），不再误用 im/v1/images", async () => {
    const fake = new FakeChannel();
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
    expect(fake.messageResourceCalls).toEqual([
      { messageId: "om_1", fileKey: "img_v3_x", type: "image" },
    ]);
    // im/v1/images/{image_key} 官方仅支持机器人自传图片，用户图片走它必然失败
    expect(fake.downloadCalls).toHaveLength(0);
    expect(inbound[0]?.attachments).toHaveLength(1);
    expect(inbound[0]?.text).toBe("");
  });

  it("D16：通道缺省 downloadMessageResource 时回退 downloadResource（兼容缝）", async () => {
    const fake = new FakeChannel();
    fake.downloadMessageResource = undefined as unknown as typeof fake.downloadMessageResource;
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
    expect(fake.downloadCalls).toEqual([{ fileKey: "img_v3_x", type: "image" }]);
    expect(inbound[0]?.attachments).toHaveLength(1);
  });

  it("D16：空缓冲响应 → 占位符不泄漏，标记失败并记 warn（与抛错同权）", async () => {
    const fake = new FakeChannel();
    fake.messageResourceEmpty = true;
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
      expect(inbound[0]?.text).toBe("[图片下载失败]");
      expect(inbound[0]?.text).not.toContain("img_v3_x");
      expect(inbound[0]?.attachments).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("empty"));
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

  it("send(text) 含 markdown 图片 → 提取为 image 消息 + 保留 alt 文本", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.send(makeBinding(), {
      kind: "text",
      text: "看这张 ![截图](https://x.com/a.png) 图",
    });
    const sent = fake.sent.map((s) => s.input);
    const img = sent.find((s) => (s as { image?: unknown }).image !== undefined);
    expect(img).toEqual({ image: { source: "https://x.com/a.png" } });
    const md = sent.find((s) => (s as { markdown?: string }).markdown === "看这张 截图 图");
    expect(md).toBeDefined();
  });

  it("send(text) 含 data 图片 → 解码为 Buffer 发送 image", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.send(makeBinding(), {
      kind: "text",
      text: "图 data:image/png;base64,aGVsbG8=",
    });
    const img = fake.sent.find(
      (s) => (s.input as { image?: { source: unknown } }).image !== undefined,
    )?.input as { image?: { source: Buffer } };
    expect(img.image?.source).toBeInstanceOf(Buffer);
    expect(img.image?.source.toString("utf8")).toBe("hello");
  });

  it("send(text) 含 .mp4 视频 → 提取为 video 消息", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.send(makeBinding(), {
      kind: "text",
      text: "回放 /tmp/demo.mp4 已生成",
    });
    const video = fake.sent.find(
      (s) => (s.input as { video?: unknown }).video !== undefined,
    )?.input;
    expect(video).toEqual({ video: { source: "/tmp/demo.mp4" } });
  });

  it("triggerTyping：加 Typing 表情到最新入站消息，失败记日志不抛错（权限缺失可见）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.triggerTyping(makeBinding({ lastInboundMessageId: "om_9" }));
    expect(fake.reactions).toEqual([{ messageId: "om_9", emojiType: "Typing" }]);

    fake.addReactionError = new Error("no permission im:message.reaction:write");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await adapter.triggerTyping(makeBinding({ lastInboundMessageId: "om_10" }));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("typing reaction failed (om_10)"));
    } finally {
      warn.mockRestore();
    }
  });

  it("clearTyping：turn 终态移除机器人自己加的 Typing 表情（只删自己的）", async () => {
    const fake = new FakeChannel();
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    await adapter.triggerTyping(makeBinding({ lastInboundMessageId: "om_9" }));
    await adapter.clearTyping(makeBinding({ lastInboundMessageId: "om_9" }));
    expect(fake.removedReactions).toEqual([{ messageId: "om_9", emojiType: "Typing" }]);
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

  it("D21：triggerTyping 先打标再请求——并发触发只发一次 addReaction", async () => {
    const fake = new FakeChannel();
    // addReaction 悬挂到手动放行，模拟慢网络：入站受理与 turn.started 兜底
    // 在请求在途时并发到达（真机缺陷：await 后打标挡不住第二个请求 →
    // 飞书 231015 "Act on reaction failed, repeated request is processing"）
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalAddReaction = fake.addReaction.bind(fake);
    fake.addReaction = (messageId: string, emojiType: string) =>
      gate.then(() => originalAddReaction(messageId, emojiType));
    const adapter = makeAdapter(fake);
    await adapter.start({ signal: new AbortController().signal }, () => {});
    const binding = makeBinding({ lastInboundMessageId: "om_race" });

    const first = adapter.triggerTyping(binding);
    const second = adapter.triggerTyping(binding);
    release();
    await Promise.all([first, second]);

    expect(fake.reactions).toEqual([{ messageId: "om_race", emojiType: "Typing" }]);
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
