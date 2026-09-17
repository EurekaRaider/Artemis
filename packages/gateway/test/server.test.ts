import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imConversationKey,
  imIdentityKey,
  type ChannelEvent,
  type ImGroupRoster,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { saveNativeGroup } from "../src/native-groups.js";
import { ArtemisGateway } from "../src/server.js";

const gateways: ArtemisGateway[] = [];
afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.close();
});
async function fixture(
  withCards = false,
  groupInfo?: () => Promise<{ name?: string; unavailable?: "removed" }>,
  groupMembers?: () => Promise<ImGroupRoster>,
) {
  const sent: string[] = [];
  const mentions: Array<string | undefined> = [];
  const cards: Array<{ text: string; messageId: string | undefined }> = [];
  let receive: ((event: ChannelEvent) => void) | undefined;
  let downloads = 0;
  const stop = vi.fn();
  const published: string[] = [];
  const gateway = new ArtemisGateway({
    databasePath: ":memory:",
    encryptionKey: "e".repeat(32),
    adminToken: "a".repeat(32),
    adapterFactory: (config, callback) => {
      receive = callback;
      return {
        start() {},
        stop,
        ...(groupInfo ? { groupInfo } : {}),
        ...(groupMembers ? { groupMembers } : {}),
        status: () => ({
          id: config.id,
          channel: config.channel,
          name: config.name,
          state: "connected" as const,
        }),
        publish: async (_conversation, file, _key, authorize) => {
          authorize();
          published.push(file.data.toString());
          return "file-message";
        },
        send: async (_conversation, text, _key, mentionUserId) => {
          sent.push(text);
          mentions.push(mentionUserId);
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
    mentions,
    published,
    cards,
    stop,
    receive: (event: ChannelEvent) => receive!(event),
    downloads: () => downloads,
  };
}
describe("Gateway lifecycle and delivery authorization", () => {
  it("passes actionable group status mentions to the adapter as a new message", async () => {
    const f = await fixture(true);
    const conversation = {
      ...f.input.conversation,
      kind: "group" as const,
      id: "room",
    };
    f.gateway.router.ingest({ ...f.input, conversation });
    f.gateway.router.processIncoming();
    saveNativeGroup(f.gateway.store, {
      conversation,
      owner: f.input.identity,
      deviceId: f.device.id,
      name: "Room",
      projectId: "project",
      enabled: true,
    });
    f.gateway.router.ingest({
      ...f.input,
      conversation,
      messageId: "assignment",
      timestamp: Date.now(),
      identity: { ...f.input.identity, userId: "dispatcher" },
    });
    f.gateway.router.processIncoming();
    for (const item of f.gateway.store.pending("outgoing"))
      f.gateway.store.mark("outgoing", item.id, "done");
    const request =
      f.gateway.store.pending<RemoteInvocationContext>("device")[0]!.payload;
    f.gateway.router.receiveReply(f.device.id, {
      version: 1,
      id: "waiting",
      invocationId: request.id,
      taskId: "task",
      text: "请补充目标分支。",
      status: "waiting",
    });
    await f.gateway.tick();
    // The status card may be updated first; the actionable notification is separate.
    f.gateway.store.delete("throttle", imConversationKey(request.conversation));
    await f.gateway.tick();
    expect(f.sent.at(-1)).toContain("请补充目标分支。");
    expect(f.mentions.at(-1)).toBe("dispatcher");
  });
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
  it("returns a retirement error for the legacy space API and still requires admin authentication", async () => {
    const f = await fixture();
    const request = (token: string) =>
      fetch(f.url + "/v1/admin/spaces", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({}),
      });
    expect((await request("invalid")).status).toBe(401);
    expect((await request("a".repeat(32))).status).toBe(410);
    expect(f.gateway.store.list("spaces")).toEqual([]);
  });
  it("removes associated collaboration spaces with a connection and preserves other connections' spaces", async () => {
    const f = await fixture();
    for (const [namespace, id, connectionId] of [
      ["native-groups", "native-selected", "wecom"],
      ["spaces", "legacy-selected", "wecom"],
      ["native-groups", "native-other", "other"],
    ] as const) {
      f.gateway.store.put(namespace, id, {
        id,
        endpoints: [{ connectionId, kind: "group", id: "channel" }],
      });
      f.gateway.store.put("space-confirmations", id, ["confirmed"]);
      f.gateway.store.put("native-group-info", id, { next: 123 });
      const conversation = { connectionId, kind: "group" as const, id };
      f.gateway.store.put("observed-groups", imConversationKey(conversation), {
        conversation,
      });
      f.gateway.store.enqueue("outgoing", id, "offline", {
        conversation: { ...conversation, spaceId: id },
      });
    }
    const remove = (token: string) =>
      fetch(`${f.url}/v1/admin/remove-connection`, {
        method: "PUT",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: "wecom" }),
      });
    expect((await remove("invalid")).status).toBe(401);
    expect(
      f.gateway.store.get("native-groups", "native-selected"),
    ).toBeDefined();
    expect((await remove("a".repeat(32))).status).toBe(200);
    for (const id of ["native-selected", "legacy-selected"]) {
      for (const namespace of [
        "native-groups",
        "spaces",
        "space-confirmations",
        "native-group-info",
      ])
        expect(f.gateway.store.get(namespace, id)).toBeUndefined();
      expect(f.gateway.store.get("removed-spaces", id)).toEqual({ id });
      expect(
        f.gateway.store.get(
          "observed-groups",
          imConversationKey({ connectionId: "wecom", kind: "group", id }),
        ),
      ).toBeUndefined();
    }
    expect(f.gateway.store.get("native-groups", "native-other")).toBeDefined();
    expect(f.gateway.store.get("space-confirmations", "native-other")).toEqual([
      "confirmed",
    ]);
    expect(f.gateway.store.get("native-group-info", "native-other")).toEqual({
      next: 123,
    });
    expect(f.gateway.store.pending("outgoing").map((item) => item.id)).toEqual([
      "native-other",
    ]);
    expect(
      f.gateway.store.get(
        "observed-groups",
        imConversationKey({
          connectionId: "other",
          kind: "group",
          id: "native-other",
        }),
      ),
    ).toBeDefined();
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
  it("rejects legacy group contexts without opening or dispatching a task", async () => {
    const f = await fixture();
    const response = await fetch(f.url + "/v1/device/group-context", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ spaceId: "old-space" }),
    });
    expect(response.ok).toBe(false);
    expect(f.gateway.store.pending("device")).toEqual([]);
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

it("reports native platform receipts by owner, retaining uncertain and partial sends", async () => {
  const f = await fixture();
  f.gateway.store.put("native-groups", "native", {
    id: "native",
    nativeGroup: { ownerDeviceId: f.device.id },
  });
  const request = { ...f.input, id: "invocation", deviceId: f.device.id };
  f.gateway.store.put("invocations", request.id, request);
  const read = async () =>
    fetch(`${f.url}/v1/device/native-deliveries`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ groupId: "native" }),
    });
  for (const [id, state] of [
    ["one", "done"],
    ["two", "pending"],
  ]) {
    f.gateway.store.enqueue("outgoing", id!, "offline", {
      conversation: {
        connectionId: "offline",
        kind: "group",
        id: "room",
        spaceId: "native",
      },
      invocationId: request.id,
      replyId: "logical",
      text: id,
    });
    f.gateway.store.mark("outgoing", id!, state!);
  }
  expect(await (await read()).json()).toEqual({
    version: 1,
    messages: [{ id: "logical", state: "submitted" }],
  });
  f.gateway.store.mark("outgoing", "two", "done");
  expect(await (await read()).json()).toMatchObject({
    messages: [{ state: "platform-accepted" }],
  });
  f.gateway.store.mark("outgoing", "two", "uncertain");
  expect(await (await read()).json()).toMatchObject({
    messages: [{ state: "uncertain" }],
  });
  f.gateway.store.put("native-groups", "native", {
    id: "native",
    nativeGroup: { ownerDeviceId: "another-device" },
  });
  expect((await read()).ok).toBe(false);
});

it("refreshes native names without changing authorization and disables only on platform evidence", async () => {
  const info = vi.fn(
    async (): Promise<{ name?: string; unavailable?: "removed" }> => ({
      name: "Renamed",
    }),
  );
  const f = await fixture(false, info);
  const group = {
    id: "native",
    name: "Old",
    revision: "grant",
    endpoints: [{ connectionId: "wecom", id: "group", kind: "group" }],
    participants: [],
    nativeGroup: { version: 1, enabled: true, ownerDeviceId: f.device.id },
  };
  f.gateway.store.put("native-groups", group.id, group);
  await f.gateway.tick();
  expect(f.gateway.store.get("native-groups", group.id)).toMatchObject({
    name: "Renamed",
    revision: "grant",
    nativeGroup: { enabled: true },
  });
  await f.gateway.tick();
  expect(info).toHaveBeenCalledTimes(1);
  info.mockRejectedValueOnce(new Error("offline"));
  f.gateway.store.delete("native-group-info", group.id);
  await f.gateway.tick();
  expect(f.gateway.store.get("native-groups", group.id)).toMatchObject({
    nativeGroup: { enabled: true },
  });
  info.mockResolvedValueOnce({ unavailable: "removed" });
  f.gateway.store.delete("native-group-info", group.id);
  await f.gateway.tick();
  expect(f.gateway.store.get("native-groups", group.id)).toMatchObject({
    nativeGroup: { enabled: false },
  });
  expect(
    f.gateway.store.get<{ revision: string }>("native-groups", group.id)
      ?.revision,
  ).not.toBe("grant");
});

it("publishes native files through IM with encrypted queue bytes, idempotence and revocation", async () => {
  const f = await fixture();
  const conversation = {
    ...f.input.conversation,
    kind: "group" as const,
    id: "group",
  };
  f.gateway.router.ingest({ ...f.input, conversation });
  f.gateway.router.processIncoming();
  const group = saveNativeGroup(f.gateway.store, {
    conversation,
    owner: f.input.identity,
    deviceId: f.device.id,
    name: "Group",
    projectId: "p",
    enabled: true,
  });
  const security = {
    version: 2,
    projectId: "p",
    revision: "grant",
    audience: `space:${group.id}`,
  };
  const policy = async (grants: unknown[]) =>
    fetch(`${f.url}/v1/device/security`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ version: 2, grants }),
    });
  await policy([
    { ...security, version: undefined, expiresAt: Date.now() + 60000 },
  ]);
  f.gateway.router.ingest({
    ...f.input,
    messageId: "publish",
    conversation,
    text: "/publish task result.txt",
    timestamp: Date.now(),
  });
  f.gateway.router.processIncoming();
  const invocation = f.gateway.store
    .list<RemoteInvocationContext>("invocations")
    .find((i) => i.messageId === "publish")!;
  const body = {
    invocationId: invocation.id,
    security,
    name: "result.txt",
    data: Buffer.from("FILE_SENTINEL").toString("base64"),
  };
  const publish = (payload = body) =>
    fetch(`${f.url}/v1/device/artifacts`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify(payload),
    });
  expect(await (await publish()).json()).toMatchObject({
    native: true,
    state: "queued",
  });
  expect((await publish()).ok).toBe(true);
  expect((await publish({ ...body, name: "other.txt" })).ok).toBe(false);
  const stored = JSON.stringify(f.gateway.store.list("native-files"));
  expect(stored).not.toContain(body.data);
  expect(stored).not.toContain("FILE_SENTINEL");
  expect(f.gateway.store.list("artifacts")).toEqual([]);
  await policy([]);
  await f.gateway.tick();
  expect(f.published).toEqual([]);
});

