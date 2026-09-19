import { describe, it, expect } from "vitest";
import { GatewayStore } from "../src/store.js";
import { GatewayRouter } from "../src/router.js";
import {
  imConversationKey,
  type ChannelEvent,
  type RemoteInvocationContext,
} from "@artemis/protocol";
function event(id = "message-1"): ChannelEvent {
  return {
    version: 1,
    messageId: id,
    identity: {
      channel: "wecom",
      connectionId: "wecom",
      tenantId: "tenant",
      appId: "bot",
      userId: "alice",
    },
    conversation: { connectionId: "wecom", id: "alice", kind: "direct" },
    text: "/new hello",
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  };
}
describe("Gateway routing", () => {
  it("coalesces cumulative stream updates without splitting them or delaying final status", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    try {
      const router = new GatewayRouter(store);
      const payload = {
        conversation: {
          connectionId: "f",
          id: "chat",
          kind: "direct" as const,
        },
        cardKey: "device:task",
        stream: true,
        text: "a".repeat(8000),
      };
      router.queueDelivery("first", payload);
      expect(store.pending("outgoing")).toHaveLength(1);
      router.queueDelivery("latest", { ...payload, text: "b".repeat(9000) });
      const pending = store.pending<{ text: string }>("outgoing");
      expect(pending).toHaveLength(1);
      expect(pending[0]?.payload.text).toBe("b".repeat(9000));
      router.queueDelivery("done", {
        ...payload,
        stream: false,
        text: "Completed",
      });
      expect(
        store
          .pending<{ text: string }>("outgoing")
          .map((item) => item.payload.text),
      ).toEqual(["Completed"]);
    } finally {
      store.close();
    }
  });
  it("rejects legacy delegation without enqueuing device work", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    const router = new GatewayRouter(store);
    expect(() =>
      router.collaborate("device", "invocation", "thread", {
        action: "delegate",
        text: "work",
      }),
    ).toThrow(/退役/);
    expect(store.pending("device")).toHaveLength(0);
    store.close();
  });
  it("deduplicates messages, binds stable scoped identities and isolates reply ownership", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    try {
      const router = new GatewayRouter(store),
        device = store.register("Alice"),
        other = store.register("Bob"),
        input = event();
      store.pair(store.pairCode(device.id), input.identity);
      expect(router.ingest(input)).toBe(true);
      expect(router.ingest(input)).toBe(false);
      router.processIncoming();
      router.processIncoming();
      const requests = store.pending<RemoteInvocationContext>("device");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.recipient).toBe(device.id);
      const reply = {
        version: 1,
        id: "reply",
        invocationId: requests[0]!.id,
        text: "done",
        final: true,
      };
      expect(() => router.receiveReply(other.id, reply)).toThrow("belong");
      router.receiveReply(device.id, reply);
      router.receiveReply(device.id, reply);
      expect(store.pending("outgoing")).toHaveLength(2);
      expect(
        store.pending<{ text: string }>("outgoing")[0]?.payload.text,
      ).toContain("当前离线或已暂停");
    } finally {
      store.close();
    }
  });
  it("does not accept bot chatter or unmentioned group messages", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    const router = new GatewayRouter(store);
    const event: ChannelEvent = {
      version: 1,
      messageId: "m",
      identity: {
        channel: "slack",
        connectionId: "s",
        tenantId: "t",
        appId: "a",
        userId: "u",
      },
      conversation: { connectionId: "s", id: "g", kind: "group" },
      text: "work",
      timestamp: Date.now(),
      attachments: [],
      bot: true,
      mentioned: true,
    };
    expect(router.ingest(event)).toBe(false);
    expect(router.ingest({ ...event, bot: false, mentioned: false })).toBe(
      false,
    );
    expect(store.pending("incoming")).toHaveLength(0);
    store.close();
  });
});
