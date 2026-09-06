import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { imConversationKey, type ChannelEvent } from "@artemis/protocol";
import { GatewayRouter, type Delivery } from "../src/router.js";
import { GatewayStore } from "../src/store.js";

let store: GatewayStore;
beforeEach(() => {
  store = new GatewayStore(":memory:", "e".repeat(32));
});
afterEach(() => store.close());

function fixture(channel: ChannelEvent["identity"]["channel"]) {
  const router = new GatewayRouter(store);
  const device = store.register("Alice");
  const event: ChannelEvent = {
    version: 1,
    messageId: "discovery",
    identity: {
      channel,
      connectionId: channel,
      tenantId: "tenant",
      appId: "bot",
      userId: "alice",
    },
    conversation: { connectionId: channel, id: "group", kind: "group" },
    text: "/help",
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  };
  store.pair(store.pairCode(device.id), event.identity);
  const space = {
    id: "team",
    revision: "v1",
    name: "Team",
    endpoints: [
      event.conversation,
      { ...event.conversation, id: "other-group" },
    ],
    participants: [
      { deviceId: device.id, identity: event.identity, name: "Alice" },
    ],
    administrators: [event.identity],
  };
  const send = (text = event.text) => {
    router.ingest({ ...event, text });
    router.processIncoming();
    return store.pending<Delivery>("outgoing").map((item) => item.payload);
  };
  return { router, event, space, send };
}

describe("group setup feedback", () => {
  for (const channel of ["wecom", "feishu", "slack"] as const) {
    it.each(["/help", ""])(
      `${channel} confirms discovery for %j before space setup without starting a task`,
      (text) => {
        const f = fixture(channel);
        const replies = f.send(text);
        expect(replies).toHaveLength(1);
        expect(replies[0]?.text).toContain("已发现这个群");
        expect(replies[0]?.text).toContain("刷新群和成员");
        expect(
          store.get("observed-groups", imConversationKey(f.event.conversation)),
        ).toMatchObject({ conversation: f.event.conversation });
        expect(store.pending("device")).toHaveLength(0);
        expect(f.send(text)).toHaveLength(1);
        expect(store.list("spaces")).toHaveLength(0);
      },
    );

    it(`${channel} distinguishes pending group confirmations and uses the platform's command syntax`, () => {
      const f = fixture(channel);
      store.put("spaces", f.space.id, f.space);
      store.put("space-confirmations", f.space.id, [
        imConversationKey(f.event.conversation),
      ]);
      const reply = f.send()[0]!.text;
      expect(reply).toContain("本群已确认");
      expect(reply).toContain("还有 1 个群待确认");
      expect(reply).toContain(
        `${channel === "slack" ? "" : "/"}space-confirm team`,
      );
      if (channel === "slack") expect(reply).not.toContain("/space-confirm");
      expect(store.pending("device")).toHaveLength(0);
      expect(f.router.findSpace(f.event.conversation)).toBeUndefined();
    });
  }

  it("explains that a paired account must be added to a confirmed space without granting membership", () => {
    const f = fixture("feishu");
    store.put("spaces", f.space.id, { ...f.space, participants: [] });
    store.put(
      "space-confirmations",
      f.space.id,
      f.space.endpoints.map(imConversationKey),
    );
    expect(f.send()[0]?.text).toContain("你的已配对账号尚未加入这个空间");
    expect(store.pending("device")).toHaveLength(0);
    expect(
      store.list<{ participants: unknown[] }>("spaces")[0]?.participants,
    ).toHaveLength(0);
  });

  it("continues normal help routing after every group is confirmed and the account is a participant", () => {
    const f = fixture("slack");
    store.put("spaces", f.space.id, f.space);
    store.put(
      "space-confirmations",
      f.space.id,
      f.space.endpoints.map(imConversationKey),
    );
    f.send();
    expect(store.pending("device")).toHaveLength(1);
  });
});
