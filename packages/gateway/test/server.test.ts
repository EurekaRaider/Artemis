import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  const stop = vi.fn();
  const gateway = new ArtemisGateway({
    databasePath: ":memory:",
    encryptionKey: "e".repeat(32),
    adminToken: "a".repeat(32),
    adapterFactory: (config, callback) => {
      receive = callback;
      return {
        start() {},
        stop,
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
    "x-artemis-security-version": "2",
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
    stop,
    receive: (event: ChannelEvent) => receive!(event),
    downloads: () => downloads,
  };
}
describe("Gateway lifecycle and delivery authorization", () => {
  it("requires security capability and drops queued output after grant revocation", async () => {
    const f = await fixture();
    const oldHeaders = { ...f.headers, "x-artemis-security-version": "1" };
    expect(
      (await fetch(`${f.url}/v1/device/inbox`, { headers: oldHeaders })).ok,
    ).toBe(false);
    const security = {
      version: 2,
      projectId: "project",
      revision: "revision",
      audience: "owner",
    };
    const setPolicy = async (grants: unknown[]) => {
      const response = await fetch(`${f.url}/v1/device/security`, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({ version: 2, grants }),
      });
      expect(response.ok).toBe(true);
    };
    await setPolicy([
      { ...security, expiresAt: Date.now() + 60000, version: undefined },
    ]);
    f.gateway.router.ingest(f.input);
    f.gateway.router.processIncoming();
    const invocation =
      f.gateway.store.list<RemoteInvocationContext>("invocations")[0]!;
    const send = (revision: string, id: string) =>
      fetch(`${f.url}/v1/device/reply`, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify({
          version: 1,
          id,
          invocationId: invocation.id,
          taskId: "task",
          text: "PRIVATE_QUEUED_SENTINEL",
          final: true,
          security: { ...security, revision },
        }),
      });
    expect((await send("forged", "bad")).ok).toBe(false);
    expect((await send("revision", "valid")).ok).toBe(true);
    await setPolicy([]);
    await f.gateway.tick();
    expect(f.sent.join("\n")).not.toContain("PRIVATE_QUEUED_SENTINEL");
    expect((await send("revision", "replay")).ok).toBe(false);
  });
  it("opens idle group contexts only for confirmed paired members and lets only administrators remove a space", async () => {
    const f = await fixture();
    const endpoint = {
      ...f.input.conversation,
      id: "group",
      kind: "group" as const,
    };
    const space = {
      id: "team",
      revision: "v1",
      name: "Team",
      endpoints: [endpoint],
      participants: [
        { deviceId: f.device.id, identity: f.input.identity, name: "Alice" },
      ],
      administrators: [f.input.identity],
    };
    f.gateway.store.put("spaces", space.id, space);
    const open = (headers = f.headers) =>
      fetch(`${f.url}/v1/device/group-context`, {
        method: "POST",
        headers,
        body: JSON.stringify({ spaceId: space.id }),
      });
    expect((await open()).status).toBe(400);
    f.gateway.store.put("space-confirmations", space.id, [
      imConversationKey(endpoint),
    ]);
    const request = await (await open()).json();
    expect(request).toMatchObject({
      deviceId: f.device.id,
      conversation: { spaceId: space.id },
      text: "",
    });
    expect(f.gateway.store.pending("device")).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
    const other = f.gateway.store.register("Other");
    expect(
      (
        await open({
          ...f.headers,
          authorization: `Bearer ${other.token}`,
          "x-artemis-device": other.id,
        })
      ).status,
    ).toBe(400);
    const otherIdentity = { ...f.input.identity, userId: "Other" };
    f.gateway.store.pair(f.gateway.store.pairCode(other.id), otherIdentity);
    f.gateway.store.put("spaces", space.id, {
      ...space,
      participants: [
        ...space.participants,
        { deviceId: other.id, identity: otherIdentity, name: "Other" },
      ],
    });
    const removeMember = (headers: Record<string, string>, deviceId: string) =>
      fetch(`${f.url}/v1/admin/remove-space-member`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ spaceId: space.id, deviceId }),
      });
    expect((await removeMember(f.headers, f.device.id)).status).toBe(401);
    expect(f.gateway.router.isInvocationAuthorized(request)).toBe(true);
    expect(
      (
        await removeMember(
          { authorization: `Bearer ${"a".repeat(32)}` },
          f.device.id,
        )
      ).status,
    ).toBe(200);
    expect(f.gateway.router.isInvocationAuthorized(request)).toBe(false);
    expect(
      f.gateway.router.findSpace(endpoint)?.participants.map((p) => p.deviceId),
    ).toEqual([other.id]);
    expect(
      (
        await removeMember(
          { authorization: `Bearer ${"a".repeat(32)}` },
          other.id,
        )
      ).status,
    ).toBe(400);
    const remove = (headers: Record<string, string>) =>
      fetch(`${f.url}/v1/admin/remove-space`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ id: space.id }),
      });
    expect((await remove(f.headers)).status).toBe(401);
    expect(
      (await remove({ authorization: `Bearer ${"a".repeat(32)}` })).status,
    ).toBe(200);
    expect(f.gateway.router.isInvocationAuthorized(request)).toBe(false);
    expect((await open()).status).toBe(400);
    expect(
      f.gateway.store.get("space-confirmations", space.id),
    ).toBeUndefined();
    expect(f.gateway.store.get("connections", "wecom")).toBeDefined();
    const resave = await fetch(`${f.url}/v1/admin/spaces`, {
      method: "PUT",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      body: JSON.stringify({
        id: space.id,
        name: space.name,
        endpoints: space.endpoints,
        participants: space.participants,
        administrators: space.administrators,
      }),
    });
    expect(resave.status).toBe(400);
    expect((await resave.json()).error).toContain("空间 ID 已删除");
  });
  it("removes a connection only for administrators, revokes pairing, and never reuses its routing ID", async () => {
    const f = await fixture();
    const pendingDevice = f.gateway.store.register("Pending");
    const pending = f.gateway.store.requestPair(
      f.gateway.store.pairCode(pendingDevice.id, Date.now(), true),
      { ...f.input.identity, userId: "pending" },
      f.input.conversation,
    )!;
    f.gateway.store.put(
      "direct-routes",
      imIdentityKey(f.input.identity),
      f.input.conversation,
    );
    const remove = (headers: Record<string, string>) =>
      fetch(`${f.url}/v1/admin/remove-connection`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ id: "wecom" }),
      });
    expect((await remove(f.headers)).status).toBe(401);
    expect(f.gateway.store.get("connections", "wecom")).toBeDefined();
    expect(
      (await remove({ authorization: `Bearer ${"a".repeat(32)}` })).status,
    ).toBe(200);
    expect(f.gateway.store.get("connections", "wecom")).toBeUndefined();
    expect(
      f.gateway.store.get("identities", imIdentityKey(f.input.identity)),
    ).toBeUndefined();
    expect(
      f.gateway.store.get("direct-routes", imIdentityKey(f.input.identity)),
    ).toBeUndefined();
    expect(() =>
      f.gateway.store.resolvePairRequest(pendingDevice.id, pending.id, true),
    ).toThrow();
    const status = await (
      await fetch(`${f.url}/v1/device/status`, { headers: f.headers })
    ).json();
    expect(status.connections).toEqual([]);
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(status.identities).toEqual([]);
    f.receive({ ...f.input, messageId: "late-after-removal" });
    expect(
      f.gateway.store.get("direct-routes", imIdentityKey(f.input.identity)),
    ).toBeUndefined();
    const resave = await fetch(`${f.url}/v1/admin/connections`, {
      method: "PUT",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      body: JSON.stringify({
        id: "wecom",
        channel: "wecom",
        name: "Replacement",
        tenantId: "other",
        enabled: true,
        botId: "other",
        secret: "secret",
      }),
    });
    expect(resave.status).toBe(400);
    expect((await resave.json()).error).toContain("连接 ID");
  });

  it("excludes HTTPS ingress while a Feishu socket owns the connection and preserves identity on transport rollback", async () => {
    const f = await fixture();
    const config = {
      id: "feishu",
      name: "Feishu",
      channel: "feishu",
      tenantId: "tenant",
      appId: "app",
      botOpenId: "bot",
      appSecret: "secret",
      enabled: true,
      transport: "websocket",
      domain: "lark",
    };
    const save = (value: unknown) =>
      fetch(`${f.url}/v1/admin/connections`, {
        method: "PUT",
        headers: { authorization: `Bearer ${"a".repeat(32)}` },
        body: JSON.stringify(value),
      });
    expect((await save(config)).ok).toBe(true);
    expect(
      (
        await fetch(`${f.url}/channels/feishu/feishu`, {
          method: "POST",
          body: JSON.stringify({
            type: "url_verification",
            challenge: "challenge",
            token: "token",
          }),
        })
      ).ok,
    ).toBe(false);
    const status = await (
      await fetch(`${f.url}/v1/device/status`, { headers: f.headers })
    ).json();
    expect(
      status.connections.find((c: any) => c.id === "feishu").configuration,
    ).toMatchObject({ transport: "websocket", domain: "lark" });
    expect(JSON.stringify(status)).not.toContain('"appSecret"');
    expect((await save({ ...config, id: "duplicate" })).ok).toBe(false);
    expect((await save({ ...config, appId: "other" })).ok).toBe(false);
    expect(
      (
        await save({
          ...config,
          transport: "webhook",
          verificationToken: "token",
          encryptKey: "encrypt",
        })
      ).ok,
    ).toBe(true);
    const challenge = await fetch(`${f.url}/channels/feishu/feishu`, {
      method: "POST",
      body: JSON.stringify({
        type: "url_verification",
        challenge: "challenge",
        token: "token",
      }),
    });
    expect(await challenge.json()).toEqual({ challenge: "challenge" });
  });
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
