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
  decodeNativeEnvelope,
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
function delegate(
  f: ReturnType<typeof pair>,
  text = "Build result",
  newTask = false,
) {
  return f.a.router.native.command(f.request, "coordinator", randomUUID(), {
    action: "delegate",
    participantId: "B",
    newTask,
    text,
  }) as Array<{ id: string }>;
}

it("keeps v1 envelopes compatible with peers that do not advertise locale support", () => {
  const f = pair();
  const peer = f.a.router.native.peers(f.a.group.id)[0]!;
  f.a.store.put("native-peers", f.a.group.id, [
    { ...peer, localizedMessages: false },
  ]);
  f.request = { ...f.request, locale: "ja" };
  delegate(f);
  const delivery = f.a.store
    .pending<Delivery>("outgoing")
    .find((item) => item.payload.native?.action === "delegate")!;
  expect(delivery.payload.native?.locale).toBe("ja");
  expect(decodeNativeEnvelope(delivery.payload.text)).not.toHaveProperty(
    "locale",
  );
});

it("carries the initiating language across native delegation without translating content", () => {
  const f = pair();
  f.request = { ...f.request, locale: "ja" };
  f.b.store.put("device-locales", f.b.device.id, "de");
  const text = "原文を保持 / keep original";
  delegate(f, text);
  exchange(f.a, f.b);
  const task = f.b.router.native.tasks(f.b.group.id)[0]!;
  const request = f.b.store.get<RemoteInvocationContext>(
    "invocations",
    task.invocationId,
  )!;
  expect(request).toMatchObject({ locale: "ja", text });
  f.b.router.native.reply(request, {
    version: 1,
    id: randomUUID(),
    invocationId: request.id,
    text: "原始结果 / original result",
    final: true,
    visibility: "conversation",
    outcome: "completed",
  });
  const outgoing = f.b.store
    .pending<Delivery>("outgoing")
    .find((item) => item.payload.native?.action === "completed");
  expect(outgoing?.payload.native).toMatchObject({
    locale: "ja",
    text: "原始结果 / original result",
  });
});

it("delivers cancellation acknowledgments after the worker's data grant expires", () => {
  const f = pair();
  const [sent] = delegate(f);
  exchange(f.a, f.b);
  const incoming = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.native.reply(
    f.b.store.get<RemoteInvocationContext>(
      "invocations",
      incoming.invocationId,
    )!,
    {
      version: 1,
      id: randomUUID(),
      invocationId: incoming.invocationId,
      taskId: "worker",
      text: "Running",
      started: true,
      final: false,
      visibility: "conversation",
    },
  );
  exchange(f.b, f.a);
  f.b.store.put("invocation-security", incoming.invocationId, {
    version: 2,
    deviceId: f.b.device.id,
    projectId: "project",
    revision: "expired",
    audience: `space:${f.b.group.id}`,
  });
  f.b.store.put("device-security", f.b.device.id, { version: 2, grants: [] });
  f.a.router.native.command(f.request, "coordinator", randomUUID(), {
    action: "cancel",
    taskId: sent!.id,
    text: "",
  });
  exchange(f.a, f.b);
  const cancel = f.b.store
    .list<RemoteInvocationContext>("invocations")
    .find((r) => r.control === "cancel")!;
  expect(cancel).toBeDefined();
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: cancel.id,
    text: "任务已取消。",
    final: true,
    outcome: "cancelled",
    visibility: "conversation",
  });
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]!.state).toBe("cancelled");
});
it.each([
  {
    status: "waiting",
    final: false,
    action: "progress",
    text: "请补充目标分支，收到后继续。",
  },
  {
    status: "completed",
    final: true,
    action: "completed",
    text: "任务已完成，检查通过。",
  },
  {
    status: "failed",
    final: true,
    action: "failed",
    text: "连接失败，请恢复连接后重试。",
  },
] as const)(
  "returns $status and next actions to the dispatching bot",
  ({ status, final, action, text }) => {
    const f = pair();
    delegate(f);
    exchange(f.a, f.b);
    const task = f.b.router.native.tasks(f.b.group.id)[0]!;
    const reply = {
      version: 1,
      id: "worker-status",
      invocationId: task.invocationId,
      taskId: "worker",
      final,
      status,
      text,
      ...(final ? { outcome: status } : {}),
    };
    f.b.router.receiveReply(f.b.device.id, reply);
    f.b.router.receiveReply(f.b.device.id, reply);
    const responses = f.b.store
      .pending<Delivery>("outgoing")
      .filter((item) => item.payload.native?.text === text);
    expect(responses).toHaveLength(1);
    expect(responses[0]!.payload.native).toMatchObject({
      sender: "B",
      recipient: "A",
      action,
      text,
    });
    exchange(f.b, f.a);
    const returned = f.a.router.native.tasks(f.a.group.id)[0]!;
    expect(returned.result).toBe(text);
    expect(returned.state).toBe(final ? status : "running");
  },
);

