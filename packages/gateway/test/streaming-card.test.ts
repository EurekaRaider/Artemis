import { describe, expect, it, vi } from "vitest";

import {
  ChannelRateLimit,
  FeishuAdapter,
  DeliveryUncertain,
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

const conversation = { connectionId: "f", kind: "direct", id: "chat" } as const;

interface Call {
  url: string;
  method?: string;
  body?: unknown;
}

/** Route mocked responses by URL substring; every call is recorded. */
function stubFetch(responses: Array<[string, unknown]>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string | URL, init?: { method?: string; body?: unknown }) => {
        calls.push({
          url: String(url),
          method: init?.method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        const path = String(url);
        for (const [needle, response] of responses) {
          if (!path.includes(needle)) continue;
          if (typeof response === "number")
            return { ok: false, status: response, json: async () => ({}) };
          if (response instanceof Response) return response;
          return Response.json(response);
        }
        throw new Error(`unexpected fetch ${path}`);
      },
    ),
  );
  return calls;
}

describe("Feishu streaming reply cards", () => {
  it("creates a Card JSON 2.0 message with streaming mode and converts it to a card entity", async () => {
    const calls = stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/im/v1/messages?", { code: 0, data: { message_id: "msg-1" } }],
      ["cards/id_convert", { code: 0, data: { card_id: "card-1" } }],
    ]);
    try {
      const adapter = new FeishuAdapter(config);
      const state = await adapter.streamCard!(
        conversation,
        "第一段回复",
        "key-1",
      );

      expect(state).toMatchObject({
        messageId: "msg-1",
        cardId: "card-1",
        sequence: 0,
        streaming: true,
      });

      const send = calls.find((c) => c.url.includes("/im/v1/messages?"));
      const content = JSON.parse(String(send?.body?.content));
      expect(content.schema).toBe("2.0");
      expect(content.config.streaming_mode).toBe(true);
      expect(content.config.update_multi).toBe(true);
      expect(content.body.elements[0]).toMatchObject({
        tag: "markdown",
        element_id: "reply_text",
        content: "第一段回复",
      });

      const convert = calls.find((c) => c.url.includes("cards/id_convert"));
      expect(convert?.method).toBe("POST");
      expect(convert?.body).toEqual({ message_id: "msg-1" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("streams subsequent updates with a monotonic sequence and no new message", async () => {
    const calls = stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/elements/reply_text/content", { code: 0, data: {} }],
    ]);
    try {
      const adapter = new FeishuAdapter(config);
      const state = await adapter.streamCard!(
        conversation,
        "第一段回复\n第二段回复",
        "key-2",
        {
          messageId: "msg-1",
          createdAt: Date.now(),
          cardId: "card-1",
          sequence: 3,
          streaming: true,
        },
      );

      expect(state).toMatchObject({ sequence: 4, cardId: "card-1" });
      const update = calls.find((c) =>
        c.url.includes("cards/card-1/elements/reply_text/content"),
      );
      expect(update?.method).toBe("PUT");
      expect(update?.body).toEqual({
        content: "第一段回复\n第二段回复",
        sequence: 4,
      });
      // No new message is sent for a pure streaming update.
      expect(calls.some((c) => c.url.includes("/im/v1/messages?"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps rate limits and confirmed rejections to the shared failure classes", async () => {
    try {
      const limited = stubFetch([
        [
          "tenant_access_token",
          { code: 0, tenant_access_token: "t", expire: 7200 },
        ],
        [
          "/elements/reply_text/content",
          new Response("limited", {
            status: 429,
            headers: { "retry-after": "17" },
          }),
        ],
      ]);
      const adapter = new FeishuAdapter(config);
      await expect(
        adapter.streamCard!(conversation, "text", "k", {
          messageId: "m",
          createdAt: Date.now(),
          cardId: "c",
          sequence: 0,
          streaming: true,
        }),
      ).rejects.toBeInstanceOf(ChannelRateLimit);
      vi.unstubAllGlobals();

      const rejected = stubFetch([
        [
          "tenant_access_token",
          { code: 0, tenant_access_token: "t", expire: 7200 },
        ],
        [
          "/elements/reply_text/content",
          { code: 230016, msg: "no cardkit scope" },
        ],
      ]);
      await expect(
        adapter.streamCard!(conversation, "text", "k", {
          messageId: "m",
          createdAt: Date.now(),
          cardId: "c",
          sequence: 0,
          streaming: true,
        }),
      ).rejects.toThrow(/rejected the streaming update \(230016\)/);
      vi.unstubAllGlobals();

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("socket closed");
        }),
      );
      await expect(
        adapter.streamCard!(conversation, "text", "k", {
          messageId: "m",
          createdAt: Date.now(),
          cardId: "c",
          sequence: 0,
          streaming: true,
        }),
      ).rejects.toBeInstanceOf(DeliveryUncertain);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails creation when the card entity conversion returns no id", async () => {
    stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/im/v1/messages?", { code: 0, data: { message_id: "msg-9" } }],
      ["cards/id_convert", { code: 0, data: {} }],
    ]);
    try {
      const adapter = new FeishuAdapter(config);
      await expect(
        adapter.streamCard!(conversation, "hello", "key-3"),
      ).rejects.toThrow("streaming card entity id");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
