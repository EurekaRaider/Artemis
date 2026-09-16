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
        expect(replies[0]?.text).toContain("刷新群列表");
        expect(
          store.get("observed-groups", imConversationKey(f.event.conversation)),
        ).toMatchObject({ conversation: f.event.conversation });
        expect(store.pending("device")).toHaveLength(0);
        expect(f.send(text)).toHaveLength(1);
        expect(store.list("spaces")).toHaveLength(0);
      },
    );

    it(`${channel} does not revive legacy routes even when every endpoint is confirmed`, () => {
      const f = fixture(channel);
      store.put("spaces", f.space.id, f.space);
      store.put(
        "space-confirmations",
        f.space.id,
        f.space.endpoints.map(imConversationKey),
      );
      expect(f.send()[0]?.text).toContain("已发现这个群");
      expect(store.pending("device")).toHaveLength(0);
      expect(f.router.findSpace(f.event.conversation)).toBeUndefined();
    });
  }

  it("does not discover or authorize a group for an unpaired account", () => {
    const f = fixture("slack");
    f.router.ingest({
      ...f.event,
      identity: { ...f.event.identity, userId: "unpaired" },
    });
    f.router.processIncoming();
    expect(store.list("observed-groups")).toHaveLength(0);
    expect(store.pending("device")).toHaveLength(0);
  });
});
