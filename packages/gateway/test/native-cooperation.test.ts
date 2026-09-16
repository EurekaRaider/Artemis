import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ChannelEvent, RemoteInvocationContext } from "@artemis/protocol";
import { GatewayStore } from "../src/store.js";
import { GatewayRouter, type Delivery } from "../src/router.js";
import { saveNativeGroup } from "../src/native-groups.js";
import {
  encodeNativeEnvelope,
  type NativeEnvelope,
} from "../src/native-protocol.js";
const stores: GatewayStore[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  stores.splice(0).forEach((s) => s.close());
  directories
    .splice(0)
    .forEach((path) => rmSync(path, { recursive: true, force: true }));
});
function instance(
  bot: string,
  database = ":memory:",
  platform: "slack" | "feishu" | "lark" = "slack",
) {
  const store = new GatewayStore(database, "e".repeat(32));
  stores.push(store);
  const router = new GatewayRouter(store);
  const device = store.register(bot);
  const identity = {
    channel: platform === "slack" ? ("slack" as const) : ("feishu" as const),
    connectionId: bot,
    tenantId: "team",
    appId: `app-${bot}`,
    userId: `owner-${bot}`,
  };
  const conversation = {
    connectionId: bot,
    id: "group",
    kind: "group" as const,
  };
  store.put("connections", bot, {
    sealed: store.seal({
      id: bot,
      name: bot,
      channel: identity.channel,
      domain: platform === "lark" ? "lark" : "feishu",
      botOpenId: bot,
      tenantId: "team",
      appId: `app-${bot}`,
      botUserId: bot,
      botToken: "xoxb-test",
      appToken: "xapp-test",
      enabled: true,
    }),
  });
  store.pair(store.pairCode(device.id), identity);
  const event: ChannelEvent = {
    version: 1,
    messageId: randomUUID(),
    identity,
    conversation,
    text: "hello",
    mentioned: true,
    bot: false,
    timestamp: Date.now(),
    attachments: [],
  };
  router.ingest(event);
  router.processIncoming();
  const group = saveNativeGroup(store, {
    conversation,
    owner: identity,
    deviceId: device.id,
    name: "Group",
    projectId: "project",
    enabled: true,
  });
  for (const item of store.pending("outgoing"))
    store.mark("outgoing", item.id, "done");
  return { store, router, device, event, group, bot };
}
function exchange(
  a: ReturnType<typeof instance>,
  b: ReturnType<typeof instance>,
) {
  // Only serialized IM text crosses this boundary; never pass an invocation,
  // database, device ID, desktop thread ID, or local gateway URL to the peer.
  for (const item of a.store.pending<Delivery>("outgoing", Date.now(), a.bot)) {
    if (!item.payload.native || !a.router.canDeliver(item.payload)) continue;
    const event = {
      ...b.event,
      messageId: randomUUID(),
      timestamp: Date.now(),
      bot: true,
      text: item.payload.text,
      identity: { ...b.event.identity, userId: a.bot },
    };
    b.router.ingest(event);
    a.store.mark("outgoing", item.id, "done");
  }
}
function pair(database = ":memory:") {
  const a = instance("A", database),
    b = instance("B");
  a.router.native.probe(a.group.id);
  b.router.native.probe(b.group.id);
  exchange(a, b);
  exchange(b, a);
  a.router.native.probe(a.group.id, "B");
  b.router.native.probe(b.group.id, "A");
  exchange(a, b);
  exchange(b, a);
  exchange(a, b);
  expect(a.router.native.peers(a.group.id)[0]?.verifiedAt).toBeTruthy();
  expect(b.router.native.peers(b.group.id)[0]?.verifiedAt).toBeTruthy();
  a.router.native.authorize(a.group.id, ["B"]);
  b.router.native.authorize(b.group.id, ["A"]);
  const request = a.router.groupConversationContext(a.device.id, a.group.id);
  return { a, b, request };
}
function delegate(f: ReturnType<typeof pair>, text = "Build result") {
  return f.a.router.native.command(f.request, "coordinator", randomUUID(), {
    action: "delegate",
    participantId: "B",
    text,
  }) as Array<{ id: string }>;
}
it("requires authenticated bot identity and a correlated IM proof before authorizing peers", () => {
  const a = instance("A"),
    b = instance("B");
  expect(() => a.router.native.authorize(a.group.id, ["B"])).toThrow(
    /round-trip/,
  );
  b.router.native.probe(b.group.id);
  const text = b.store
    .pending<Delivery>("outgoing", Date.now(), b.bot)
    .find((q) => q.payload.native)!.payload.text;
  expect(a.router.ingest({ ...a.event, text })).toBe(false);
  expect(a.store.pending("device")).toHaveLength(0);
  const envelope = b.store
    .outgoing<Delivery>(b.bot)
    .find((q) => q.payload.native)!.payload.native!;
  for (const patch of [
    { sender: "forged" },
    { tenant: "other" },
    { group: "other" },
  ]) {
    expect(
      a.router.ingest({
        ...a.event,
        bot: true,
        identity: { ...a.event.identity, userId: "B" },
        text: encodeNativeEnvelope({ ...envelope, ...patch }),
      }),
    ).toBe(false);
  }
  expect(a.router.native.peers(a.group.id)).toEqual([]);
});
it("persists before acceptance, ignores duplicate dispatch and advances only successful dependencies", () => {
  const f = pair();
  const [first] = delegate(f);
  f.a.router.native.command(f.request, "coordinator", "dependent", {
    action: "delegate-many",
    text: "",
    assignments: [
      { participantId: "B", text: "Review result", dependsOn: [first!.id] },
    ],
  });
  expect(
    f.a.router.native
      .tasks(f.a.group.id)
      .map((t) => t.state)
      .sort(),
  ).toEqual(["blocked", "sent"]);
  exchange(f.a, f.b);
  expect(f.b.store.pending("device")).toHaveLength(1);
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === first!.id)
      ?.state,
  ).toBe("sent");
  const task = f.b.router.native.tasks(f.b.group.id)[0]!;
  const duplicate: ChannelEvent = {
    ...f.b.event,
    bot: true,
    identity: { ...f.b.event.identity, userId: "A" },
    text: encodeNativeEnvelope(task.envelope),
  };
  f.b.router.ingest(duplicate);
  f.b.router.ingest(duplicate);
  expect(f.b.store.pending("device")).toHaveLength(1);
  exchange(f.b, f.a);
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === first!.id)
      ?.state,
  ).toBe("accepted");
  const request = f.b.store.get<RemoteInvocationContext>(
    "invocations",
    task.invocationId,
  )!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: request.id,
    taskId: "worker",
    text: "Artifact result",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  f.a.router.native.tick();
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id !== first!.id)
      ?.state,
  ).toBe("sent");
  exchange(f.a, f.b);
  expect(f.b.store.pending("device")).toHaveLength(2);
  expect(
    f.b.router.native.tasks(f.b.group.id).find((t) => t.id !== first!.id)?.text,
  ).toContain("Artifact result");
});
it("keeps remote cancellation pending until the peer confirms and terminal states resist late progress", () => {
  const f = pair();
  const [task] = delegate(f);
  exchange(f.a, f.b);
  exchange(f.b, f.a);
  f.a.router.native.command(f.request, "coordinator", "cancel", {
    action: "cancel",
    taskId: task!.id,
    text: "",
  });
  expect(f.a.router.native.tasks(f.a.group.id)[0]?.state).toBe("cancel-sent");
  exchange(f.a, f.b);
  const cancel = f.b.store
    .pending<RemoteInvocationContext>("device")
    .find((q) => q.payload.control === "cancel")!;
  expect(cancel).toBeTruthy();
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: cancel.payload.id,
    text: "Cancelled",
    final: true,
    outcome: "cancelled",
  });
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]?.state).toBe("cancelled");
  const remote = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: remote.invocationId,
    text: "late progress",
    started: true,
  });
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]?.state).toBe("cancelled");
});
it("allows more than 16 handoffs while preserving command idempotence and authorization", () => {
  const f = pair();
  const command = {
    action: "delegate" as const,
    participantId: "B",
    text: "Work",
  };
  const first = f.a.router.native.command(
    f.request,
    "coordinator",
    "same",
    command,
  );
  expect(
    f.a.router.native.command(f.request, "coordinator", "same", command),
  ).toEqual(first);
  expect(() =>
    f.a.router.native.command(f.request, "coordinator", "same", {
      ...command,
      text: "different",
    }),
  ).toThrow(/already used/);
  const workflow = f.a.router.native.tasks(f.a.group.id)[0]!.workflow;
  // Persisted budgets from the previous implementation must not restrict work.
  f.a.store.put(
    "native-workflows",
    JSON.stringify([f.request.id, "coordinator"]),
    {
      id: workflow,
      count: 16,
      limit: 16,
    },
  );
  for (let i = 1; i < 32; i++) delegate(f);
  expect(f.a.router.native.tasks(f.a.group.id)).toHaveLength(32);
  f.b.router.native.authorize(f.b.group.id, []);
  exchange(f.a, f.b);
  expect(f.b.store.pending("device")).toHaveLength(0);
});

