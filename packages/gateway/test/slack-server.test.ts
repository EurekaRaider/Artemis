import { afterEach, expect, it, vi } from "vitest";
import { ArtemisGateway } from "../src/server.js";
import { normalizeSlack } from "../src/slack.js";
import type { ChannelEvent } from "@artemis/protocol";

let gateway: ArtemisGateway | undefined;
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  vi.restoreAllMocks();
});
it("provisions Slack from two tokens, binds identity, and persists redelivery only once", async () => {
  const originalFetch = globalThis.fetch;
  let team = "T1",
    app = "A1",
    receive!: (event: ChannelEvent) => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).startsWith("https://slack.com/api/auth.test"))
      return Response.json({
        ok: true,
        team_id: team,
        user_id: "Ubot",
        bot_id: "B1",
      });
    if (String(url).startsWith("https://slack.com/api/bots.info"))
      return Response.json({
        ok: true,
        bot: { id: "B1", user_id: "Ubot", app_id: app },
      });
    return originalFetch(url, init);
  });
  gateway = new ArtemisGateway({
    databasePath: ":memory:",
    adminToken: "a".repeat(32),
    encryptionKey: "e".repeat(32),
    adapterFactory(config, callback) {
      receive = callback;
      return {
        start() {},
        stop() {},
        status: () => ({
          id: config.id,
          name: config.name,
          channel: config.channel,
          state: "connected",
        }),
        send: async () => "123.4",
        attachment: async () => {
          throw new Error("No file");
        },
      };
    },
  });
  const url = `http://127.0.0.1:${await gateway.listen(0)}`;
  const setup = {
    channel: "slack",
    enabled: true,
    botToken: "xoxb-test",
    appToken: "xapp-test",
  };
  const save = (extra = {}) =>
    fetch(`${url}/v1/admin/connections`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
      body: JSON.stringify({ ...setup, ...extra }),
    });
  expect((await save()).status).toBe(200);
  const sealed = gateway.store.get<{ sealed: string }>(
    "connections",
    "slack",
  )!.sealed;
  expect(sealed).not.toContain(setup.botToken);
  const config = gateway.store.unseal<any>(sealed);
  expect(config).toMatchObject({
    id: "slack",
    channel: "slack",
    tenantId: "T1",
    appId: "A1",
    botUserId: "Ubot",
  });
  const device = gateway.store.register("Alice");
  const event = normalizeSlack(config, {
    type: "event_callback",
    team_id: team,
    api_app_id: app,
    event_id: "Ev1",
    event: {
      type: "message",
      channel_type: "im",
      channel: "D1",
      user: "U1",
      ts: String(Date.now() / 1000),
      text: `pair ${gateway.store.pairCode(device.id)}`,
    },
  })!;
  receive(event);
  receive(event);
  await gateway.tick();
  expect(gateway.store.list("identities")).toHaveLength(1);
  expect((await save({ id: "duplicate" })).status).toBe(400);
  team = "T2";
  expect((await save({ id: "same-app-other-team" })).status).toBe(400);
  app = "A2";
  expect((await save()).status).toBe(400);
  expect(
    gateway.store.unseal<any>(
      gateway.store.get<{ sealed: string }>("connections", "slack")!.sealed,
    ).appId,
  ).toBe("A1");
});
