import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelRateLimit, DeliveryUncertain } from "../src/channels.js";
import {
  normalizeSlack,
  resolveSlackConnection,
  SlackAdapter,
} from "../src/slack.js";

const sockets = vi.hoisted(() => [] as any[]);
vi.mock("ws", () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    ping = vi.fn();
    close = vi.fn(() => this.emit("close"));
    terminate = this.close;
    constructor() {
      super();
      sockets.push(this);
    }
  },
}));
const config = {
  channel: "slack" as const,
  id: "slack",
  name: "Slack",
  enabled: true,
  tenantId: "T1",
  appId: "A1",
  botUserId: "Ubot",
  botToken: "xoxb-test",
  appToken: "xapp-test",
};
function payload(event: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T1",
    api_app_id: "A1",
    event_id: "Ev1",
    event: {
      type: "message",
      channel_type: "im",
      user: "U1",
      channel: "D1",
      ts: "1780000000.123",
      text: "pair abc",
      ...event,
    },
  };
}
const adapters: SlackAdapter[] = [];
afterEach(() => {
  adapters.splice(0).forEach((a) => a.stop());
  sockets.length = 0;
  vi.restoreAllMocks();
});
function api() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("auth.test"))
      return Response.json({
        ok: true,
        team_id: "T1",
        user_id: "Ubot",
        bot_id: "B1",
      });
    if (String(url).includes("bots.info"))
      return Response.json({
        ok: true,
        bot: { id: "B1", app_id: "A1", user_id: "Ubot" },
      });
    return Response.json({
      ok: true,
      url: "wss://wss-primary.slack.com/link?ticket=test",
    });
  });
}
describe("Slack Socket Mode", () => {
  it("normalizes private commands and preserves the authenticated identity", () => {
    expect(normalizeSlack(config, payload())).toMatchObject({
      messageId: "Ev1",
      identity: {
        channel: "slack",
        connectionId: "slack",
        tenantId: "T1",
        appId: "A1",
        userId: "U1",
      },
      conversation: { kind: "direct", id: "D1" },
      text: "/pair abc",
      bot: false,
    });
    expect(
      normalizeSlack(config, payload({ text: "Explain this project" }))?.text,
    ).toBe("Explain this project");
  });
  it("rejects other workspaces, apps, bots, edited messages and unaddressed groups", () => {
    for (const value of [
      { ...payload(), team_id: "T2" },
      { ...payload(), api_app_id: "A2" },
      payload({ bot_id: "B2" }),
      payload({ user: "Ubot" }),
      payload({ subtype: "message_changed" }),
      payload({ channel_type: "channel", channel: "C1" }),
      payload({
        type: "app_mention",
        channel_type: "channel",
        text: "<@other> new task",
      }),
    ])
      expect(normalizeSlack(config, value)).toBeUndefined();
    expect(
      normalizeSlack(
        config,
        payload({
          type: "app_mention",
          channel_type: "channel",
          channel: "C1",
          text: "<@Ubot> new task",
          thread_ts: "123.4",
        }),
      ),
    ).toMatchObject({
      text: "/new task",
      mentioned: true,
      replyTo: "123.4",
      conversation: { kind: "group" },
    });
  });
  it("discovers workspace and bot IDs from credentials instead of trusting submitted IDs", async () => {
    api();
    const resolved = await resolveSlackConnection({
      channel: "slack",
      enabled: true,
      botToken: config.botToken,
      appToken: config.appToken,
    });
    expect(resolved).toMatchObject(config);
    await expect(
      resolveSlackConnection({ ...config, tenantId: "T2" }),
    ).rejects.toThrow("identity");
  });
  it("acknowledges an event only after handing it to the durable receiver and reconnects safely", async () => {
    api();
    const receive = vi.fn();
    const adapter = new SlackAdapter(config, receive);
    adapters.push(adapter);
    adapter.start();
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    const socket = sockets[0];
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "hello", connection_info: { app_id: "A1" } }),
      ),
    );
    expect(adapter.status().state).toBe("connected");
    const envelope = {
      type: "events_api",
      envelope_id: "envelope",
      payload: payload(),
    };
    socket.emit("message", Buffer.from(JSON.stringify(envelope)));
    expect(receive).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ envelope_id: "envelope" }),
    );
    expect(receive.mock.invocationCallOrder[0]).toBeLessThan(
      socket.send.mock.invocationCallOrder[0],
    );
    receive.mockImplementationOnce(() => {
      throw new Error("storage unavailable");
    });
    socket.send.mockClear();
    socket.emit("message", Buffer.from(JSON.stringify(envelope)));
    expect(socket.send).not.toHaveBeenCalled();
    adapter.stop();
    expect(adapter.status().state).toBe("disabled");
  });
  it("rejects an app token from another Slack app before accepting events", async () => {
    api();
    const receive = vi.fn();
    const adapter = new SlackAdapter(config, receive);
    adapters.push(adapter);
    adapter.start();
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    sockets[0].emit(
      "message",
      Buffer.from(
        JSON.stringify({ type: "hello", connection_info: { app_id: "A2" } }),
      ),
    );
    sockets[0].emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "events_api",
          envelope_id: "bad",
          payload: payload(),
        }),
      ),
    );
    expect(receive).not.toHaveBeenCalled();
    expect(adapter.status().state).toBe("error");
  });
  it("does not open a socket after stopping during credential verification", async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const adapter = new SlackAdapter(config, () => {});
    adapters.push(adapter);
    adapter.start();
    adapter.stop();
    finish(
      Response.json({ ok: true, team_id: "T1", user_id: "Ubot", bot_id: "B1" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sockets).toHaveLength(0);
  });
  it("sends plain text without broadcast mentions and updates the same status message", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ ok: true, ts: "123.4" }));
    const adapter = new SlackAdapter(config, () => {});
    adapters.push(adapter);
    const conversation = {
      connectionId: "slack",
      kind: "direct" as const,
      id: "D1",
    };
    expect(
      await adapter.send(conversation, "<!channel> /approve code yes", "key"),
    ).toBe("123.4");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      mrkdwn: false,
      parse: "none",
      link_names: false,
      text: "&lt;!channel&gt; approve code yes",
      unfurl_links: false,
    });
    await adapter.statusCard(conversation, "done", "update", "123.4");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("chat.update");
    expect(
      JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).client_msg_id,
    ).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).ts).toBe("123.4");
  });
  it("retries rate limits but does not replay uncertain sends", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response("", { status: 429, headers: { "retry-after": "4" } }),
      );
    const adapter = new SlackAdapter(config, () => {});
    adapters.push(adapter);
    const conversation = {
      connectionId: "slack",
      kind: "direct" as const,
      id: "D1",
    };
    await expect(adapter.send(conversation, "x", "k")).rejects.toBeInstanceOf(
      ChannelRateLimit,
    );
    fetch.mockRejectedValueOnce(new Error("reset"));
    await expect(adapter.send(conversation, "x", "k")).rejects.toBeInstanceOf(
      DeliveryUncertain,
    );
    fetch.mockResolvedValueOnce(
      Response.json({ ok: false, error: "internal_error" }),
    );
    await expect(adapter.send(conversation, "x", "k")).rejects.toBeInstanceOf(
      DeliveryUncertain,
    );
  });
  it("downloads only Slack-hosted file URLs without following redirects with the bot token", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        ok: true,
        file: { url_private_download: "https://evil.example/file" },
      }),
    );
    const adapter = new SlackAdapter(config, () => {});
    adapters.push(adapter);
    const event = normalizeSlack(
      config,
      payload({
        files: [{ id: "F1", name: "test.txt", mimetype: "text/plain" }],
      }),
    )!;
    await expect(adapter.attachment(event, 0)).rejects.toThrow("origin");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(
      Response.json({
        ok: true,
        file: { url_private_download: "https://files.slack.com/file" },
      }),
    );
    fetch.mockResolvedValueOnce(
      new Response("hello", { headers: { "content-type": "text/plain" } }),
    );
    expect((await adapter.attachment(event, 0)).data.toString()).toBe("hello");
    expect(fetch.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
  });
});