it("does not advance on held/empty results, and late progress cannot clear a pending cancellation", () => {
  const f = pair();
  const [first] = delegate(f);
  exchange(f.a, f.b);
  exchange(f.b, f.a);
  const worker = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: "held",
    invocationId: worker.invocationId,
    text: "Awaiting owner review",
    final: true,
    deliveryState: "pending",
  });
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]?.state).not.toBe("completed");
  f.a.router.native.command(f.request, "coordinator", "cancel-race", {
    action: "cancel",
    taskId: first!.id,
    text: "",
  });
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: "late",
    invocationId: worker.invocationId,
    text: "Still working",
    started: true,
  });
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]?.state).toBe("cancel-sent");
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: "empty",
    invocationId: worker.invocationId,
    text: "",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]?.state).toBe("failed");
});
it("marks restart uncertainty without resending and queues IM cancellation when authorization is revoked", () => {
  const f = pair();
  const [first] = delegate(f);
  const task = f.a.router.native.tasks(f.a.group.id)[0]!;
  f.a.store.mark("outgoing", `native:${task.envelope.id}`, "uncertain");
  const restarted = new GatewayRouter(f.a.store);
  restarted.native.tick();
  expect(restarted.native.tasks(f.a.group.id)[0]?.state).toBe("uncertain");
  expect(
    f.a.store
      .pending<Delivery>("outgoing")
      .filter((i) => i.payload.native?.task === first!.id),
  ).toHaveLength(0);
  const [second] = restarted.native.command(
    f.request,
    "coordinator",
    "second",
    { action: "delegate", participantId: "B", text: "Other work" },
  ) as Array<{ id: string }>;
  exchange(f.a, f.b);
  exchange(f.b, f.a);
  restarted.native.authorize(f.a.group.id, []);
  restarted.native.tick();
  const cancellation = f.a.store
    .pending<Delivery>("outgoing")
    .find(
      (i) =>
        i.payload.native?.action === "cancel" &&
        i.payload.native.task === second!.id,
    )!;
  expect(cancellation).toBeTruthy();
  expect(restarted.canDeliver(cancellation.payload)).toBe(true);
  exchange(f.a, f.b);
  expect(
    f.b.store
      .pending<RemoteInvocationContext>("device")
      .some((i) => i.payload.control === "cancel"),
  ).toBe(true);
});
it("halts failed dependencies, rejects foreign task IDs and never executes expired dispatch", () => {
  const f = pair();
  const [first] = delegate(f);
  expect(() =>
    f.a.router.native.command(f.request, "coordinator", "bad-dep", {
      action: "delegate-many",
      text: "",
      assignments: [
        { participantId: "B", text: "Next", dependsOn: [randomUUID()] },
      ],
    }),
  ).toThrow(/Dependencies/);
  const [dependent] = f.a.router.native.command(
    f.request,
    "coordinator",
    "dep",
    {
      action: "delegate-many",
      text: "",
      assignments: [
        { participantId: "B", text: "Next", dependsOn: [first!.id] },
      ],
    },
  ) as Array<{ id: string }>;
  exchange(f.a, f.b);
  exchange(f.b, f.a);
  const worker = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: "failure",
    invocationId: worker.invocationId,
    text: "Failed",
    final: true,
    outcome: "failed",
  });
  exchange(f.b, f.a);
  f.a.router.native.tick();
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === dependent!.id)
      ?.state,
  ).toBe("failed");
  const expired: NativeEnvelope = {
    ...worker.envelope,
    id: randomUUID(),
    task: randomUUID(),
    expiresAt: Date.now() - 1,
  };
  expect(
    f.b.router.ingest({
      ...f.b.event,
      bot: true,
      identity: { ...f.b.event.identity, userId: "A" },
      text: encodeNativeEnvelope(expired),
    }),
  ).toBe(false);
  expect(f.b.store.pending("device")).toHaveLength(1);
});

