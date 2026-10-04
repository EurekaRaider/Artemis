import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import {
  normalizeFeishu,
  normalizeWecom,
  verifyFeishu,
  splitImText,
  FeishuAdapter,
  WecomAdapter,
  ChannelRateLimit,
  ChannelUnavailable,
  DeliveryUncertain,
  wecomAttachmentName,
  type ChannelConnection,
} from "../../src/channels/channels.js";
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
  it.each(["feishu", "lark"] as const)(
    "%s recognizes both dissolved chat states without treating access errors as deletion",
    async (domain) => {
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (url) =>
          Response.json(
            String(url).includes("tenant_access_token")
              ? { code: 0, tenant_access_token: "test", expire: 7200 }
              : {
                  code: 0,
                  data: { name: "ArtemisGroup", chat_status: "dissolved" },
                },
          ),
        );
      try {
        const adapter = new FeishuAdapter({ ...config, domain });
        const conversation = {
          connectionId: "f",
          id: "room",
          kind: "group" as const,
        };
        expect(await adapter.groupInfo(conversation)).toEqual({
          name: "ArtemisGroup",
          unavailable: "dissolved",
        });
        fetcher.mockResolvedValueOnce(
          Response.json({
            code: 0,
            data: { name: "ArtemisGroup", chat_status: "dissolved_save" },
          }),
        );
        expect(await adapter.groupInfo(conversation)).toMatchObject({
          unavailable: "dissolved",
        });
        fetcher.mockResolvedValueOnce(
          Response.json({ code: 99991679 }, { status: 403 }),
        );
        await expect(adapter.groupInfo(conversation)).rejects.toThrow(
          "unavailable",
        );
      } finally {
        fetcher.mockRestore();
      }
    },
  );
  it.each(["feishu", "lark"] as const)(
    "sends a native requester mention with next steps on %s",
    async (domain) => {
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (url) =>
          Response.json(
            String(url).includes("tenant_access_token")
              ? { code: 0, tenant_access_token: "test", expire: 7200 }
              : { code: 0, data: { message_id: "message" } },
          ),
        );
      try {
        const adapter = new FeishuAdapter({ ...config, domain });
        await adapter.send(
          { connectionId: "f", kind: "group", id: "room" },
          "等待补充：请提供目标分支。",
          "waiting",
          "ou_dispatcher",
        );
        const body = JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body));
        expect(body.msg_type).toBe("post");
        expect(JSON.parse(body.content).zh_cn.content).toEqual([
          [{ tag: "at", user_id: "ou_dispatcher" }],
          [{ tag: "md", text: "等待补充：请提供目标分支。" }],
        ]);
      } finally {
        fetcher.mockRestore();
      }
    },
  );

  it("sends WeCom group status mentions without changing direct replies", async () => {
    const adapter = new WecomAdapter(
      {
        id: "w",
        name: "w",
        channel: "wecom",
        tenantId: "tenant",
        botId: "bot",
        secret: "secret",
        enabled: true,
      },
      () => {},
    );
    const command = vi.fn().mockResolvedValue({});
    Object.assign(adapter, { connected: true, command });
    for (const kind of ["group", "direct"] as const) {
      await adapter.send(
        { connectionId: "w", id: "room", kind },
        "请确认下一步。",
        kind,
        "dispatcher",
      );
      expect(command.mock.calls.at(-1)?.[1].markdown.content).toBe(
        `${kind === "group" ? "<@dispatcher>\n" : ""}请确认下一步。`,
      );
    }
  });
  it("extracts one rich-post rendition and message image resources while preserving human mentions", () => {
    const event = normalizeFeishu(config, {
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_type: "user", sender_id: { open_id: "alice" } },
        message: {
          message_id: "post",
          chat_id: "chat",
          chat_type: "p2p",
          message_type: "post",
          content: JSON.stringify({
            zh_cn: {
              title: "检查",
              content: [
                [
                  { tag: "text", text: "@_user_1 你好 @_user_2" },
                  { tag: "img", image_key: "image" },
                ],
                [{ tag: "img", image_key: "image" }],
              ],
            },
            en_us: { title: "duplicate", content: [] },
          }),
          mentions: [
            { key: "@_user_1", id: { open_id: "own-bot" } },
            { key: "@_user_2", id: { open_id: "bob" }, name: "Mino" },
          ],
        },
      },
    });
    expect(event).toMatchObject({
      messageId: "post",
      text: "检查\n 你好 @Mino",
      mentions: [{ userId: "bob", name: "Mino" }],
      attachments: [
        { kind: "image", name: "image-1.png", resourceId: "image" },
      ],
    });
  });
  it("resolves text mentions once without confusing overlapping keys or inventing names", () => {
    const event = normalizeFeishu(config, {
      header: { event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_type: "user", sender_id: { open_id: "alice" } },
        message: {
          message_id: "text",
          chat_id: "chat",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({
            text: "@_user_1 请问 @_user_10 和 @_user_2、@_user_3",
          }),
          mentions: [
            {
              key: "@_user_1",
              id: { open_id: "own-bot" },
              name: "ArtemisLark",
            },
            { key: "@_user_10", id: { open_id: "mino" }, name: "Mino" },
            { key: "@_user_2", id: { open_id: "literal" }, name: "_user_10" },
            { key: "@_user_3", id: { open_id: "unknown" } },
          ],
        },
      },
    });
    expect(event?.text).toBe("请问 @Mino 和 @_user_10、@unknown");
    expect(event?.mentioned).toBe(true);
  });
  it.each(["text", "post", "localized-post"])(
    "routes %s to the first mention and preserves the collaboration partner",
    (format) => {
      const input = {
        header: { event_type: "im.message.receive_v1" },
        event: {
          sender: { sender_type: "user", sender_id: { open_id: "alice" } },
          message: {
            message_id: "two-mentions",
            chat_id: "group",
            chat_type: "group",
            message_type: format === "text" ? "text" : "post",
            content: JSON.stringify(
              format === "text"
                ? { text: "@_user_1 你跟 @_user_2 讨论下分工" }
                : format === "post"
                  ? {
                      content: [
                        [
                          { tag: "at", user_id: "mino" },
                          { tag: "text", text: " 你跟 " },
                          { tag: "at", user_id: "jupiter" },
                          { tag: "text", text: " 讨论下分工" },
                        ],
                      ],
                    }
                  : {
                      zh_cn: {
                        content: [
                          [
                            { tag: "text", text: "@_user_1 你跟 " },
                            { tag: "at", user_id: "jupiter" },
                            { tag: "text", text: " 讨论下分工" },
                          ],
                        ],
                      },
                    },
            ),
            // Delivery metadata order must not decide the addressee.
            mentions: [
              { key: "@_user_2", id: { open_id: "jupiter" }, name: "Jupiter" },
              { key: "@_user_1", id: { open_id: "mino" }, name: "Mino" },
            ],
          },
        },
      };
      expect(
        normalizeFeishu({ ...config, botOpenId: "mino" }, input),
      ).toMatchObject({
        mentioned: true,
        text: "你跟 @Jupiter 讨论下分工",
      });
      expect(
        normalizeFeishu({ ...config, botOpenId: "jupiter" }, input),
      ).toMatchObject({
        mentioned: false,
        text: "@Mino 你跟 @Jupiter 讨论下分工",
      });
    },
  );
  it("recovers only the current app's Typing reaction before cleanup", async () => {
    const requests: string[] = [];
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        requests.push(`${init?.method ?? "GET"} ${url}`);
        return Response.json(
          String(url).includes("tenant_access_token")
            ? { code: 0, tenant_access_token: "test", expire: 7200 }
            : init?.method === "DELETE"
              ? { code: 0, data: {} }
              : {
                  code: 0,
                  data: {
                    has_more: false,
                    items: [
                      {
                        reaction_id: "someone-else",
                        operator: {
                          operator_type: "app",
                          operator_id: "other",
                        },
                        reaction_type: { emoji_type: "Typing" },
                      },
                      {
                        reaction_id: "own",
                        operator: { operator_type: "app", operator_id: "app" },
                        reaction_type: { emoji_type: "Typing" },
                      },
                    ],
                  },
                },
        );
      });
    try {
      await new FeishuAdapter(config).typing("message", false);
      expect(requests.at(-1)).toBe(
        "DELETE https://open.feishu.cn/open-apis/im/v1/messages/message/reactions/own",
      );
    } finally {
      fetch.mockRestore();
    }
  });
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
  it("creates an updatable Feishu card and updates the same message using Markdown content", async () => {
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
        elements: [
          {
            text: {
              tag: "lark_md",
              content: "正在执行 &lt;at id=all&gt;任务&lt;/at&gt;",
            },
          },
        ],
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