it.each(["owner-A", "dispatcher"])(
  "mentions requester %s when the coordinator returns a delegated result",
  (userId) => {
    const f = pair();
    f.a.router.ingest({
      ...f.a.event,
      messageId: randomUUID(),
      identity: { ...f.a.event.identity, userId },
      timestamp: Date.now(),
    });
    f.a.router.processIncoming();
    f.request =
      f.a.store.pending<RemoteInvocationContext>("device")[0]!.payload;
    delegate(f);
    exchange(f.a, f.b);
    const task = f.b.router.native.tasks(f.b.group.id)[0]!;
    f.b.router.receiveReply(f.b.device.id, {
      version: 1,
      id: randomUUID(),
      invocationId: task.invocationId,
      taskId: "worker",
      text: "当前工程是 KairosBoot",
      final: true,
      outcome: "completed",
    });
    exchange(f.b, f.a);
    const command = {
      action: "finish" as const,
      text: "Jupiter 回复：KairosBoot",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      f.a.router.native.command(f.request, "coordinator", "finish", command);
    const summaries = f.a.store
      .pending<Delivery>("outgoing")
      .filter((item) => item.payload.text === command.text);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.payload.mentionUserId).toBe(userId);
    f.a.router.receiveReply(f.a.device.id, {
      version: 1,
      id: "coordinator-final",
      invocationId: f.request.id,
      taskId: "coordinator",
      text: "普通最终回复：KairosBoot",
      final: true,
      outcome: "completed",
    });
    expect(
      f.a.store
        .pending<Delivery>("outgoing")
        .find((item) => item.payload.text.includes("普通最终回复：KairosBoot"))
        ?.payload.mentionUserId,
    ).toBe(userId);
  },
);

