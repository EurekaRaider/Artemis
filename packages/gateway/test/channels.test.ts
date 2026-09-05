import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  normalizeFeishu,
  normalizeWecom,
  verifyFeishu,
  splitImText,
  FeishuAdapter,
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
  wecomAttachmentName,
  type ChannelConnection,
} from "../src/channels.js";
const config: Extract<ChannelConnection, { channel: "feishu" }> = {
  id: "f",
  name: "f",
  channel: "feishu",
  tenantId: "tenant",
  appId: "app",
  botOpenId: "own-bot",
  appSecret: "secret",
  verificationToken: "token",
  encryptKey: "encrypt",
  enabled: true,
};
describe("Channel trust boundary", () => {
  it("treats an unavailable token service as unsent and retryable", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network unavailable"));
    try {
      await expect(
        new FeishuAdapter(config).send(
          { connectionId: "f", id: "chat", kind: "direct" },
          "hello",
          "key",
        ),
      ).rejects.toBeInstanceOf(ChannelUnavailable);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0]?.[0])).toContain("tenant_access_token");
    } finally {
      fetch.mockRestore();
    }
  });
  it("recovers file types when a WeCom callback omits its filename", () => {
    expect(
      wecomAttachmentName("attachment", Buffer.from("%PDF-1.7"), null),
    ).toBe("attachment.pdf");
    expect(
      wecomAttachmentName(
        "attachment",
        Buffer.from("PK\x03\x04word/document.xml"),
        null,
      ),
    ).toBe("attachment.docx");
    expect(
      wecomAttachmentName(
        "attachment",
        Buffer.from("text"),
        "attachment; filename*=UTF-8''notes.md",
      ),
    ).toBe("notes.md");
    expect(
      wecomAttachmentName("attachment", Buffer.from([0, 1, 2]), null),
    ).toBe("attachment");
  });
  it("creates an updatable Feishu card and updates the same message using plain text content", async () => {
    const calls: Array<{ url: string; method: string | undefined; body: any }> =
      [];
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        const body = JSON.parse(String(init?.body));
        calls.push({ url: String(url), method: init?.method, body });
        return Response.json(
          String(url).includes("tenant_access_token")
            ? { code: 0, tenant_access_token: "test", expire: 7200 }
            : { code: 0, data: { message_id: "om_card" } },
        );
      });
    try {
      const adapter = new FeishuAdapter(config),
        conversation = {
          connectionId: "f",
          id: "chat",
          kind: "direct" as const,
        };
      expect(
        await adapter.statusCard(
          conversation,
          "正在执行 <at id=all>任务</at>",
          "start",
        ),
      ).toBe("om_card");
      expect(
        await adapter.statusCard(conversation, "已完成", "finish", "om_card"),
      ).toBe("om_card");
      expect(calls[1]).toMatchObject({
        method: "POST",
        body: { msg_type: "interactive", receive_id: "chat" },
      });
      expect(JSON.parse(calls[1]!.body.content)).toMatchObject({
        config: { update_multi: true },
        elements: [{ text: { tag: "plain_text" } }],
      });
      expect(calls[2]).toMatchObject({
        url: "https://open.feishu.cn/open-apis/im/v1/messages/om_card",
        method: "PATCH",
      });
      expect(Object.keys(calls[2]!.body)).toEqual(["content"]);
    } finally {
      fetch.mockRestore();
    }
  });
  it("distinguishes Feishu throttling from an unconfirmed delivery", async () => {
    let sendCode = 230020;
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) =>
        Response.json(
          String(url).includes("tenant_access_token")
            ? { code: 0, tenant_access_token: "test", expire: 7200 }
            : { code: sendCode, data: {} },
        ),
      );
    try {
      const adapter = new FeishuAdapter(config),
        conversation = {
          connectionId: "f",
          id: "chat",
          kind: "direct" as const,
        };
      await expect(
        adapter.send(conversation, "test", "first"),
      ).rejects.toBeInstanceOf(ChannelRateLimit);
      sendCode = 0;
      await expect(
        adapter.send(conversation, "test", "second"),
      ).rejects.toBeInstanceOf(DeliveryUncertain);
    } finally {
      fetch.mockRestore();
    }
  });
  it("validates Feishu signature, application, tenant and timestamp before normalization", () => {
    const now = Date.now(),
      body = JSON.stringify({
        header: {
          app_id: "app",
          tenant_key: "tenant",
          token: "token",
          event_type: "im.message.receive_v1",
        },
        event: {},
      }),
      timestamp = String(Math.floor(now / 1000));
    const headers = {
      "x-lark-request-timestamp": timestamp,
      "x-lark-request-nonce": "nonce",
      "x-lark-signature": createHash("sha256")
        .update(timestamp + "nonce" + config.encryptKey + body)
        .digest("hex"),
    };
    expect(verifyFeishu(config, body, headers, now).header.app_id).toBe("app");
    expect(() => verifyFeishu(config, body + " ", headers, now)).toThrow(
      "signature",
    );
    expect(() => verifyFeishu(config, body, headers, now + 600000)).toThrow(
      "expired",
    );
    expect(() =>
      verifyFeishu({ ...config, tenantId: "other" }, body, headers, now),
    ).toThrow("tenant");
  });
  it("recognizes only its own mention and preserves sender and parent identity", () => {
    const input = {
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_type: "user", sender_id: { open_id: "alice" } },
        message: {
          message_id: "m",
          chat_id: "g",
          chat_type: "group",
          parent_id: "parent",
          content: JSON.stringify({ text: "@_user_1 hello" }),
          mentions: [{ key: "@_user_1", id: { open_id: "another-bot" } }],
        },
      },
    };
    expect(normalizeFeishu(config, input)?.mentioned).toBe(false);
    input.event.message.mentions[0]!.id.open_id = "own-bot";
    expect(normalizeFeishu(config, input)).toMatchObject({
      mentioned: true,
      replyTo: "parent",
      text: "hello",
      identity: { userId: "alice" },
    });
  });
  it("ignores the wrong WeCom bot and splits text without corrupting Unicode", () => {
    const bot = {
      id: "w",
      name: "w",
      channel: "wecom" as const,
      tenantId: "t",
      botId: "b",
      secret: "s",
      enabled: true,
    };
    const input = {
      cmd: "aibot_msg_callback",
      body: {
        aibotid: "other",
        from: { userid: "a" },
        msgid: "m",
        chattype: "single",
        msgtype: "text",
        text: { content: "hello" },
      },
    };
    expect(normalizeWecom(bot, input)).toBeUndefined();
    input.body.aibotid = "b";
    expect(normalizeWecom(bot, input)?.conversation.id).toBe("a");
    const text = "群聊🙂".repeat(1000);
    const parts = splitImText(text);
    expect(parts.join("")).toBe(text);
    expect(parts.every((p) => Buffer.byteLength(p) <= 3500)).toBe(true);
  });
});
