import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  imConversationKey,
  imIdentityKey,
  type ChannelEvent,
  type CollaborationSpace,
  type ImIdentity,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayRouter, type Delivery } from "../src/router.js";
import { GatewayStore } from "../src/store.js";

let store: GatewayStore;
beforeEach(() => {
  store = new GatewayStore(":memory:", "e".repeat(32));
});
afterEach(() => store.close());
function fixture(
  source: ImIdentity["channel"] = "feishu",
  target: ImIdentity["channel"] = "slack",
) {
  const router = new GatewayRouter(store);
  const alice = store.register("Alice"),
    bob = store.register("Bob");
  const identity = (
    channel: ImIdentity["channel"],
    userId: string,
  ): ImIdentity => ({
    channel,
    connectionId: userId,
    tenantId: "tenant",
    appId: "bot",
    userId,
  });
  const a = identity(source, "alice"),
    b = identity(target, "bob");
  store.pair(store.pairCode(alice.id), a);
  store.pair(store.pairCode(bob.id), b);
  const endpoints = [a, b].map((i) => ({
    connectionId: i.connectionId,
    id: `${i.userId}-group`,
    kind: "group" as const,
  }));
  const space: CollaborationSpace = {
    id: "team",
    revision: "v1",
    name: "Team",
    endpoints,
    participants: [
      { deviceId: alice.id, identity: a, name: "Same name" },
      { deviceId: bob.id, identity: b, name: "Same name" },
    ],
  };
  store.put("spaces", space.id, space);
  store.put("space-confirmations", space.id, endpoints.map(imConversationKey));
  const event: ChannelEvent = {
    version: 1,
    identity: a,
    conversation: endpoints[0]!,
    messageId: "message",
    text: `/ask ${bob.id} Inspect the API`,
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  };
  const send = (patch: Partial<ChannelEvent> = {}) => {
    router.ingest({ ...event, ...patch });
    router.processIncoming();
  };
  return {
    router,
    alice,
    bob,
    a,
    b,
    space,
    event,
    send,
    outgoing: () => store.pending<Delivery>("outgoing").map((r) => r.payload),
  };
}
describe("explicit group Agent targeting", () => {
  it("reports an offline target's expiry to the requesting group too", () => {
    const f = fixture();
    f.send();
    new GatewayRouter(store, () => Date.now() + 31 * 60_000).processIncoming();
    expect(store.pending("device")).toHaveLength(0);
    expect(
      f
        .outgoing()
        .filter((d) => d.text.includes("排队请求已超过截止时间"))
        .map((d) => d.conversation.id)
        .sort(),
    ).toEqual(["alice-group", "bob-group"]);
  });
  it("fans out an explicit multi-member prompt once and rejects the entire request when a target is invalid", () => {
    const f = fixture();
    f.send({ text: `/ask ${f.alice.id},missing Inspect independently` });
    expect(store.pending("device")).toHaveLength(0);
    f.send({
      messageId: "valid-batch",
      text: `/ask ${f.alice.id},${f.bob.id} Inspect independently`,
    });
    f.send({
      messageId: "valid-batch",
      text: `/ask ${f.alice.id},${f.bob.id} Inspect independently`,
    });
    expect(
      store
        .pending<RemoteInvocationContext>("device")
        .map((r) => r.recipient)
        .sort(),
    ).toEqual([f.alice.id, f.bob.id].sort());
  });
  it("atomically queues different assignments for the prompt coordinator", () => {
    const f = fixture();
    const carol = store.register("Carol");
    const identity = { ...f.b, userId: "carol" };
    store.pair(store.pairCode(carol.id), identity);
    store.put("spaces", "team", {
      ...f.space,
      participants: [
        ...f.space.participants,
        { deviceId: carol.id, identity, name: "Carol" },
      ],
    });
    f.send({
      text: "Have Bob check the API and Carol check the UI, in parallel, then summarize.",
    });
    const root = store.pending<RemoteInvocationContext>("device")[0]!.payload;
    const batch = (lastId: string) =>
      f.router.collaborate(f.alice.id, root.id, "coordinator", {
        action: "delegate-many",
        text: "",
        assignments: [
          { participantId: f.bob.id, text: "Check the API" },
          { participantId: lastId, text: "Check the UI" },
        ],
      });
    expect(() => batch("missing")).toThrow("Participant");
    expect(store.list("collaboration-tasks")).toHaveLength(0);
    expect(store.pending("device")).toHaveLength(1);
    batch(carol.id);
    expect(store.list("collaboration-tasks")).toHaveLength(2);
    expect(
      store
        .pending<RemoteInvocationContext>("device")
        .slice(1)
        .map((r) => [r.recipient, r.payload.text]),
    ).toEqual([
      [f.bob.id, "Check the API"],
      [carol.id, "Check the UI"],
    ]);
    expect(() =>
      f.router.collaborate(f.alice.id, root.id, "coordinator", {
        action: "finish",
        text: "",
      }),
    ).toThrow("Wait");
  });
  const channels = ["wecom", "feishu", "slack"] as const;
  for (const source of channels)
    for (const target of channels) {
      it(`routes ${source} to ${target} directly and returns results to both groups`, () => {
        const f = fixture(source, target);
        f.send();
        f.send();
        const requests = store.pending<RemoteInvocationContext>("device");
        expect(requests).toHaveLength(1);
        const request = requests[0]!.payload;
        expect(request).toMatchObject({
          deviceId: f.bob.id,
          identity: f.b,
          originator: f.a,
          text: "Inspect the API",
          conversation: {
            ...f.space.endpoints[1],
            spaceId: "team",
            spaceRevision: "v1",
          },
        });
        expect(request.taskId).toBeUndefined();
        expect(
          f
            .outgoing()
            .some(
              (d) =>
                d.conversation.id === "alice-group" &&
                d.text.includes("Same name"),
            ),
        ).toBe(true);
        f.router.receiveReply(f.bob.id, {
          version: 1,
          id: "result",
          invocationId: request.id,
          taskId: "bob-task",
          text: "API checked",
          final: true,
          visibility: "conversation",
        });
        expect(
          f
            .outgoing()
            .filter((d) => d.text.includes("API checked"))
            .map((d) => d.conversation.id)
            .sort(),
        ).toEqual(["alice-group", "bob-group"]);
        expect(store.list("feishu-typing")).toEqual([]);
      });
    }
  it("lists exact device IDs without invoking any Agent", () => {
    const f = fixture();
    f.send({ text: "/agents" });
    expect(store.pending("device")).toHaveLength(0);
    const text = f
      .outgoing()
      .map((d) => d.text)
      .join("\n");
    expect(text).toContain(f.bob.id);
    expect(text).toContain("Same name");
    expect(text).toContain("/ask");
    expect(f.outgoing().every((d) => d.conversation.id === "alice-group")).toBe(
      true,
    );
  });
  it.each([
    "/ask",
    "/ask missing task",
    "/ask Same name task",
    "/agents extra",
  ])(
    "rejects invalid targeting without falling back to the sender: %s",
    (text) => {
      const f = fixture();
      f.send({ text });
      expect(store.pending("device")).toHaveLength(0);
      expect(f.outgoing().length).toBeGreaterThan(0);
    },
  );
  it("gives explicit targeting priority over a quoted task", () => {
    const f = fixture();
    store.put("message-map", "alice:quoted", {
      taskId: "alice-task",
      deviceId: f.alice.id,
    });
    f.send({ replyTo: "quoted" });
    expect(
      store.pending<RemoteInvocationContext>("device")[0]!.payload,
    ).toMatchObject({ deviceId: f.bob.id });
    expect(
      store.pending<RemoteInvocationContext>("device")[0]!.payload.taskId,
    ).toBeUndefined();
  });
  it.each(["/agents", "/ask bob work"])(
    "denies targeting from a private chat: %s",
    (text) => {
      const f = fixture();
      f.send({
        text,
        conversation: { connectionId: "alice", id: "dm", kind: "direct" },
      });
      expect(store.pending("device")).toHaveLength(0);
    },
  );
  it.each(["unpaired", "revoked", "removed", "unconfirmed", "disconnected"])(
    "rejects an unavailable target: %s",
    (reason) => {
      const f = fixture();
      if (reason === "unpaired")
        store.db
          .prepare("DELETE FROM state WHERE namespace='identities' AND id=?")
          .run(imIdentityKey(f.b));
      if (reason === "revoked")
        store.put("devices", f.bob.id, { ...f.bob, revoked: true });
      if (reason === "removed")
        store.put("spaces", "team", {
          ...f.space,
          participants: f.space.participants.slice(0, 1),
        });
      if (reason === "unconfirmed")
        store.put("space-confirmations", "team", []);
      if (reason === "disconnected")
        store.put("spaces", "team", {
          ...f.space,
          endpoints: f.space.endpoints.slice(0, 1),
        });
      f.send();
      expect(store.pending("device")).toHaveLength(0);
    },
  );
  it("denies a sender outside the space and rechecks revoked authorization before delivery", () => {
    const f = fixture();
    f.send();
    const request =
      store.pending<RemoteInvocationContext>("device")[0]!.payload;
    store.put("spaces", "team", {
      ...f.space,
      participants: f.space.participants.slice(1),
    });
    expect(f.router.isInvocationAuthorized(request)).toBe(false);
    f.send({ messageId: "again" });
    expect(store.pending("device")).toHaveLength(1);
  });
  it("does not transport source attachments through another platform's credentials", () => {
    const f = fixture();
    f.send({
      attachments: [{ kind: "file", resourceId: "file", name: "test.txt" }],
    });
    expect(store.pending("device")).toHaveLength(0);
  });
  it("keeps ordinary group chatter out of the task router", () => {
    const f = fixture();
    f.send({ mentioned: false });
    expect(store.pending("device")).toHaveLength(0);
  });
});
