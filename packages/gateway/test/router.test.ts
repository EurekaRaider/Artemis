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
  it("expires offline assignments and persists a single stop request instead of leaving them queued forever", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    try {
      const router = new GatewayRouter(store, () => 200);
      const input = event();
      store.put("invocations", "request", {
        version: 1,
        id: "request",
        messageId: "m",
        deviceId: "target",
        identity: input.identity,
        conversation: input.conversation,
        text: "work",
        attachments: [],
        expiresAt: 100,
        collaboration: {
          taskId: "assignment",
          coordinatorDeviceId: "coordinator",
          coordinatorThreadId: "thread",
          mission: "work",
        },
      });
      store.put("collaboration-tasks", "assignment", {
        id: "assignment",
        spaceId: "space",
        coordinatorDeviceId: "coordinator",
        coordinatorThreadId: "thread",
        participantDeviceId: "target",
        invocationId: "request",
        state: "queued",
        mission: "work",
        result: "",
        expiresAt: 100,
      });
      router.processIncoming();
      router.processIncoming();
      expect(
        store.get<{ state: string }>("collaboration-tasks", "assignment")
          ?.state,
      ).toBe("failed");
      expect(store.pending<RemoteInvocationContext>("device")).toMatchObject([
        {
          recipient: "target",
          payload: {
            control: "cancel",
            collaboration: { taskId: "assignment" },
          },
        },
      ]);
    } finally {
      store.close();
    }
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
  it("requires confirmation from each designated group and does not forward ordinary chatter", () => {
    const store = new GatewayStore(":memory:", "e".repeat(32));
    try {
      const router = new GatewayRouter(store),
        device = store.register("Alice"),
        input = event();
      store.pair(store.pairCode(device.id), input.identity);
      const group = {
        ...input.conversation,
        id: "group",
        kind: "group" as const,
      };
      const space = {
        id: "space",
        name: "Team",
        endpoints: [group],
        participants: [
          { deviceId: device.id, identity: input.identity, name: "Alice" },
        ],
        administrators: [input.identity],
      };
      store.put("spaces", space.id, space);
      expect(router.findSpace(group)).toBeUndefined();
      expect(
        router.ingest({ ...input, conversation: group, mentioned: false }),
      ).toBe(false);
      router.ingest({
        ...input,
        messageId: "confirm",
        conversation: group,
        text: "/space-confirm space",
      });
      router.processIncoming();
      expect(router.findSpace(group)?.id).toBe("space");
      router.ingest({ ...input, messageId: "group-task", conversation: group });
      router.processIncoming();
      expect(
        store.pending<RemoteInvocationContext>("device")[0]?.payload
          .conversation.spaceId,
      ).toBe("space");
      expect(store.get("space-confirmations", "space")).toEqual([
        imConversationKey(group),
      ]);
    } finally {
      store.close();
    }
  });
});