it("recovers the actual SQLite store with an uncertain send and never recreates the task", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-im-restart-"));
  directories.push(directory);
  const path = join(directory, "gateway.sqlite");
  const f = pair(path);
  const command = {
    action: "delegate" as const,
    participantId: "B",
    text: "Persisted work",
  };
  f.a.router.native.command(
    f.request,
    "coordinator",
    "persisted-call",
    command,
  );
  const task = f.a.router.native.tasks(f.a.group.id)[0]!;
  f.a.store.mark("outgoing", `native:${task.envelope.id}`, "sending");
  stores.splice(stores.indexOf(f.a.store), 1);
  f.a.store.close();
  const recovered = new GatewayStore(path, "e".repeat(32));
  stores.push(recovered);
  const router = new GatewayRouter(recovered);
  router.native.tick();
  expect(router.native.tasks(f.a.group.id)[0]?.state).toBe("uncertain");
  router.native.command(f.request, "coordinator", "persisted-call", command);
  expect(router.native.tasks(f.a.group.id)).toHaveLength(1);
  expect(
    recovered
      .pending<Delivery>("outgoing")
      .filter((q) => q.payload.native?.action === "delegate"),
  ).toHaveLength(0);
  expect(router.native.peers(f.a.group.id)[0]?.verifiedAt).toBeTruthy();
});

