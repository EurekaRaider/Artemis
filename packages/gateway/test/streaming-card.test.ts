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
  body?: Record<string, any>;
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
  it("creates the CardKit entity before publishing its message", async () => {
    const calls = stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/im/v1/messages?", { code: 0, data: { message_id: "msg-1" } }],
      ["/cardkit/v1/cards", { code: 0, data: { card_id: "card-1" } }],
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
      expect(JSON.parse(String(send?.body?.content))).toEqual({
        type: "card",
        data: { card_id: "card-1" },
      });
      const create = calls.find((c) => c.url.includes("/cardkit/v1/cards"));
      const content = JSON.parse(String(create?.body?.data));
      expect(content.schema).toBe("2.0");
      expect(content.config.streaming_mode).toBe(true);
      expect(content.config.update_multi).toBe(true);
      expect(content.body.elements[0]).toMatchObject({
        tag: "markdown",
        element_id: "reply_text",
        content: "第一段回复",
      });

      expect(create?.method).toBe("POST");
      expect(calls.indexOf(create!)).toBeLessThan(calls.indexOf(send!));
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
        uuid: expect.any(String),
      });
      // No new message is sent for a pure streaming update.
      expect(calls.some((c) => c.url.includes("/im/v1/messages?"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reuses a prior status message when starting a stream", async () => {
    const calls = stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/cardkit/v1/cards", { code: 0, data: { card_id: "card-1" } }],
      ["/im/v1/messages/prior", { code: 0 }],
    ]);
    try {
      const state = await new FeishuAdapter(config).streamCard(
        conversation,
        "Live",
        "key",
        {
          messageId: "prior",
          createdAt: 10,
        },
      );
      expect(state).toMatchObject({
        messageId: "prior",
        createdAt: 10,
        cardId: "card-1",
      });
      const messages = calls.filter((c) => c.url.includes("/im/v1/messages"));
      expect(messages).toHaveLength(1);
      expect(messages[0]?.method).toBe("PATCH");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes streaming mode on the same entity with a higher sequence", async () => {
    const calls = stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/cardkit/v1/cards/card-1", { code: 0 }],
    ]);
    try {
      const state = await new FeishuAdapter(config).streamCard(
        conversation,
        "Completed",
        "final-key",
        {
          messageId: "msg-1",
          createdAt: 10,
          cardId: "card-1",
          sequence: 4,
          streaming: true,
        },
        false,
      );
      expect(state).toMatchObject({
        messageId: "msg-1",
        cardId: "card-1",
        sequence: 5,
        streaming: false,
      });
      const update = calls.find((c) => c.url.endsWith("cards/card-1"));
      expect(update?.method).toBe("PUT");
      expect(update?.body?.sequence).toBe(5);
      expect(JSON.parse(update?.body?.card.data)).toMatchObject({
        config: { streaming_mode: false },
        body: { elements: [{ content: "Completed" }] },
      });
      expect(calls.some((c) => c.url.includes("/im/v1/messages"))).toBe(false);
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

  it("does not publish a message when card creation returns no entity id", async () => {
    const calls = stubFetch([
      [
        "tenant_access_token",
        { code: 0, tenant_access_token: "t", expire: 7200 },
      ],
      ["/cardkit/v1/cards", { code: 0, data: {} }],
    ]);
    try {
      const adapter = new FeishuAdapter(config);
      await expect(
        adapter.streamCard!(conversation, "hello", "key-3"),
      ).rejects.toThrow("streaming card entity id");
      expect(calls.some((c) => c.url.includes("/im/v1/messages"))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
