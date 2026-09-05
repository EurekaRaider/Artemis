import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  imConversationKey,
  imIdentityKey,
  type ChannelEvent,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { ArtemisGateway } from "../src/server.js";

const gateways: ArtemisGateway[] = [];
afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.close();
});
async function fixture(withCards = false) {
  const sent: string[] = [];
  const cards: Array<{ text: string; messageId: string | undefined }> = [];
  let receive: ((event: ChannelEvent) => void) | undefined;
  let downloads = 0;
  const gateway = new ArtemisGateway({
    databasePath: ":memory:",
    encryptionKey: "e".repeat(32),
    adminToken: "a".repeat(32),
    adapterFactory: (config, callback) => {
      receive = callback;
      return {
        start() {},
        stop() {},
        status: () => ({
          id: config.id,
          channel: config.channel,
          name: config.name,
          state: "connected" as const,
        }),
        send: async (_conversation, text) => {
          sent.push(text);
          return randomUUID();
        },
        ...(withCards
          ? {
              statusCard: async (
                _conversation: unknown,
                text: string,
                _key: string,
                messageId?: string,
              ) => {
                cards.push({ text, messageId });
                return "card-id";
              },
            }
          : {}),
        attachment: async () => {
          downloads++;
          return {
            data: Buffer.from("preserved file"),
            name: "file.txt",
            mimeType: "text/plain",
          };
        },
      };
    },
  });
  gateways.push(gateway);
  const url = `http://127.0.0.1:${await gateway.listen(0)}`;
  await fetch(`${url}/v1/admin/connections`, {
    method: "PUT",
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
    body: JSON.stringify({
      id: "wecom",
      channel: "wecom",
      name: "test",
      tenantId: "tenant",
      enabled: true,
      botId: "bot",
      secret: "secret",
    }),
  });
  const device = gateway.store.register("Alice");
  const headers = {
    authorization: `Bearer ${device.token}`,
    "x-artemis-device": device.id,
    "x-artemis-session": randomUUID(),
  };
  const input: ChannelEvent = {
    version: 1,
    messageId: "input",
    identity: {
      channel: "wecom",
      connectionId: "wecom",
      tenantId: "tenant",
      appId: "bot",
      userId: "alice",
    },
    conversation: { connectionId: "wecom", kind: "direct", id: "alice" },
    text: "hello",
    attachments: [],
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
  };
  gateway.store.pair(gateway.store.pairCode(device.id), input.identity);
  return {
    gateway,
    url,
    device,
    headers,
    input,
    sent,
    cards,
    receive: (event: ChannelEvent) => receive!(event),
    downloads: () => downloads,
  };
}
describe("Gateway lifecycle and delivery authorization", () => {
  it("exposes only public credential identifiers and confirms pending pairing through the owning device API", async () => {
    const f = await fixture();
    const post = (path: string, body: unknown, headers = f.headers) =>
      fetch(`${f.url}/v1/device/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    await post("unpair", f.input.identity);
    const { code } = await (
      await post("pair", { requireConfirmation: true })
    ).json();
    f.receive({ ...f.input, messageId: "pending-pair", text: `/pair ${code}` });
    await f.gateway.tick();
    const status = await (
      await fetch(`${f.url}/v1/device/status`, { headers: f.headers })
    ).json();
    expect(status.identities).toEqual([]);
    expect(status.pairingRequests).toHaveLength(1);
    expect(status.connections[0].configuration).toEqual({
      id: "wecom",
      name: "test",
      tenantId: "tenant",
      botId: "bot",
    });
    expect(status.connections[0].configuration).not.toHaveProperty("secret");
    const other = f.gateway.store.register("Other device");
    const otherHeaders = {
      ...f.headers,
      "x-artemis-device": other.id,
      authorization: `Bearer ${other.token}`,
    };
    const requestId = status.pairingRequests[0].id;
    expect(
      (
        await post(
          "resolve-pairing",
          { requestId, approve: true },
          otherHeaders,
        )
      ).ok,
    ).toBe(false);
    expect(
      (await post("resolve-pairing", { requestId, approve: true })).ok,
    ).toBe(true);
    const updated = await (
      await fetch(`${f.url}/v1/device/status`, { headers: f.headers })
    ).json();
    expect(updated.identities).toEqual([f.input.identity]);
    expect(updated.pairingRequests).toEqual([]);
    f.gateway.store.delete("throttle", imConversationKey(f.input.conversation));
    await f.gateway.tick();
    await expect
      .poll(() => f.sent.some((text) => text.includes("配对成功")))
      .toBe(true);
    expect(
      (await post("resolve-pairing", { requestId, approve: false })).ok,
    ).toBe(false);
  });
  it("prevents reusing a connection ID for a different tenant or bot while allowing secret rotation", async () => {
    const f = await fixture();
    const config = {
      id: "wecom",
      channel: "wecom",
      name: "test",
      tenantId: "tenant",
      enabled: true,
      botId: "bot",
      secret: "rotated",
    };
    const save = (value: unknown) =>
      fetch(`${f.url}/v1/admin/connections`, {
        method: "PUT",
        headers: { authorization: `Bearer ${"a".repeat(32)}` },
        body: JSON.stringify(value),
      });
    expect((await save({ ...config, tenantId: "different" })).status).toBe(400);
    expect((await save({ ...config, botId: "another-bot" })).status).toBe(400);
    expect((await save(config)).status).toBe(200);
  });
  it("lets administrators discover a mentioned group without activating it or starting a task", async () => {
    const f = await fixture();
    const conversation = {
      ...f.input.conversation,
      id: "target-group",
      kind: "group" as const,
    };
    f.gateway.router.ingest({ ...f.input, text: "/help", conversation });
    f.gateway.router.processIncoming();
    const status = await (
      await fetch(`${f.url}/v1/admin/status`, {
        headers: { authorization: `Bearer ${"a".repeat(32)}` },
      })
    ).json();
    expect(status.groups).toMatchObject([{ conversation }]);
    expect(status.spaces).toEqual([]);
    expect(f.gateway.store.pending("device")).toHaveLength(0);
    expect((await fetch(`${f.url}/v1/admin/status`)).status).toBe(401);
  });
  it("persists the task card ID, updates it for completion and preserves the final answer separately", async () => {
    const f = await fixture(true);
    await fetch(`${f.url}/v1/device/status`, { headers: f.headers });
    f.gateway.router.ingest(f.input);
    f.gateway.router.processIncoming();
    const invocationId =
      f.gateway.store.list<RemoteInvocationContext>("invocations")[0]!.id;
    f.gateway.router.receiveReply(f.device.id, {
      version: 1,
      id: "start",
      invocationId,
      taskId: "task",
      text: "正在执行",
      started: true,
      status: "running",
    });
    await f.gateway.tick();
    expect(f.cards).toEqual([{ text: "正在执行", messageId: undefined }]);
    f.gateway.store.delete("throttle", imConversationKey(f.input.conversation));
    f.gateway.router.receiveReply(f.device.id, {
      version: 1,
      id: "finish",
      invocationId,
      taskId: "task",
      text: "final answer",
      final: true,
      outcome: "completed",
      status: "completed",
    });
    await f.gateway.tick();
    expect(f.cards[1]).toEqual({
      text: "任务 task\n已完成",
      messageId: "card-id",
    });
    f.gateway.store.delete("throttle", imConversationKey(f.input.conversation));
    await f.gateway.tick();
    expect(f.sent).toEqual(["final answer"]);
    expect(f.gateway.store.get("message-map", "wecom:card-id")).toEqual({
      deviceId: f.device.id,
      taskId: "task",
    });
  });
  it("leases a device to one process and allows takeover only after release or expiry", async () => {
    const f = await fixture();
    expect(
      (await fetch(`${f.url}/v1/device/status`, { headers: f.headers })).status,
    ).toBe(200);
    const other = { ...f.headers, "x-artemis-session": randomUUID() };
    expect(
      (await fetch(`${f.url}/v1/device/inbox`, { headers: other })).status,
    ).toBe(409);
    expect(
      (
        await fetch(`${f.url}/v1/device/release`, {
          method: "POST",
          headers: f.headers,
        })
      ).status,
    ).toBe(200);
    expect(
      (await fetch(`${f.url}/v1/device/status`, { headers: other })).status,
    ).toBe(200);
    f.gateway.store.put("device-leases", f.device.id, {
      sessionId: other["x-artemis-session"],
      expiresAt: 0,
    });
    expect(
      (await fetch(`${f.url}/v1/device/status`, { headers: f.headers })).status,
    ).toBe(200);
  });
  it("rechecks unpairing before a persisted answer is sent", async () => {
    const f = await fixture();
    f.gateway.router.ingest(f.input);
    f.gateway.router.processIncoming();
    const request =
      f.gateway.store.list<RemoteInvocationContext>("invocations")[0]!;
    f.gateway.router.receiveReply(f.device.id, {
      version: 1,
      id: "final",
      invocationId: request.id,
      text: "private answer",
      final: true,
    });
    f.gateway.store.delete("identities", imIdentityKey(f.input.identity));
    await f.gateway.tick();
    expect(f.sent).not.toContain("private answer");
  });
  it("invalidates queued group requests and shares when the approved space changes", async () => {
    const f = await fixture();
    const group = {
      connectionId: "wecom",
      kind: "group" as const,
      id: "group",
    };
    const space = {
      id: "space",
      revision: "old",
      name: "Team",
      endpoints: [group],
      participants: [
        { deviceId: f.device.id, identity: f.input.identity, name: "Alice" },
      ],
    };
    f.gateway.store.put("spaces", space.id, space);
    f.gateway.store.put("space-confirmations", space.id, [
      imConversationKey(group),
    ]);
    f.gateway.router.ingest({ ...f.input, conversation: group });
    f.gateway.router.processIncoming();
    const request =
      f.gateway.store.list<RemoteInvocationContext>("invocations")[0]!;
    f.gateway.router.receiveReply(f.device.id, {
      version: 1,
      id: "final",
      invocationId: request.id,
      text: "old scope answer",
      final: true,
    });
    f.gateway.store.put("spaces", space.id, { ...space, revision: "new" });
    const inbox = await (
      await fetch(`${f.url}/v1/device/inbox`, { headers: f.headers })
    ).json();
    expect(inbox.requests).toEqual([]);
    await f.gateway.tick();
    expect(f.sent.some((text) => text.includes("old scope answer"))).toBe(
      false,
    );
  });
  it("preserves short-lived platform attachments while the desktop is offline", async () => {
    const f = await fixture();
    f.receive({
      ...f.input,
      attachments: [{ resourceId: "resource", name: "file.txt", kind: "file" }],
    });
    await expect.poll(f.downloads).toBe(1);
    await expect.poll(() => f.gateway.store.list("media-cache").length).toBe(1);
    const inbox = await (
      await fetch(`${f.url}/v1/device/inbox`, { headers: f.headers })
    ).json();
    const resource = await fetch(
      `${f.url}/v1/device/attachment?invocationId=${inbox.requests[0].id}&index=0`,
      { headers: f.headers },
    );
    expect(await resource.text()).toBe("preserved file");
    expect(f.downloads()).toBe(1);
  });
});