it("restricts native cooperation state to its owner and rejects obsolete continuation commands", async () => {
  const f = await fixture();
  f.gateway.store.put("native-groups", "group", {
    id: "group",
    nativeGroup: { ownerDeviceId: f.device.id },
  });
  const request = (body: unknown) =>
    fetch(`${f.url}/v1/device/native-cooperation`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify(body),
    });
  expect((await request({ groupId: "group", operation: "state" })).ok).toBe(
    true,
  );
  expect((await request({ groupId: "other", operation: "state" })).ok).toBe(
    false,
  );
  expect((await request({ groupId: "group", operation: "continue" })).ok).toBe(
    false,
  );
});

it("resolves discovered group names before authorization and preserves cached names on lookup failure", async () => {
  const info = vi.fn(async () => ({ name: "Design team" }));
  const f = await fixture(false, info);
  const conversation = {
    connectionId: "wecom",
    id: "observed",
    kind: "group" as const,
  };
  const key = imConversationKey(conversation);
  f.gateway.store.put("observed-groups", key, {
    conversation,
    identities: [],
    lastSeenAt: Date.now(),
  });
  await f.gateway.tick();
  expect(f.gateway.store.get("observed-groups", key)).toMatchObject({
    name: "Design team",
  });
  expect(f.gateway.store.list("native-groups")).toEqual([]);
  const status = await fetch(`${f.url}/v1/admin/status`, {
    headers: { Authorization: `Bearer ${"a".repeat(32)}` },
  }).then((r) => r.json());
  expect(status.groups).toEqual([
    expect.objectContaining({
      platform: "wecom",
      name: "Design team",
      identities: [],
    }),
  ]);

  await f.gateway.tick();
  expect(info).toHaveBeenCalledTimes(1);
  const current = f.gateway.store.get<Record<string, unknown>>(
    "observed-groups",
    key,
  )!;
  f.gateway.store.put("observed-groups", key, { ...current, nameNextCheck: 0 });
  info.mockRejectedValueOnce(new Error("offline"));
  await f.gateway.tick();
  expect(f.gateway.store.get("observed-groups", key)).toMatchObject({
    name: "Design team",
  });
});