it("rejects assignments from a blocked peer and resumes only after unblocking", () => {
  const f = pair();
  const identity = { ...f.b.event.identity, userId: "A" };
  const key = JSON.stringify([
    f.b.group.id,
    JSON.stringify([
      identity.channel,
      identity.connectionId,
      identity.tenantId,
      identity.appId,
      identity.userId,
    ]),
  ]);
  f.b.store.put("group-denied-senders", key, true);
  const tasks = delegate(f);
  exchange(f.a, f.b);
  exchange(f.b, f.a);
  expect(f.b.store.pending("device")).toHaveLength(0);
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === tasks[0]!.id)
      ?.state,
  ).toBe("rejected");
  f.b.store.delete("group-denied-senders", key);
  delegate(f, "Allowed again");
  exchange(f.a, f.b);
  expect(f.b.store.pending("device")).toHaveLength(1);
});

it("discovers bots from the roster but requires owner permission and proof before dispatch", () => {
  const a = instance("A"),
    b = instance("B");
  for (const [local, remote] of [
    [a, b],
    [b, a],
  ]) {
    local!.store.put("native-group-info", local!.group.id, {
      roster: {
        complete: true,
        members: [
          {
            identity: { ...local!.event.identity, userId: remote!.bot },
            name: remote!.bot,
            kind: "bot",
          },
        ],
      },
    });
    local!.router.native.syncRoster(local!.group.id);
    expect(local!.store.pending("outgoing")).toHaveLength(0);
    local!.router.native.setMemberAssignment(
      local!.group.id,
      remote!.bot,
      true,
    );
    local!.router.native.syncRoster(local!.group.id);
    local!.router.native.syncRoster(local!.group.id);
    expect(local!.store.pending("outgoing")).toHaveLength(1);
  }
  const request = a.router.groupConversationContext(a.device.id, a.group.id);
  expect(() => delegate({ a, b, request })).toThrow();
  exchange(a, b);
  exchange(b, a);
  exchange(a, b);
  expect(a.router.native.peers(a.group.id)[0]?.verifiedAt).toBeTruthy();
  delegate({ a, b, request });
  exchange(a, b);
  expect(b.store.pending("device")).toHaveLength(1);
  b.router.native.setMemberAssignment(b.group.id, "A", false);
  delegate({ a, b, request });
  exchange(a, b);
  expect(b.store.pending("device")).toHaveLength(1);
  const saved = saveNativeGroup(a.store, {
    conversation: a.event.conversation,
    owner: a.event.identity,
    deviceId: a.device.id,
    name: "Renamed",
    projectId: "project",
    enabled: true,
  });
  expect(saved.nativeGroup?.allowedBots).toEqual(["B"]);
  expect(saved.nativeGroup?.capability).toBe("events");
});