it("continues the same peer session across coordinator turns, with an explicit fresh-task escape", () => {
  const f = pair();
  const [first] = delegate(f);
  exchange(f.a, f.b);
  const incoming = f.b.router.native.tasks(f.b.group.id)[0]!;
  expect(() => delegate(f, "Too soon")).toThrow(/Wait/);
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "worker-session",
    text: "Done",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  const nextRequest = { ...f.request, id: randomUUID() };
  f.a.store.put("invocations", nextRequest.id, nextRequest);
  const [next] = f.a.router.native.command(
    nextRequest,
    "coordinator",
    "follow-up",
    {
      action: "delegate",
      participantId: "B",
      text: "Continue with the result",
    },
  ) as Array<{ id: string }>;
  const continuation = f.a.router.native
    .tasks(f.a.group.id)
    .find((t) => t.id === next!.id)!.envelope;
  expect(
    f.a.router.canDeliver({
      conversation: { ...f.a.event.conversation, spaceId: f.a.group.id },
      text: "",
      native: { ...continuation, expiresAt: Date.now() - 1 },
    }),
  ).toBe(false);
  // Continuation cannot borrow a different peer's or group's session.
  for (const patch of [
    { peer: "other-bot" },
    { groupId: "other-group" },
    { state: "running" as const },
  ]) {
    f.b.store.put("native-tasks", incoming.id, {
      ...f.b.router.native
        .tasks(f.b.group.id)
        .find((t) => t.id === incoming.id)!,
      ...patch,
    });
    const count = f.b.store.pending("device").length;
    expect(
      f.b.router.native.receive({
        ...f.b.event,
        bot: true,
        identity: { ...f.b.event.identity, userId: "A" },
        text: encodeNativeEnvelope(continuation),
      }),
    ).toBe(false);
    expect(f.b.store.pending("device")).toHaveLength(count);
    f.b.store.put("native-tasks", incoming.id, {
      ...incoming,
      state: "completed",
      threadId: "worker-session",
    });
  }
  exchange(f.a, f.b);
  const resumed = f.b.router.native
    .tasks(f.b.group.id)
    .find((t) => t.id === next!.id)!;
  expect(next!.id).not.toBe(first!.id);
  expect(
    f.b.store.get<RemoteInvocationContext>("invocations", resumed.invocationId),
  ).toMatchObject({
    taskId: "worker-session",
    nativeTaskId: next!.id,
    collaboration: { taskId: next!.id },
  });
  // Retrying the same transport message must not schedule another turn.
  const count = f.b.store.pending("device").length;
  f.b.router.ingest({
    ...f.b.event,
    messageId: randomUUID(),
    bot: true,
    identity: { ...f.b.event.identity, userId: "A" },
    text: encodeNativeEnvelope(resumed.envelope),
  });
  expect(f.b.store.pending("device")).toHaveLength(count);
  const [fresh] = f.a.router.native.command(
    nextRequest,
    "coordinator",
    "fresh",
    {
      action: "delegate",
      participantId: "B",
      text: "Independent task",
      newTask: true,
    },
  ) as Array<{ id: string }>;
  exchange(f.a, f.b);
  const freshTask = f.b.router.native
    .tasks(f.b.group.id)
    .find((t) => t.id === fresh!.id)!;
  expect(
    f.b.store.get<RemoteInvocationContext>(
      "invocations",
      freshTask.invocationId,
    )?.taskId,
  ).toBeUndefined();
  const [separate] = f.a.router.native.command(
    nextRequest,
    "another-coordinator",
    "separate",
    {
      action: "delegate",
      participantId: "B",
      text: "A different coordinator session",
      newTask: true,
    },
  ) as Array<{ id: string }>;
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === separate!.id)
      ?.envelope.action,
  ).toBe("delegate");
});
it("continues across local tasks and single-recipient batches after a gateway restart", () => {
  const f = pair();
  const [first] = delegate(f);
  exchange(f.a, f.b);
  const incoming = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "worker-session",
    text: "Done",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  const restarted = new GatewayRouter(f.a.store);
  const [next] = restarted.native.command(
    f.request,
    "another-local-task",
    randomUUID(),
    {
      action: "delegate-many",
      text: "",
      assignments: [{ participantId: "B", text: "Follow-up" }],
    },
  ) as Array<{ id: string }>;
  const task = restarted.native
    .tasks(f.a.group.id)
    .find((t) => t.id === next!.id)!;
  expect(task.envelope).toMatchObject({
    action: "continue",
    previousTask: first!.id,
  });
  expect(task.sessionId).toBe(first!.id);
  expect(task.sessionReason).toBe("continued");
  exchange(f.a, f.b);
  const received = f.b.router.native
    .tasks(f.b.group.id)
    .find((t) => t.id === next!.id)!;
  expect(
    f.b.store.get<RemoteInvocationContext>("invocations", received.invocationId)
      ?.taskId,
  ).toBe("worker-session");
  expect(received.sessionId).toBe(first!.id);
});