it("refreshes group names on demand without waiting for the normal cache and debounces repeated clicks", async () => {
  const info = vi.fn(async () => ({ name: "Current name" }));
  const f = await fixture(false, info);
  for (const id of ["one", "two", "limited"]) {
    const conversation = { connectionId: "wecom", id, kind: "group" as const };
    f.gateway.store.put("observed-groups", imConversationKey(conversation), {
      conversation,
      identities: [],
      lastSeenAt: Date.now(),
      nameNextCheck: Date.now() + 60000,
      ...(id === "limited" ? { nameError: "rate-limited" } : {}),
    });
  }
  const refresh = () =>
    fetch(`${f.url}/v1/admin/refresh-groups`, {
      method: "PUT",
      body: "{}",
      headers: { Authorization: `Bearer ${"a".repeat(32)}` },
    });
  expect((await refresh()).ok).toBe(true);
  expect(info).toHaveBeenCalledTimes(2);
  expect(
    f.gateway.store
      .list<{ name?: string }>("observed-groups")
      .filter((g) => g.name === "Current name"),
  ).toHaveLength(2);
  expect((await refresh()).ok).toBe(true);
  expect(info).toHaveBeenCalledTimes(2);
});

it("publishes native roster metadata without granting directory members execution access", async () => {
  const roster: ImGroupRoster = { complete: true, members: [] };
  const members = vi.fn(async () => roster);
  const f = await fixture(false, async () => ({ name: "Team" }), members);
  roster.members = ["Alex", "Morgan", "Artemis", "Solar"].map(
    (name, index) => ({
      identity: { ...f.input.identity, userId: name },
      name,
      kind: index < 2 ? "human" : "bot",
    }),
  );
  const group = {
    id: "native",
    name: "Old",
    revision: "grant",
    endpoints: [{ connectionId: "wecom", id: "group", kind: "group" }],
    participants: [{ deviceId: f.device.id, identity: f.input.identity }],
    nativeGroup: { version: 1, enabled: true, ownerDeviceId: f.device.id },
  };
  f.gateway.store.put("native-groups", group.id, group);
  await f.gateway.tick();
  const status = await fetch(`${f.url}/v1/device/status`, {
    headers: f.headers,
  }).then((r) => r.json());
  expect(status.spaces[0].roster).toMatchObject(roster);
  expect(status.spaces[0].participants).toHaveLength(1);
  expect(f.gateway.store.get("native-groups", group.id)).toEqual({
    ...group,
    name: "Team",
  });
  await f.gateway.tick();
  expect(members).toHaveBeenCalledTimes(1);
});