it.each(["feishu", "lark"] as const)(
  "discovers authenticated %s bots without granting work and probes a partial directory",
  (platform) => {
    const a = instance("A", ":memory:", platform),
      b = instance("B", ":memory:", platform);
    const event = {
      ...a.event,
      bot: true,
      timestamp: Date.now(),
      identity: { ...a.event.identity, userId: "B" },
    };
    a.router.native.observeBot({ ...event, bot: false });
    a.router.native.observeBot({
      ...event,
      identity: { ...event.identity, tenantId: "wrong" },
    });
    expect(a.router.native.peers(a.group.id)).toEqual([]);
    a.router.native.observeBot(event);
    expect(a.router.native.peers(a.group.id)).toEqual([{ id: "B", name: "B" }]);
    expect(a.store.pending("device")).toHaveLength(0);
    expect(() => a.router.native.authorize(a.group.id, ["B"])).toThrow(
      /round-trip/,
    );
    a.router.native.setMemberAssignment(a.group.id, "B", true);
    a.router.native.syncRoster(a.group.id);
    exchange(a, b);
    exchange(b, a);
    expect(a.router.native.peers(a.group.id)[0]?.verifiedAt).toBeTruthy();
    const request = a.router.groupConversationContext(a.device.id, a.group.id);
    // Receiver still rejects assignment until its own owner authorizes this peer.
    b.router.native.probe(b.group.id, "A");
    exchange(b, a);
    exchange(a, b);
    b.router.native.authorize(b.group.id, ["A"]);
    a.router.native.command(request, "coordinator", "delegate", {
      action: "delegate",
      participantId: "B",
      text: "Check project",
    });
    exchange(a, b);
    exchange(b, a);
    expect(b.router.native.tasks(b.group.id)).toEqual([
      expect.objectContaining({ state: "accepted", text: "Check project" }),
    ]);
    expect(a.router.native.tasks(a.group.id)[0]?.state).toBe("accepted");
  },
);

it("probes once across cooldowns and restarts, but allows a bounded manual retry", () => {
  vi.useFakeTimers();
  const a = instance("A");
  a.store.put("native-group-info", a.group.id, {
    roster: {
      complete: true,
      members: [
        {
          identity: { ...a.event.identity, userId: "B" },
          name: "Solar",
          kind: "bot",
        },
      ],
    },
  });
  a.router.native.setMemberAssignment(a.group.id, "B", true);
  a.router.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(1);
  vi.advanceTimersByTime(360000);
  const restarted = new GatewayRouter(a.store);
  restarted.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(1);
  // Legacy cooldown timestamps also mean an attempt was already made.
  a.store.put(
    "native-auto-probe",
    JSON.stringify([a.group.id, "B"]),
    Date.now() - 1,
  );
  restarted.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(1);
  restarted.native.probe(a.group.id, "B");
  restarted.native.probe(a.group.id, "B");
  expect(a.store.pending("outgoing")).toHaveLength(2);
  expect(restarted.native.pendingProbeUntil(a.group.id, "B")).toBe(
    Date.now() + 30000,
  );
  vi.advanceTimersByTime(31000);
  restarted.native.probe(a.group.id, "B");
  expect(a.store.pending("outgoing")).toHaveLength(3);
  expect(() => restarted.native.authorize(a.group.id, ["B"])).toThrow();
});