it("shares peer sessions across group senders while isolating grants and reporting lost associations", () => {
  const f = pair();
  const [first] = delegate(f);
  // Same peer and grant while busy must not silently start a fresh session.
  expect(() => delegate(f, "Follow up")).toThrow(/Wait/);
  const scoped = { ...f.request, id: randomUUID() };
  f.a.store.put("invocations", scoped.id, scoped);
  f.a.store.put("invocation-security", scoped.id, {
    deviceId: f.a.device.id,
    projectId: "other-project",
    audience: `space:${f.a.group.id}`,
    revision: "other-grant",
  });
  const [separate] = f.a.router.native.command(
    scoped,
    "coordinator",
    randomUUID(),
    {
      action: "delegate",
      participantId: "B",
      text: "Different grant",
    },
  ) as Array<{ id: string }>;
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === separate!.id)
      ?.envelope.action,
  ).toBe("delegate");
  // A different human sender belongs to the same group task.
  f.a.router.ingest({
    ...f.a.event,
    messageId: randomUUID(),
    identity: { ...f.a.event.identity, userId: "member" },
    text: "Member assignment",
    timestamp: Date.now(),
  });
  f.a.router.processIncoming();
  const member = f.a.store
    .list<RemoteInvocationContext>("invocations")
    .find((r) => r.originator?.userId === "member")!;
  expect(member).toBeDefined();
  expect(() =>
    f.a.router.native.command(member, "coordinator", randomUUID(), {
      action: "delegate",
      participantId: "B",
      text: "Member follow-up while busy",
    }),
  ).toThrow(/Wait/);
  exchange(f.a, f.b);
  const incoming = f.b.router.native
    .tasks(f.b.group.id)
    .find((t) => t.id === first!.id)!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "shared-worker-session",
    text: "Done",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  const [memberTask] = f.a.router.native.command(
    member,
    "coordinator",
    randomUUID(),
    {
      action: "delegate",
      participantId: "B",
      text: "Member work",
    },
  ) as Array<{ id: string }>;
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === memberTask!.id)
      ?.envelope.action,
  ).toBe("continue");
  exchange(f.a, f.b);
  const received = f.b.router.native
    .tasks(f.b.group.id)
    .find((t) => t.id === memberTask!.id)!;
  expect(
    f.b.store.get<RemoteInvocationContext>("invocations", received.invocationId)
      ?.taskId,
  ).toBe("shared-worker-session");
  f.a.store.delete("native-tasks", memberTask!.id);
  expect(() => delegate(f, "Follow up")).toThrow(
    /saved peer session is missing/,
  );
});

it("rejects an unavailable continuation instead of silently dropping it or creating a new task", () => {
  const f = pair();
  const [first] = delegate(f);
  exchange(f.a, f.b);
  const incoming = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "worker",
    text: "Done",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  f.b.store.delete("native-tasks", first!.id);
  const [next] = delegate(f, "Follow up");
  exchange(f.a, f.b);
  exchange(f.b, f.a);
  const rejected = f.a.router.native
    .tasks(f.a.group.id)
    .find((t) => t.id === next!.id)!;
  expect(rejected.state).toBe("rejected");
  expect(rejected.result).toContain("saved peer session is missing");
  expect(f.b.router.native.tasks(f.b.group.id)).toHaveLength(0);
});

