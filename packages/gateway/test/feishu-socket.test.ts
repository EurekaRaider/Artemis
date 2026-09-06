import { describe, expect, it, vi } from "vitest";
import {
  Domain,
  EventDispatcher,
  type WSClient,
} from "@larksuiteoapi/node-sdk";
import {
  channelConnectionSchema,
  type ChannelConnection,
} from "../src/channels.js";
import { FeishuSocketAdapter } from "../src/feishu-socket.js";

const config: Extract<ChannelConnection, { channel: "feishu" }> = {
  id: "feishu",
  name: "Feishu",
  channel: "feishu",
  tenantId: "tenant",
  appId: "app",
  botOpenId: "bot",
  appSecret: "secret",
  enabled: true,
  transport: "websocket",
};
function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schema: "2.0",
    header: {
      app_id: "app",
      tenant_key: "tenant",
      event_id: "evt",
      event_type: "im.message.receive_v1",
      ...overrides,
    },
    event: {
      sender: { sender_type: "user", sender_id: { open_id: "alice" } },
      message: {
        message_id: "message",
        chat_id: "chat",
        chat_type: "p2p",
        create_time: "1000",
        message_type: "image",
        content: JSON.stringify({ image_key: "image" }),
      },
    },
  };
}
function fixture(receive = vi.fn(), receiveCard = vi.fn()) {
  let dispatcher: EventDispatcher;
  let state = "connecting";
  const close = vi.fn();
  const factory = vi.fn(
    () =>
      ({
        start: async (params: { eventDispatcher: EventDispatcher }) => {
          dispatcher = params.eventDispatcher;
        },
        close,
        getConnectionStatus: () => ({ state, reconnectAttempts: 0 }),
      }) as Pick<WSClient, "start" | "close" | "getConnectionStatus">,
  );
  const adapter = new FeishuSocketAdapter(
    config,
    receive,
    factory,
    receiveCard,
  );
  adapter.start();
  return {
    adapter,
    receive,
    receiveCard,
    close,
    factory,
    setState: (next: string) => {
      state = next;
    },
    push: (data: unknown = envelope()) =>
      dispatcher.invoke(data, { needCheck: false }),
  };
}

describe("Feishu Gateway long connection", () => {
  it("uses the Lark SDK domain and gives a region-specific error without exposing credentials", () => {
    const createSocket = vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      getConnectionStatus: () => ({
        state: "failed" as const,
        reconnectAttempts: 0,
      }),
    }));
    const adapter = new FeishuSocketAdapter(
      { ...config, domain: "lark" },
      vi.fn(),
      createSocket,
    );
    adapter.start();
    expect(createSocket).toHaveBeenCalledWith(
      expect.objectContaining({ domain: Domain.Lark }),
    );
    expect(adapter.status().error).toContain("open.larksuite.com");
    expect(adapter.status().error).not.toContain(config.appSecret);
    adapter.stop();
  });
  it("keeps legacy callback credentials mandatory and permits a socket without callback secrets", () => {
    expect(channelConnectionSchema.safeParse(config).success).toBe(true);
    expect(
      channelConnectionSchema.safeParse({ ...config, transport: "webhook" })
        .success,
    ).toBe(false);
    expect(
      channelConnectionSchema.safeParse({ ...config, transport: undefined })
        .success,
    ).toBe(false);
    expect(
      channelConnectionSchema.safeParse({ ...config, transport: "both" })
        .success,
    ).toBe(false);
  });
  it("uses the SDK handshake state and closes exactly one subscription", () => {
    const f = fixture();
    expect(f.adapter.status().state).toBe("connecting");
    f.adapter.start();
    expect(f.factory).toHaveBeenCalledTimes(1);
    f.setState("connected");
    expect(f.adapter.status().state).toBe("connected");
    f.setState("reconnecting");
    expect(f.adapter.status().state).toBe("connecting");
    f.setState("failed");
    expect(f.adapter.status().state).toBe("error");
    f.adapter.stop();
    f.adapter.stop();
    expect(f.close).toHaveBeenCalledExactlyOnceWith({ force: true });
    expect(f.adapter.status().state).toBe("disabled");
  });
  it("retains the authenticated identity and message resource for a pure image", async () => {
    const f = fixture();
    await f.push();
    expect(f.receive).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        messageId: "message",
        text: "",
        identity: {
          channel: "feishu",
          connectionId: "feishu",
          tenantId: "tenant",
          appId: "app",
          userId: "alice",
        },
        conversation: { connectionId: "feishu", id: "chat", kind: "direct" },
        attachments: [
          { kind: "image", name: "image.png", resourceId: "image" },
        ],
      }),
    );
    f.adapter.stop();
  });
  it("rejects wrong app, tenant and late deliveries before the persistent receiver", async () => {
    const f = fixture();
    await f.push(envelope({ app_id: "other" }));
    await f.push(envelope({ tenant_key: "other" }));
    f.adapter.stop();
    await f.push();
    expect(f.receive).not.toHaveBeenCalled();
  });
  it("propagates persistence failure to SDK acknowledgement and accepts the platform retry", async () => {
    const receive = vi.fn().mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    const f = fixture(receive);
    await expect(f.push()).rejects.toThrow("could not be saved");
    expect(f.adapter.status().state).toBe("error");
    await f.push();
    expect(receive).toHaveBeenCalledTimes(2);
    f.adapter.stop();
  });
  it("dispatches card callbacks with authenticated identity and a retryable persistence failure", async () => {
    const receiveCard = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("disk full");
      })
      .mockReturnValue(true);
    const f = fixture(vi.fn(), receiveCard);
    const input = {
      ...envelope({ event_type: "card.action.trigger" }),
      event: {
        operator: { open_id: "alice" },
        context: { open_message_id: "om_card", open_chat_id: "chat" },
        action: { value: { artemisApprovalToken: "token", decision: "yes" } },
      },
    };
    await expect(f.push(input)).rejects.toThrow("could not be saved");
    expect(await f.push(input)).toMatchObject({ toast: { type: "success" } });
    expect(receiveCard).toHaveBeenLastCalledWith({
      header: expect.objectContaining({
        app_id: "app",
        tenant_key: "tenant",
        event_id: "evt",
      }),
      event: expect.objectContaining(input.event),
    });
    await f.push({ ...input, header: { ...input.header, app_id: "other" } });
    expect(receiveCard).toHaveBeenCalledTimes(2);
    expect(f.receive).not.toHaveBeenCalled();
    f.adapter.stop();
  });
});