it("persists per-group assignment denial without pairing or changing project grants", async () => {
  const f = await fixture();
  const member = { ...f.input.identity, userId: "teammate" };
  const conversation = {
    ...f.input.conversation,
    kind: "group" as const,
    id: "room",
  };
  const group = {
    id: "native",
    name: "Team",
    revision: "grant",
    endpoints: [conversation],
    participants: [
      { deviceId: f.device.id, identity: f.input.identity, name: "Owner" },
    ],
    nativeGroup: {
      version: 1,
      enabled: true,
      enabledAt: 1,
      projectId: "p",
      ownerDeviceId: f.device.id,
    },
  };
  f.gateway.store.put("native-groups", group.id, group);
  f.gateway.store.put("space-confirmations", group.id, [
    imConversationKey(conversation),
  ]);
  f.gateway.store.put("native-group-info", group.id, {
    roster: {
      complete: true,
      members: [
        { identity: member, name: "Teammate", kind: "human" },
        {
          identity: { ...member, userId: "other-bot" },
          name: "Solar",
          kind: "bot",
        },
        { identity: f.input.identity, name: "Owner", kind: "human" },
      ],
    },
  });
  const permission = (identity = member, allowed = false) =>
    fetch(`${f.url}/v1/admin/native-group-member`, {
      method: "PUT",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      body: JSON.stringify({ spaceId: group.id, identity, allowed }),
    });
  const bot = { ...member, userId: "other-bot" };
  expect((await permission(bot, true)).ok).toBe(true);
  expect(
    f.gateway.store.get<{ nativeGroup: { allowedBots: string[] } }>(
      "native-groups",
      group.id,
    )?.nativeGroup.allowedBots,
  ).toEqual(["other-bot"]);
  expect((await permission(bot, false)).ok).toBe(true);
  expect((await permission()).ok).toBe(true);
  const send = (messageId: string) => {
    f.gateway.router.ingest({
      ...f.input,
      conversation,
      identity: member,
      messageId,
      timestamp: Date.now(),
    });
    f.gateway.router.processIncoming();
  };
  send("denied");
  expect(f.gateway.store.pending("device")).toHaveLength(0);
  const status = await fetch(`${f.url}/v1/device/status`, {
    headers: f.headers,
  }).then((r) => r.json());
  expect(status.spaces[0].roster.members[0].canAssign).toBe(false);
  expect((await permission(f.input.identity)).ok).toBe(false);
  expect((await permission(member, true)).ok).toBe(true);
  send("allowed");
  expect(f.gateway.store.pending("device")).toHaveLength(1);
  expect(f.gateway.store.get("native-groups", group.id)).toMatchObject(group);
});