it("migrates the latest sender-keyed session after restart without crossing its saved grant", () => {
  const f = pair();
  const [first] = delegate(f);
  exchange(f.a, f.b);
  const incoming = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "legacy-worker-session",
    text: "Done",
    final: true,
    outcome: "completed",
  });
  exchange(f.b, f.a);
  const task = f.a.router.native
    .tasks(f.a.group.id)
    .find((t) => t.id === first!.id)!;
  const key = JSON.parse(task.sessionKey!) as unknown[];
  const legacyKey = JSON.stringify([
    ...key.slice(0, 3),
    "another-human",
    ...key.slice(3),
  ]);
  f.a.store.delete("native-sessions-v3", task.sessionKey!);
  f.a.store.put("native-sessions-v2", legacyKey, task.id);
  f.a.store.put("native-tasks", task.id, { ...task, sessionKey: legacyKey });
  // A more recent session from another permission revision must stay separate.
  const foreignId = randomUUID();
  const foreignKey = JSON.parse(legacyKey);
  foreignKey[7] = "obsolete-grant";
  f.a.store.put("native-tasks", foreignId, {
    ...task,
    id: foreignId,
    sessionKey: JSON.stringify(foreignKey),
    updatedAt: task.updatedAt + 100,
  });
  const restarted = new GatewayRouter(f.a.store);
  const [next] = restarted.native.command(
    f.request,
    "coordinator",
    randomUUID(),
    {
      action: "delegate",
      participantId: "B",
      text: "Follow up",
    },
  ) as Array<{ id: string }>;
  expect(
    restarted.native.tasks(f.a.group.id).find((t) => t.id === next!.id)
      ?.envelope,
  ).toMatchObject({ action: "continue", previousTask: first!.id });
  exchange(f.a, f.b);
  const received = f.b.router.native
    .tasks(f.b.group.id)
    .find((t) => t.id === next!.id)!;
  expect(
    f.b.store.get<RemoteInvocationContext>("invocations", received.invocationId)
      ?.taskId,
  ).toBe("legacy-worker-session");
});

it("reports malformed delegation separately from authorization without dispatching", () => {
  const f = pair();
  expect(
    f.a.router.native.command(f.request, "coordinator", "peers", {
      action: "participants",
      text: "",
    }),
  ).toMatchObject([{ id: "B" }]);
  const outgoing = f.a.store.pending("outgoing");
  expect(() =>
    f.a.router.native.command(f.request, "coordinator", "bad", {
      action: "delegate",
      text: "",
      assignments: [{ participantId: "B", text: "Memory?" }],
    }),
  ).toThrow("delegate-many");
  expect(() => delegate(f, "  ")).toThrow("nonempty text");
  expect(() =>
    f.a.router.native.command(f.request, "coordinator", "note", {
      action: "message",
      participantId: "B",
      text: "Memory?",
    }),
  ).toThrow("taskId");
  expect(f.a.router.native.tasks(f.a.group.id)).toEqual([]);
  expect(f.a.store.pending("outgoing")).toEqual(outgoing);
  expect(() =>
    f.a.router.native.command(f.request, "coordinator", "unauthorized", {
      action: "delegate",
      participantId: "unknown",
      text: "Memory?",
    }),
  ).toThrow("Bot is not authorized or verified");
  const [task] = delegate(f);
  expect(
    f.a.router.native.command(f.request, "coordinator", "valid-note", {
      action: "message",
      taskId: task!.id,
      text: "Memory?",
    }),
  ).toMatchObject({ state: "note-queued", taskId: task!.id });
});
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
  for (let i = 1; i < 32; i++) delegate(f, "Independent work", true);
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
    {
      action: "delegate",
      participantId: "B",
      text: "Other work",
      newTask: true,
    },
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
  delegate({ a, b, request }, "Independent work", true);
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

it("retries only authorized peer discovery with a persisted three-attempt budget", () => {
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
        {
          identity: { ...a.event.identity, userId: "C" },
          name: "Unknown",
          kind: "bot",
        },
      ],
    },
  });
  a.router.native.setMemberAssignment(a.group.id, "B", true);
  a.router.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(1);
  vi.advanceTimersByTime(31000);
  a.router.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(1);
  vi.advanceTimersByTime(30000);
  const restarted = new GatewayRouter(a.store);
  restarted.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(2);
  vi.advanceTimersByTime(300000);
  restarted.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(3);
  vi.advanceTimersByTime(86400000);
  restarted.native.syncRoster(a.group.id);
  expect(a.store.pending("outgoing")).toHaveLength(3);
  restarted.native.probe(a.group.id, "B");
  restarted.native.probe(a.group.id, "B");
  expect(a.store.pending("outgoing")).toHaveLength(4);
  expect(restarted.native.pendingProbeUntil(a.group.id, "B")).toBe(
    Date.now() + 30000,
  );
  expect(() => restarted.native.authorize(a.group.id, ["B"])).toThrow();
});

