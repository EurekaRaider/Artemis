import { describe, expect, it, vi } from "vitest";
import { normalizeFeishuGroupEvent } from "../src/feishu-group-events.js";
import { EventDispatcher, type WSClient } from "@larksuiteoapi/node-sdk";
import {
  channelConnectionSchema,
  type ChannelConnection,
} from "../src/channels.js";
import { FeishuSocketAdapter } from "../src/feishu-socket.js";
import { resolveFeishuConnection } from "../src/feishu-setup.js";

/**
 * Policy boundary for scan-minted Feishu apps (PersonalAgent archetype has no
 * tenant:info:readonly): a websocket connection may start without a tenant id
 * because the subscription itself is authenticated by app credentials. The
 * tenant key is adopted from the first authenticated event and pinned; every
 * other transport still requires an explicit tenant id up front.
 */

const scanConnection = {
  id: "feishu-scan",
  name: "Scan app",
  channel: "feishu",
  tenantId: "",
  appId: "app",
  botOpenId: "bot",
  appSecret: "secret",
  enabled: true,
  transport: "websocket",
} as const;

describe("scan-to-register tenant policy", () => {
  it("uses the persisted tenant for group lifecycle events and retries a failed pin", async () => {
    let dispatcher: EventDispatcher;
    const config = { ...scanConnection } as Extract<
      ChannelConnection,
      { channel: "feishu" }
    >;
    const normalized = vi.fn();
    const persist = vi.fn().mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    const adapter = new FeishuSocketAdapter(
      config,
      vi.fn(),
      () =>
        ({
          start: async (params: { eventDispatcher: EventDispatcher }) => {
            dispatcher = params.eventDispatcher;
          },
          close: vi.fn(),
          getConnectionStatus: () => ({
            state: "connected",
            reconnect_attempts: 0,
          }),
        }) as Pick<WSClient, "start" | "close" | "getConnectionStatus">,
      undefined,
      (value) => normalized(normalizeFeishuGroupEvent(config, value)),
      persist,
    );
    adapter.start();
    const push = (app_id: string, tenant_key: string) =>
      dispatcher!.invoke(
        {
          schema: "2.0",
          header: {
            app_id,
            tenant_key,
            event_id: "group-event",
            event_type: "im.chat.disbanded_v1",
            create_time: String(Date.now()),
          },
          event: { chat_id: "chat" },
        },
        { needCheck: false },
      );
    await push("wrong-app", "adopted");
    await push("app", "");
    expect(persist).not.toHaveBeenCalled();
    await expect(push("app", "adopted")).rejects.toThrow();
    expect(normalized).not.toHaveBeenCalled();
    expect(adapter.status().state).toBe("error");
    await push("app", "adopted");
    expect(persist).toHaveBeenCalledTimes(2);
    expect(normalized).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: "chat", unavailable: "dissolved" }),
    );
    expect(adapter.status().state).toBe("connected");
    await push("app", "intruder");
    expect(normalized).toHaveBeenCalledTimes(1);
    adapter.stop();
  });
  it("accepts an empty tenant id only for feishu websocket connections", () => {
    expect(channelConnectionSchema.parse(scanConnection)).toMatchObject({
      tenantId: "",
    });
    expect(() =>
      channelConnectionSchema.parse({
        ...scanConnection,
        transport: "webhook",
      }),
    ).toThrow();
    expect(() =>
      channelConnectionSchema.parse({
        ...scanConnection,
        channel: "wecom",
        botId: "b",
        secret: "s",
      }),
    ).toThrow();
  });

  it("keeps requiring the tenant id for slack", () => {
    expect(() =>
      channelConnectionSchema.parse({
        id: "s",
        name: "S",
        channel: "slack",
        tenantId: "",
        appId: "a",
        botUserId: "u",
        botToken: "xoxb-t",
        appToken: "xapp-t",
        enabled: true,
      }),
    ).toThrow();
  });

  it("skips the tenant query for websocket connections and keeps bot resolution", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("auth/v3/tenant_access_token/internal"))
        return {
          ok: true,
          json: async () => ({ code: 0, tenant_access_token: "t" }),
        } as Response;
      if (String(url).endsWith("bot/v3/info"))
        return {
          ok: true,
          json: async () => ({ code: 0, bot: { open_id: "ou_bot" } }),
        } as Response;
      throw new Error(`unexpected fetch ${String(url)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const connection = await resolveFeishuConnection({
      ...scanConnection,
      tenantId: undefined,
      botOpenId: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls)
      expect(String(call[0])).not.toContain("tenant/v2/tenant/query");
    expect(connection).toMatchObject({
      tenantId: "",
      botOpenId: "ou_bot",
      transport: "websocket",
    });
    vi.unstubAllGlobals();
  });

  it("adopts the tenant key from the first authenticated event and pins it", async () => {
    let dispatcher: EventDispatcher;
    const receive = vi.fn();
    const onTenantResolved = vi.fn();
    const adapter = new FeishuSocketAdapter(
      { ...scanConnection } as Extract<
        ChannelConnection,
        { channel: "feishu" }
      >,
      receive,
      () =>
        ({
          start: async (params: { eventDispatcher: EventDispatcher }) => {
            dispatcher = params.eventDispatcher;
          },
          close: vi.fn(),
          getConnectionStatus: () => ({
            state: "connected",
            reconnect_attempts: 0,
          }),
        }) as Pick<WSClient, "start" | "close" | "getConnectionStatus">,
      undefined,
      undefined,
      onTenantResolved,
    );
    adapter.start();
    const push = (tenant_key: string) =>
      dispatcher!.invoke(
        {
          schema: "2.0",
          header: {
            app_id: "app",
            tenant_key,
            event_id: `evt-${tenant_key}`,
            event_type: "im.message.receive_v1",
          },
          event: {
            sender: { sender_type: "user", sender_id: { open_id: "alice" } },
            message: {
              message_id: "message",
              chat_id: "chat",
              chat_type: "p2p",
              create_time: "1000",
              message_type: "text",
              content: JSON.stringify({ text: "hi" }),
            },
          },
        },
        { needCheck: false },
      );
    await push("adopted");
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0]![0].identity.tenantId).toBe("adopted");
    expect(onTenantResolved).toHaveBeenCalledWith("adopted");
    // A different tenant must be dropped after the pin.
    await push("intruder");
    expect(receive).toHaveBeenCalledTimes(1);
    adapter.stop();
  });
});