it("refreshes the open group's roster and coalesces repeated panel requests", async () => {
  const members = vi.fn(async () => ({ complete: true, members: [] }));
  const f = await fixture(false, async () => ({ name: "Team" }), members);
  f.gateway.store.put("native-groups", "native", {
    id: "native",
    name: "Team",
    revision: "r",
    endpoints: [{ connectionId: "wecom", id: "group", kind: "group" }],
    participants: [{ deviceId: f.device.id, identity: f.input.identity }],
    nativeGroup: { version: 1, enabled: true, ownerDeviceId: f.device.id },
  });
  await f.gateway.tick();
  expect(members).toHaveBeenCalledTimes(1);
  const refresh = () =>
    fetch(`${f.url}/v1/admin/refresh-group-members`, {
      method: "PUT",
      headers: { authorization: `Bearer ${"a".repeat(32)}` },
      body: JSON.stringify({ spaceId: "native" }),
    });
  expect((await refresh()).ok).toBe(true);
  expect(members).toHaveBeenCalledTimes(1);
  const prior = f.gateway.store.get<Record<string, unknown>>(
    "native-group-info",
    "native",
  );
  f.gateway.store.put("native-group-info", "native", {
    ...prior,
    checkedAt: Date.now() - 11000,
  });
  expect((await refresh()).ok).toBe(true);
  expect(members).toHaveBeenCalledTimes(2);
});