it("carries a sequenced task heartbeat without overwriting the peer progress result", () => {
  const f = pair();
  const [task] = delegate(f);
  exchange(f.a, f.b);
  const incoming = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "worker-session",
    text: "Analyzing files",
    final: false,
    started: true,
  });
  exchange(f.b, f.a);
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "worker-session",
    text: "Heartbeat",
    final: false,
    heartbeat: true,
  });
  exchange(f.b, f.a);
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === task!.id),
  ).toMatchObject({
    state: "running",
    result: "Analyzing files",
    heartbeatAt: expect.any(Number),
  });
});

it("allows new owner work despite an unrelated incoming task still running", () => {
  const f = pair();
  delegate(f, "Query your RAM");
  exchange(f.a, f.b);
  const owner = f.b.router.groupConversationContext(
    f.b.device.id,
    f.b.group.id,
  );
  const result = f.b.router.native.command(
    owner,
    "other-thread",
    randomUUID(),
    {
      action: "delegate",
      participantId: "A",
      text: "List your project's root folders",
    },
  ) as Array<{ id: string }>;
  exchange(f.b, f.a);
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === result[0]!.id)
      ?.direction,
  ).toBe("incoming");
});

it("allows a distinct upstream dependency and returns its result to the worker", () => {
  const f = pair();
  const [parent] = delegate(
    f,
    "Analyze my project using the deployment constraints",
  );
  exchange(f.a, f.b);
  const received = f.b.router.native.tasks(f.b.group.id)[0]!;
  const worker = f.b.store.get<RemoteInvocationContext>(
    "invocations",
    received.invocationId,
  )!;
  const dependency = {
    reason: "Only A has the deployment constraints",
    retainedWork:
      "I will analyze my own project after receiving the constraints",
  };
  const [child] = f.b.router.native.command(worker, "worker", randomUUID(), {
    action: "delegate",
    participantId: "A",
    text: "Provide your deployment constraints",
    dependency,
  }) as Array<{ id: string; workflow: string; envelope: NativeEnvelope }>;
  expect(child!.envelope).toMatchObject({ parentTask: parent!.id, dependency });
  exchange(f.b, f.a);
  const incoming = f.a.router.native
    .tasks(f.a.group.id)
    .find((t) => t.id === child!.id)!;
  expect(incoming.direction).toBe("incoming");
  expect(incoming.workflow).toBe(received.workflow);
  f.a.router.receiveReply(f.a.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: incoming.invocationId,
    taskId: "dependency-worker",
    final: true,
    outcome: "completed",
    text: "Linux only",
  });
  exchange(f.a, f.b);
  expect(
    f.b.router.native.tasks(f.b.group.id).find((t) => t.id === child!.id),
  ).toMatchObject({
    result: "Linux only",
    state: "completed",
    threadId: "worker",
  });
  expect(
    f.a.router.native.tasks(f.a.group.id).find((t) => t.id === parent!.id)!
      .state,
  ).not.toBe("completed");
});

it("rejects copying the parent assignment back despite a dependency declaration", () => {
  const f = pair();
  delegate(f, "Report your project name");
  exchange(f.a, f.b);
  const received = f.b.router.native.tasks(f.b.group.id)[0]!;
  const worker = f.b.store.get<RemoteInvocationContext>(
    "invocations",
    received.invocationId,
  )!;
  expect(() =>
    f.b.router.native.command(worker, "worker", randomUUID(), {
      action: "delegate",
      participantId: "A",
      text: "Report your project name!",
      dependency: {
        reason: "Need the answer",
        retainedWork: "Forward the answer",
      },
    }),
  ).toThrow(/original assignment/i);
});

