import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imIdentityKey,
  type ChannelEvent,
  type ImReply,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { ArtemisGateway } from "../src/server.js";
import type { FeishuApprovalCard } from "../src/feishu-approval.js";
import { DeliveryUncertain } from "../src/channels.js";

const instances: ArtemisGateway[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await instance.close();
});
async function fixture() {
  const approvalCard = vi.fn(async () => "om_card");
  const send = vi.fn(async () => "om_text");
  const statusCard = vi.fn(async () => "om_card");
  const typing = vi.fn(async (_message: string, active: boolean) =>
    active ? "reaction" : undefined,
  );
  const gateway = new ArtemisGateway({
    databasePath: ":memory:",
    encryptionKey: "e".repeat(32),
    adminToken: "a".repeat(32),
    adapterFactory: (config) => ({
      start() {},
      stop() {},
      status: () => ({
        id: config.id,
        name: config.name,
        channel: config.channel,
        state: "connected",
      }),
      approvalCard,
      send,
      statusCard,
      typing,
      attachment: vi.fn(),
    }),
  });
  instances.push(gateway);
  const url = `http://127.0.0.1:${await gateway.listen(0)}`;
  await fetch(`${url}/v1/admin/connections`, {
    method: "PUT",
    headers: { authorization: `Bearer ${"a".repeat(32)}` },
    body: JSON.stringify({
      id: "feishu",
      channel: "feishu",
      name: "Feishu",
      tenantId: "tenant",
      appId: "app",
      botOpenId: "bot",
      appSecret: "secret",
      verificationToken: "token",
      encryptKey: "encrypt",
      enabled: true,
    }),
  });
  const device = gateway.store.register("Alice");
  gateway.store.put("device-leases", device.id, {
    sessionId: randomUUID(),
    expiresAt: Date.now() + 45000,
  });
  const event: ChannelEvent = {
    version: 1,
    messageId: "source",
    identity: {
      channel: "feishu",
      connectionId: "feishu",
      tenantId: "tenant",
      appId: "app",
      userId: "alice",
    },
    conversation: { connectionId: "feishu", id: "chat", kind: "direct" },
    text: "/new analyze",
    attachments: [],
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
  };
  gateway.store.pair(gateway.store.pairCode(device.id), event.identity);
  gateway.router.ingest(event);
  gateway.router.processIncoming();
  const invocation =
    gateway.store.pending<RemoteInvocationContext>("device")[0]!.payload;
  const approval = { token: randomUUID(), expiresAt: Date.now() + 300000 };
  const reply = (extras: Partial<ImReply>) =>
    gateway.router.receiveReply(device.id, {
      version: 1,
      id: randomUUID(),
      invocationId: invocation.id,
      taskId: "task",
      text: "Approve the file write",
      visibility: "owner",
      final: false,
      ...extras,
    });
  const callback = async (overrides: Record<string, unknown> = {}) => {
    const raw = JSON.stringify({
      schema: "2.0",
      header: {
        app_id: "app",
        tenant_key: "tenant",
        event_id: randomUUID(),
        event_type: "card.action.trigger",
        token: "token",
      },
      event: {
        operator: { open_id: "alice" },
        context: { open_message_id: "om_card", open_chat_id: "chat" },
        action: {
          value: { artemisApprovalToken: approval.token, decision: "yes" },
        },
        ...overrides,
      },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    return fetch(`${url}/channels/feishu/feishu`, {
      method: "POST",
      headers: {
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": "nonce",
        "x-lark-signature": createHash("sha256")
          .update(timestamp + "nonce" + "encrypt" + raw)
          .digest("hex"),
      },
      body: raw,
    });
  };
  return {
    gateway,
    device,
    approval,
    event,
    reply,
    callback,
    approvalCard,
    send,
    statusCard,
    typing,
  };
}
describe("Feishu Gateway interactions", () => {
  it("authenticates issued-card callbacks and atomically persists a single decision", async () => {
    const f = await fixture();
    f.reply({ approval: f.approval });
    await f.gateway.tick();
    expect(f.approvalCard).toHaveBeenCalledTimes(1);
    expect(
      await (await f.callback({ operator: { open_id: "mallory" } })).json(),
    ).toMatchObject({ toast: { type: "error" } });
    const enqueue = vi
      .spyOn(f.gateway.store, "enqueue")
      .mockImplementationOnce(() => {
        throw new Error("storage failed");
      });
    expect((await f.callback()).ok).toBe(false);
    enqueue.mockRestore();
    expect(
      f.gateway.store.get<FeishuApprovalCard>(
        "approval-cards",
        `feishu:${f.approval.token}`,
      )?.consumed,
    ).toBeUndefined();
    expect(await (await f.callback()).json()).toMatchObject({
      toast: { type: "success" },
    });
    expect(await (await f.callback()).json()).toMatchObject({
      toast: { type: "error" },
    });
    expect(
      f.gateway.store
        .pending<ChannelEvent>("incoming")
        .filter((row) => row.payload.text.startsWith("/approve")),
    ).toHaveLength(1);
    await f.gateway.tick();
    expect(f.statusCard).toHaveBeenCalledWith(
      f.event.conversation,
      "已提交，等待桌面确认。",
      expect.any(String),
      "om_card",
    );
  });
  it("closes a card resolved on desktop and rejects expired or revoked approvals", async () => {
    const f = await fixture();
    f.reply({ approval: f.approval });
    await f.gateway.tick();
    f.gateway.store.delete(
      "throttle",
      JSON.stringify(["feishu", "direct", "chat"]),
    );
    f.reply({
      approval: { ...f.approval, resolved: "denied" },
      text: "已拒绝。",
    });
    await f.gateway.tick();
    await f.gateway.tick();
    expect(await (await f.callback()).json()).toMatchObject({
      toast: { type: "error" },
    });
    expect(f.statusCard).toHaveBeenLastCalledWith(
      f.event.conversation,
      "已拒绝。",
      expect.any(String),
      "om_card",
    );
    const card = f.gateway.store.get<FeishuApprovalCard>(
      "approval-cards",
      `feishu:${f.approval.token}`,
    )!;
    f.gateway.store.put("approval-cards", `feishu:${f.approval.token}`, {
      ...card,
      consumed: false,
      approval: { ...f.approval, expiresAt: Date.now() - 1 },
    });
    expect(await (await f.callback()).json()).toMatchObject({
      toast: { type: "error" },
    });
    f.gateway.store.put("approval-cards", `feishu:${f.approval.token}`, {
      ...card,
      consumed: false,
    });
    f.gateway.store.delete("identities", imIdentityKey(f.event.identity));
    expect(await (await f.callback()).json()).toMatchObject({
      toast: { type: "error" },
    });
  });
  it("preserves a desktop decision received while the submitted card is being patched", async () => {
    const f = await fixture();
    f.reply({ approval: f.approval });
    await f.gateway.tick();
    await f.callback();
    f.statusCard.mockImplementationOnce(async () => {
      f.reply({ approval: { ...f.approval, resolved: "denied" } });
      return "om_card";
    });
    await f.gateway.tick();
    expect(
      f.gateway.store.get<FeishuApprovalCard>(
        "approval-cards",
        `feishu:${f.approval.token}`,
      ),
    ).toMatchObject({ approval: { resolved: "denied" }, closed: false });
    await f.gateway.tick();
    expect(f.statusCard).toHaveBeenLastCalledWith(
      f.event.conversation,
      "已拒绝。",
      expect.any(String),
      "om_card",
    );
  });
  it("falls back only on confirmed card rejection and never replays an uncertain send", async () => {
    const f = await fixture();
    f.approvalCard.mockRejectedValueOnce(new Error("platform rejected card"));
    f.reply({ approval: f.approval });
    await f.gateway.tick();
    expect(f.send).toHaveBeenCalledWith(
      f.event.conversation,
      expect.stringContaining("按钮卡片不可用"),
      expect.any(String),
    );
    expect(f.gateway.store.list("approval-cards")).toHaveLength(0);
    const g = await fixture();
    g.approvalCard.mockRejectedValueOnce(new DeliveryUncertain("timeout"));
    g.reply({ approval: g.approval });
    await g.gateway.tick();
    await g.gateway.tick();
    expect(g.send).not.toHaveBeenCalled();
    expect(g.approvalCard).toHaveBeenCalledTimes(1);
    expect(
      g.gateway.store.db
        .prepare("SELECT state FROM queue WHERE bucket='outgoing'")
        .get()?.state,
    ).toBe("uncertain");
  });
  it("clears Typing on waiting, completion, revocation and shutdown", async () => {
    const f = await fixture();
    f.reply({ started: true });
    await f.gateway.tick();
    expect(f.typing).toHaveBeenCalledWith("source", true, undefined);
    f.reply({ status: "waiting" });
    await f.gateway.tick();
    expect(f.typing).toHaveBeenLastCalledWith("source", false, "reaction");
    f.reply({ status: "running" });
    await f.gateway.tick();
    f.reply({ final: true });
    await f.gateway.tick();
    expect(f.typing).toHaveBeenLastCalledWith("source", false, "reaction");
    f.reply({ started: true });
    await f.gateway.tick();
    f.gateway.store.delete("identities", imIdentityKey(f.event.identity));
    await f.gateway.tick();
    expect(f.typing).toHaveBeenLastCalledWith("source", false, "reaction");
    const g = await fixture();
    g.reply({ started: true });
    await g.gateway.tick();
    await g.gateway.close();
    instances.splice(instances.indexOf(g.gateway), 1);
    expect(g.typing).toHaveBeenLastCalledWith("source", false, "reaction");
  });
});