it("persists observed WeCom members and rejects old or cross-tenant observations", async () => {
  const f = await fixture();
  const conversation = {
    ...f.input.conversation,
    kind: "group" as const,
    id: "room",
  };
  const group = {
    id: "native-observed",
    name: "Team",
    revision: "grant",
    endpoints: [conversation],
    participants: [
      { deviceId: f.device.id, identity: f.input.identity, name: "Owner" },
    ],
    nativeGroup: {
      version: 1,
      enabled: true,
      enabledAt: Date.now() - 1000,
      projectId: "p",
      ownerDeviceId: f.device.id,
    },
  };
  f.gateway.store.put("native-groups", group.id, group);
  f.gateway.store.put("space-confirmations", group.id, [
    imConversationKey(conversation),
  ]);
  const event = {
    ...f.input,
    conversation,
    identity: { ...f.input.identity, userId: "teammate" },
  };
  f.receive(event);
  f.receive(event);
  f.receive({
    ...event,
    messageId: "old",
    timestamp: 1,
    identity: { ...event.identity, userId: "old" },
  });
  f.receive({
    ...event,
    messageId: "foreign",
    identity: { ...event.identity, tenantId: "other", userId: "foreign" },
  });
  expect(f.gateway.store.get("native-group-info", group.id)).toMatchObject({
    roster: {
      complete: false,
      error: "partial",
      members: [{ identity: event.identity, kind: "human" }],
    },
  });
  const response = await fetch(`${f.url}/v1/admin/native-group-member`, {
    method: "PUT",
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
    body: JSON.stringify({
      spaceId: group.id,
      identity: event.identity,
      allowed: false,
    }),
  });
  expect(response.status).toBe(200);
  expect(
    f.gateway.store.get(
      "group-denied-senders",
      JSON.stringify([group.id, imIdentityKey(event.identity)]),
    ),
  ).toBe(true);
});

it("disables a Feishu group only after a signed current removal event", async () => {
  const f = await fixture();
  const config = {
    id: "feishu",
    name: "Feishu",
    channel: "feishu",
    tenantId: "tenant",
    appId: "app",
    botOpenId: "bot",
    appSecret: "secret",
    verificationToken: "verify",
    encryptKey: "encrypt",
    enabled: true,
  };
  const saved = await fetch(`${f.url}/v1/admin/connections`, {
    method: "PUT",
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
    body: JSON.stringify(config),
  });
  expect(saved.status).toBe(200);
  const conversation = { connectionId: "feishu", id: "room", kind: "group" };
  const enabledAt = Date.now() - 500;
  const group = {
    id: "feishu-room",
    name: "Team",
    revision: "original",
    endpoints: [conversation],
    participants: [],
    nativeGroup: {
      version: 1,
      enabled: true,
      enabledAt,
      projectId: "p",
      ownerDeviceId: f.device.id,
    },
  };
  f.gateway.store.put("native-groups", group.id, group);
  f.gateway.store.put("space-confirmations", group.id, [
    imConversationKey(conversation as typeof f.input.conversation),
  ]);
  const send = async (created: number, tenant = "tenant", valid = true) => {
    const body = JSON.stringify({
      header: {
        token: "verify",
        app_id: "app",
        tenant_key: tenant,
        event_type: "im.chat.member.bot.deleted_v1",
        create_time: String(created),
      },
      event: { chat_id: "room" },
    });
    const time = String(Math.floor(Date.now() / 1000));
    return fetch(`${f.url}/channels/feishu/feishu`, {
      method: "POST",
      headers: {
        "x-lark-request-timestamp": time,
        "x-lark-request-nonce": "nonce",
        "x-lark-signature": valid
          ? createHash("sha256")
              .update(time + "nonce" + "encrypt" + body)
              .digest("hex")
          : "invalid",
      },
      body,
    });
  };
  await send(Date.now(), "tenant", false);
  await send(Date.now(), "foreign");
  await send(enabledAt - 1);
  expect(f.gateway.store.get("native-groups", group.id)).toEqual(group);
  expect((await send(Date.now())).status).toBe(200);
  const disabled = f.gateway.store.get<{ revision: string }>(
    "native-groups",
    group.id,
  );
  expect(disabled).toMatchObject({ nativeGroup: { enabled: false } });
  expect(f.gateway.store.get("space-confirmations", group.id)).toBeUndefined();
  await send(Date.now());
  expect(f.gateway.store.get("native-groups", group.id)).toEqual(disabled);
});
