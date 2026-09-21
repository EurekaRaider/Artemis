import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuAdapter, normalizeFeishu } from "../src/channels.js";
import { feishuNativeLink, feishuNativePost } from "../src/feishu-native.js";
import {
  decodeNativeEnvelope,
  encodeNativeEnvelope,
  type NativeEnvelope,
} from "../src/native-protocol.js";

afterEach(() => vi.restoreAllMocks());
describe.each(["feishu", "lark"] as const)(
  "%s native message transport",
  (domain) => {
    const config = {
      channel: "feishu" as const,
      id: "receiver",
      name: "Receiver",
      domain,
      appId: "receiver-app",
      botOpenId: "receiver-self",
      appSecret: "test",
      tenantId: "tenant",
      enabled: true,
      transport: "websocket" as const,
    };
    function frame(action: NativeEnvelope["action"] = "probe"): NativeEnvelope {
      return {
        version: 1,
        id: randomUUID(),
        platform: domain,
        tenant: "tenant",
        group: "group",
        sender: "sender-self",
        recipient: "receiver-in-sender-app",
        workflow: randomUUID(),
        task: randomUUID(),
        action,
        ...(action === "continue" ? { previousTask: randomUUID() } : {}),
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30000,
        sequence: 0,
        text: '需要处理的工作 🧪 <at user_id="all">不要群发</at>',
        locale: "zh-CN",
      };
    }
    function event(
      content: unknown,
      type = "post",
      bot = true,
      mentioned = true,
    ) {
      return {
        header: { event_type: "im.message.receive_v1" },
        event: {
          sender: {
            sender_type: bot ? "bot" : "user",
            sender_id: { open_id: "sender-in-receiver-app" },
          },
          message: {
            message_id: "message",
            chat_id: "group",
            chat_type: "group",
            create_time: String(Date.now()),
            message_type: type,
            content: JSON.stringify(content),
            mentions: mentioned
              ? [
                  {
                    key: "@_user_1",
                    id: { open_id: config.botOpenId },
                    name: "Receiver",
                  },
                ]
              : [],
          },
        },
      };
    }
    it.each<NativeEnvelope["action"]>([
      "hello",
      "probe",
      "proof",
      "delegate",
      "continue",
      "accepted",
      "note",
      "progress",
      "heartbeat",
      "completed",
      "failed",
      "rejected",
      "cancel",
      "cancelled",
    ])(
      "renders %s without displaying wire data and round-trips scoped identities",
      async (action) => {
        const original = frame(action);
        const fetcher = vi
          .spyOn(globalThis, "fetch")
          .mockImplementation(async (url) =>
            Response.json(
              String(url).includes("tenant_access_token")
                ? { code: 0, tenant_access_token: "test", expire: 7200 }
                : { code: 0, data: { message_id: "message" } },
            ),
          );
        const adapter = new FeishuAdapter(config);
        await adapter.sendNative(
          { connectionId: config.id, id: "group", kind: "group" },
          encodeNativeEnvelope(original),
          "key",
          original.recipient,
          "zh-CN",
        );
        const request = JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body));
        expect(request.msg_type).toBe("post");
        const post = JSON.parse(request.content).zh_cn;
        const visible = post.content
          .flat()
          .map((node: { text?: string }) => node.text ?? "")
          .join("\n");
        expect(visible).not.toContain("ARTEMIS-IM/1:");
        expect(visible).not.toContain("eyJ2");
        expect(visible.length).toBeGreaterThan(0);
        const normalized = normalizeFeishu(config, event(post))!;
        expect(normalized.bot).toBe(true);
        expect(decodeNativeEnvelope(normalized.text)).toEqual({
          ...original,
          sender: "sender-in-receiver-app",
          recipient: "receiver-self",
        });
      },
    );
    it("uses authenticated sender identity even when a bot claims another sender", () => {
      const original = { ...frame(), sender: "trusted-peer" };
      const normalized = normalizeFeishu(
        config,
        event(
          feishuNativePost(encodeNativeEnvelope(original), original.recipient),
        ),
      )!;
      expect(decodeNativeEnvelope(normalized.text)?.sender).toBe(
        "sender-in-receiver-app",
      );
      expect(decodeNativeEnvelope(normalized.text)?.sender).not.toBe(
        "trusted-peer",
      );
    });
    it("requires a platform mention and does not promote human links to protocol messages", () => {
      const original = frame();
      const post = feishuNativePost(
        encodeNativeEnvelope(original),
        original.recipient,
      );
      expect(
        normalizeFeishu(config, event(post, "post", true, false)),
      ).toBeUndefined();
      const human = normalizeFeishu(config, event(post, "post", false))!;
      expect(human.bot).toBe(false);
      expect(decodeNativeEnvelope(human.text)).toBeUndefined();
    });
    it("drops a protocol event without a platform sender identity", () => {
      const original = frame();
      const input = event(
        feishuNativePost(encodeNativeEnvelope(original), original.recipient),
      );
      input.event.sender.sender_id.open_id = "";
      expect(normalizeFeishu(config, input)).toBeUndefined();
    });
    it("accepts legacy wire messages only through authenticated bot mentions", () => {
      const original = frame();
      const raw = { text: `@_user_1 ${encodeNativeEnvelope(original)}` };
      const normalized = normalizeFeishu(config, event(raw, "text"))!;
      expect(decodeNativeEnvelope(normalized.text)).toMatchObject({
        sender: "sender-in-receiver-app",
        recipient: "receiver-self",
      });
      expect(
        normalizeFeishu(
          config,
          event({ text: encodeNativeEnvelope(original) }, "text", true, false),
        ),
      ).toBeUndefined();
    });
    it("does not extract protocol links belonging to another host, chat or platform", () => {
      const original = frame();
      const post = feishuNativePost(
        encodeNativeEnvelope(original),
        original.recipient,
      );
      const href = (post.zh_cn.content[0]!.at(-1) as { href: string }).href;
      expect(feishuNativeLink(href, "another-chat", domain)).toBeUndefined();
      expect(
        feishuNativeLink(
          href.replace("https://applink.", "https://evil."),
          "group",
          domain,
        ),
      ).toBeUndefined();
      expect(
        feishuNativeLink(href, "group", domain === "lark" ? "feishu" : "lark"),
      ).toBeUndefined();
    });
  },
);