it("rejects unlinked reverse frames from older peers without creating a local task", () => {
  const f = pair();
  delegate(f, "Report your own project name");
  exchange(f.a, f.b);
  const task = f.b.router.native.tasks(f.b.group.id)[0]!;
  const reverse: NativeEnvelope = {
    ...task.envelope,
    id: randomUUID(),
    task: randomUUID(),
    workflow: task.workflow,
    sender: "B",
    recipient: "A",
    action: "delegate",
    text: "Tell me your project name",
  };
  expect(
    f.a.router.ingest({
      ...f.a.event,
      messageId: randomUUID(),
      timestamp: Date.now(),
      bot: true,
      identity: { ...f.a.event.identity, userId: "B" },
      text: encodeNativeEnvelope(reverse),
    }),
  ).toBe(true);
  expect(
    f.a.router.native
      .tasks(f.a.group.id)
      .filter((t) => t.direction === "incoming"),
  ).toHaveLength(0);
  expect(
    f.a.store
      .pending<Delivery>("outgoing")
      .some(
        (i) =>
          i.payload.native?.action === "rejected" &&
          i.payload.native.task === reverse.task,
      ),
  ).toBe(true);
});

it("rejects ancestor replay and duplicate pending dependencies without blocking different prerequisites", () => {
  const f = pair();
  delegate(f, "Report your own project name");
  exchange(f.a, f.b);
  const parent = f.b.router.native.tasks(f.b.group.id)[0]!;
  const worker = f.b.store.get<RemoteInvocationContext>(
    "invocations",
    parent.invocationId,
  )!;
  const command = {
    action: "delegate" as const,
    participantId: "A",
    text: "Provide deployment constraints",
    dependency: {
      reason: "Constraints are stored on A",
      retainedWork: "Identify and assess my own project",
    },
  };
  f.b.router.native.command(worker, "worker", randomUUID(), command);
  expect(() =>
    f.b.router.native.command(worker, "worker", randomUUID(), {
      ...command,
      newTask: true,
    }),
  ).toThrow(/already pending/);
  exchange(f.b, f.a);
  const child = f.a.router.native
    .tasks(f.a.group.id)
    .find((t) => t.direction === "incoming")!;
  const nested = f.a.store.get<RemoteInvocationContext>(
    "invocations",
    child.invocationId,
  )!;
  expect(() =>
    f.a.router.native.command(nested, "nested", randomUUID(), {
      ...command,
      participantId: "B",
      text: "Provide deployment constraints!",
    }),
  ).toThrow(/original assignment/);
  expect(() =>
    f.b.router.native.command(worker, "worker", randomUUID(), {
      ...command,
      text: "Provide the required deployment region",
    }),
  ).not.toThrow();
});

it("closes a deleted local worker without changing completed work or another device's tasks", () => {
  const f = pair();
  delegate(f);
  exchange(f.a, f.b);
  const task = f.b.router.native.tasks(f.b.group.id)[0]!;
  f.b.router.receiveReply(f.b.device.id, {
    version: 1,
    id: randomUUID(),
    invocationId: task.invocationId,
    taskId: "worker",
    text: "Working",
    started: true,
    final: false,
  });
  expect(() =>
    f.b.router.native.localTaskDeleted(
      f.a.device.id,
      task.invocationId,
      "worker",
    ),
  ).toThrow();
  expect(() =>
    f.b.router.native.localTaskDeleted(
      f.b.device.id,
      task.invocationId,
      "wrong-thread",
    ),
  ).toThrow();
  f.b.router.native.localTaskDeleted(
    f.b.device.id,
    task.invocationId,
    "worker",
  );
  f.b.router.native.localTaskDeleted(
    f.b.device.id,
    task.invocationId,
    "worker",
  );
  expect(f.b.router.native.tasks(f.b.group.id)[0]!.state).toBe("cancelled");
  exchange(f.b, f.a);
  expect(f.a.router.native.tasks(f.a.group.id)[0]!.state).toBe("cancelled");
  f.b.store.put("native-tasks", task.id, {
    ...task,
    state: "completed",
    result: "Done",
    threadId: "worker",
  });
  f.b.router.native.localTaskDeleted(
    f.b.device.id,
    task.invocationId,
    "worker",
  );
  expect(f.b.router.native.tasks(f.b.group.id)[0]).toMatchObject({
    state: "completed",
    result: "Done",
  });
});
