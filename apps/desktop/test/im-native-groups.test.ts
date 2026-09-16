import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import {
  executionGrantSchema,
  IM_SECURITY_VERSION,
  type Thread,
  type ChannelEvent,
  type ImStatus,
  type AgentEvent,
} from "@artemis/protocol";
import type { ArtemisGateway } from "@artemis/gateway";
import { ImService, type ImTaskOperations } from "../src/main/im-service.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function fixture(channel: "wecom" | "feishu" | "slack" = "slack") {
  const root = await mkdtemp(join(tmpdir(), "artemis-native-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "project");
  await mkdir(path);
  const threads: Thread[] = [],
    starts: string[] = [];
  const ops: ImTaskOperations = {
    projects: () => [
      {
        id: "p",
        name: "Project",
        path,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    threads: () => threads,
    thread: (id) => threads.find((t) => t.id === id),
    ready: () => true,
    events: () => [],
    create: async (id, projectId, mode, title) => {
      const t: Thread = {
        id,
        projectId: projectId ?? null,
        mode,
        title,
        target: "local",
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      threads.push(t);
      return t;
    },
    start: async (id) => {
      starts.push(id);
    },
    queue: async () => {},
    close: async () => {},
    cancel: async () => {},
    approve: async () => {},
    answer: () => {},
  };
  const service = new ImService(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    ops,
  );
  cleanup.push(() => service.close());
  await service.manage({ action: "setup-local" });
  await service.save({ ...service.status().settings, enabled: true });
  // Inject authenticated adapter events into the actual local gateway; no provider credentials or network mocks.
  const gateway = (
    service as unknown as { localGateway: { gateway: ArtemisGateway } }
  ).localGateway.gateway;
  const identity = {
    channel,
    connectionId: "bot",
    tenantId: "tenant",
    appId: "app",
    userId: "owner",
  };
  const pair = (await service.manage({ action: "pair" })) as { code: string };
  gateway.store.pair(pair.code, identity);
  await service.manage({ action: "refresh" });
  const conversation = {
    connectionId: "bot",
    id: "room",
    kind: "group" as const,
  };
  const event: ChannelEvent = {
    version: 1,
    messageId: randomUUID(),
    identity,
    conversation,
    text: "first work",
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  };
  gateway.router.ingest(event);
  gateway.router.processIncoming();
  const grant = executionGrantSchema.parse({
    projectId: "p",
    expiresAt: Date.now() + 3600000,
    security: {
      version: IM_SECURITY_VERSION,
      revision: "draft",
      confirmedAt: Date.now(),
      scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
    },
  });
  const authorize = () =>
    service.manage({
      action: "authorize-native-group",
      conversation,
      owner: identity,
      name: "Test room",
      grant,
      confirmed: true,
    });
  return {
    service,
    gateway,
    threads,
    starts,
    authorize,
    event,
    grant,
    ops,
    root,
  };
}
for (const channel of ["wecom", "feishu", "slack"] as const)
  it(`${channel} creates one fixed entry only after authorization and runs group work in a child`, async () => {
    const f = await fixture(channel);
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    await f.authorize();
    expect(f.threads).toHaveLength(1);
    const parent = f.threads[0]!.id;
    await f.service.manage({ action: "refresh" });
    await f.authorize();
    expect(f.threads).toHaveLength(1);
    const request = f.gateway.router.groupConversationContext(
      f.service.status().settings.deviceId,
      f.service.status().remoteTasks![0]!.group!.spaceId,
    );
    await f.service.accept({
      ...request,
      id: randomUUID(),
      messageId: randomUUID(),
      text: "new task",
    });
    await f.service.poll();
    expect(f.starts).toHaveLength(1);
    expect(f.starts[0]).not.toBe(parent);
    expect(
      f.service.status().remoteTasks?.find((t) => t.threadId === f.starts[0])
        ?.parentThreadId,
    ).toBe(parent);
  });
it("keeps local instructions private and deduplicates retries", async () => {
  const f = await fixture();
  await f.authorize();
  const threadId = f.threads[0]!.id;
  const input = {
    action: "native-group-input" as const,
    threadId,
    messageId: randomUUID(),
    destination: "local" as const,
    text: "private work",
  };
  await f.service.manage(input);
  await f.service.manage(input);
  expect(f.starts).toHaveLength(1);
  const child = f.starts[0]!;
  f.service.observe([
    {
      version: 1,
      eventId: randomUUID(),
      threadId: child,
      turnId: "turn",
      timestamp: new Date().toISOString(),
      sequence: 1,
      payload: { type: "turn.completed", reason: "completed" },
    },
  ] as never);
  expect(JSON.stringify(f.gateway.store.pending("outgoing"))).not.toContain(
    "private work",
  );
  await expect(
    f.service.manage({ ...input, text: "different" }),
  ).rejects.toThrow(/编号/);
});
it("sending to the group queues a message without invoking Pi", async () => {
  const f = await fixture();
  await f.authorize();
  const threadId = f.threads[0]!.id;
  await f.service.manage({
    action: "native-group-input",
    threadId,
    messageId: randomUUID(),
    destination: "group",
    text: "hello group",
  });
  expect(f.starts).toHaveLength(0);
  const state = (await f.service.manage({
    action: "native-group-state",
    threadId,
  })) as { messages: Array<{ text: string }> };
  expect(state.messages).toHaveLength(1);
  expect(state.messages[0]?.text).toBe("hello group");
});
it("uses the assignment deadline only before execution and retains the project grant deadline", async () => {
  const f = await fixture();
  await f.authorize();
  await f.service.manage({
    action: "native-group-input",
    threadId: f.threads[0]!.id,
    messageId: randomUUID(),
    destination: "local",
    text: "long running work",
  });
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60000);
  await f.service.manage({ action: "refresh" });
  expect(() => f.service.authorizeThread(f.starts[0]!, "plan")).not.toThrow();
  vi.spyOn(Date, "now").mockReturnValue(now + 61 * 60000);
  expect(() => f.service.authorizeThread(f.starts[0]!, "plan")).toThrow();
});

it("commits terminal replies before emitting reentrant group activity", async () => {
  const f = await fixture();
  await f.authorize();
  const parent = f.threads[0]!.id;
  const start = vi.spyOn(f.ops, "start");
  f.gateway.router.ingest({
    ...f.event,
    messageId: randomUUID(),
    timestamp: Date.now(),
    text: "finish work",
  });
  f.gateway.router.processIncoming();
  await f.service.poll();
  const child = f.starts[0]!;
  expect(f.threads.find((t) => t.id === child)?.projectId).toBe("p");
  expect(start).toHaveBeenCalledWith(
    child,
    expect.stringContaining("[IM provenance"),
    "plan",
    [],
    "finish work",
  );
  const completed: AgentEvent = {
    protocolVersion: 4,
    eventId: randomUUID(),
    threadId: child,
    turnId: "turn",
    timestamp: new Date().toISOString(),
    seq: 2,
    payload: {
      type: "turn.completed",
      reason: "completed",
      finalPartId: "answer",
    },
  };
  f.ops.events = () => [
    {
      ...completed,
      eventId: randomUUID(),
      seq: 1,
      payload: {
        type: "message.part.delta",
        partId: "answer",
        partType: "text",
        delta: "Public final response",
      },
    },
    completed,
  ];
  f.ops.groupActivity = vi.fn((id, taskId, phase) => {
    f.service.observe([
      {
        ...completed,
        eventId: randomUUID(),
        threadId: id,
        payload: { type: "im.group.activity", taskId, phase },
      },
    ]);
  });
  expect(() => f.service.observe([completed])).not.toThrow();
  f.service.observe([completed]);
  expect(f.ops.groupActivity).toHaveBeenCalledExactlyOnceWith(
    parent,
    child,
    "completed",
  );
  await f.service.poll();
  expect(JSON.stringify(f.gateway.store.pending("outgoing"))).toContain(
    "Public final response",
  );
});

it("does not reuse a device-wide Lark alias in a native Slack group", async () => {
  const f = await fixture("slack");
  await f.authorize();
  const deviceId = f.service.status().settings.deviceId;
  const db = new DatabaseSync(join(f.root, "im.sqlite"));
  db.prepare("INSERT INTO im_state(namespace,id,value) VALUES(?,?,?)").run(
    "member-labels",
    JSON.stringify([deviceId, deviceId]),
    JSON.stringify({ name: "Lark", deviceName: "My computer" }),
  );
  db.close();
  let member = f.service.status().remoteTasks![0]!.group!.members[0]!;
  expect(member.identity.channel).toBe("slack");
  expect(member.name).toBe("owner");
  expect(member.deviceName).toBe("My computer");
  await f.service.manage({
    action: "rename-group-member",
    deviceId,
    identity: f.event.identity,
    name: "Slack owner",
    deviceName: "My computer",
  });
  member = f.service.status().remoteTasks![0]!.group!.members[0]!;
  expect(member.name).toBe("Slack owner");
});

it("executes an unpaired teammate request within the receiving group's project grant", async () => {
  const f = await fixture();
  await f.authorize();
  f.gateway.router.ingest({
    ...f.event,
    identity: { ...f.event.identity, userId: "unpaired-teammate" },
    messageId: "peer-task",
    text: "Explain this project",
    timestamp: Date.now(),
  });
  f.gateway.router.processIncoming();
  await f.service.poll();
  expect(f.starts).toHaveLength(1);
  expect(f.threads.find((t) => t.id === f.starts[0])?.projectId).toBe("p");
  f.gateway.router.ingest({
    ...f.event,
    identity: { ...f.event.identity, userId: "unpaired-teammate" },
    messageId: "peer-control",
    text: " /project elsewhere",
    timestamp: Date.now(),
  });
  f.gateway.router.processIncoming();
  await f.service.poll();
  expect(f.starts).toHaveLength(1);
});

it("reuses the group's session across members and creates one only for explicit /new", async () => {
  const f = await fixture();
  await f.authorize();
  const send = async (messageId: string, userId: string, text: string) => {
    f.gateway.router.ingest({
      ...f.event,
      identity: { ...f.event.identity, userId },
      messageId,
      text,
      timestamp: Date.now(),
    });
    f.gateway.router.processIncoming();
    await f.service.poll();
  };
  await send("one", "peer-a", "First question");
  await send("two", "peer-b", "Follow up");
  expect(f.starts).toHaveLength(2);
  expect(f.starts[1]).toBe(f.starts[0]);
  await send("three", "peer-b", "/new Separate task");
  expect(f.starts).toHaveLength(3);
  expect(f.starts[2]).not.toBe(f.starts[0]);
  await send("four", "peer-a", "Continue new session");
  expect(f.starts[3]).toBe(f.starts[2]);
});
it("continues a native bot assignment in its original session and treats slash text as task content", async () => {
  const f = await fixture();
  await f.authorize();
  const owner = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    f.service.status().remoteTasks![0]!.group!.spaceId,
  );
  const assignment = (taskId?: string) => {
    const nativeTaskId = randomUUID();
    return {
      ...owner,
      id: randomUUID(),
      messageId: randomUUID(),
      nativeTaskId,
      ...(taskId ? { taskId } : {}),
      text: taskId ? "/new is literal bot content" : "First bot assignment",
      collaboration: {
        taskId: nativeTaskId,
        coordinatorDeviceId: owner.deviceId,
        coordinatorThreadId: owner.id,
        mission: "Do the work",
      },
    };
  };
  await f.service.accept(assignment());
  const original = f.starts[0]!;
  expect(original).toBeTruthy();
  const followUp = assignment(original);
  await f.service.accept(followUp);
  await f.service.accept(followUp);
  expect(f.starts).toEqual([original, original]);
  expect(f.threads).toHaveLength(2); // Group entry and one worker session.
  // A changed grant must reject continuation, never silently create a session.
  const settings = f.service.status().settings;
  await f.service.save({
    ...settings,
    grants: settings.grants.map((g) => ({
      ...g,
      expiresAt: g.expiresAt + 60000,
    })),
  });
  await f.service.accept(assignment(original));
  expect(f.starts).toEqual([original, original]);
  expect(f.threads).toHaveLength(2);
});
it("allows remote operations after cumulative usage exceeds legacy token budgets", async () => {
  const f = await fixture();
  f.grant.tokenBudget = 1024; // Persisted grants from older versions remain loadable.
  await mkdir(join(f.root, "project", "src"));
  f.grant.security!.scopes[0]!.readPaths = ["src"];
  await f.authorize();
  const request = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    f.service.status().remoteTasks![0]!.group!.spaceId,
  );
  await f.service.accept({
    ...request,
    id: randomUUID(),
    messageId: randomUUID(),
    text: "Work",
  });
  const threadId = f.starts[0]!;
  expect(threadId).toBeTruthy();
  f.service.observe([
    {
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId,
      turnId: "turn",
      timestamp: new Date().toISOString(),
      seq: 1,
      payload: {
        type: "assistant.usage",
        inputTokens: 200000,
        outputTokens: 1000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 201000,
      },
    },
  ]);
  const db = new DatabaseSync(join(f.root, "im.sqlite"));
  try {
    const row = db
      .prepare("SELECT value FROM im_state WHERE namespace='bindings' AND id=?")
      .get(threadId)!;
    const binding = JSON.parse(String(row.value));
    db.prepare(
      "INSERT OR REPLACE INTO im_state(namespace,id,value) VALUES('usage',?,?)",
    ).run(binding.request.id, JSON.stringify(1000000));
  } finally {
    db.close();
  }
  expect(() => f.service.authorizeThread(threadId, "plan")).not.toThrow();
  expect(() =>
    f.service.authorizeOperation(
      threadId,
      { action: "read", path: "src" },
      "plan",
    ),
  ).not.toThrow();
  expect(() =>
    f.service.authorizeOperation(
      threadId,
      {
        action: "collaborate",
        command: { action: "status", text: "" },
      },
      "plan",
    ),
  ).toThrow(/Plan and Review/);
  await f.service.save({ ...f.service.status().settings, enabled: false });
  expect(() => f.service.authorizeThread(threadId, "plan")).toThrow();
});

it("queries Slack bots in Plan and Review without dispatching or requiring bot authorization", async () => {
  const f = await fixture("slack");
  await f.authorize();
  const task = f.service.status().remoteTasks![0]!;
  const spaceId = task.group!.spaceId;
  f.gateway.store.put("native-group-info", spaceId, {
    roster: {
      complete: false,
      error: "partial",
      members: [
        {
          identity: { ...f.event.identity, userId: "U_JUPITER" },
          name: "Jupiter",
          kind: "bot",
        },
      ],
    },
  });
  await f.service.manage({ action: "refresh" });
  const outgoing = f.gateway.store.pending("outgoing");
  for (const mode of ["plan", "review"] as const) {
    const result = await f.service.operate(
      task.threadId,
      { action: "participants" },
      mode,
      randomUUID(),
    );
    expect(result).toMatchObject({
      spaceId,
      complete: false,
      error: "partial",
      capability: "manual",
      members: [
        {
          participantId: "U_JUPITER",
          name: "Jupiter",
          kind: "bot",
          canAssign: false,
        },
      ],
    });
    await expect(
      f.service.operate(
        task.threadId,
        {
          action: "collaborate",
          command: {
            action: "delegate",
            participantId: "U_JUPITER",
            text: "Memory?",
          },
        },
        mode,
        randomUUID(),
      ),
    ).rejects.toThrow();
  }
  expect(f.gateway.store.pending("outgoing")).toEqual(outgoing);
  expect(f.starts).toEqual([]);
  await f.service.save({ ...f.service.status().settings, grants: [] });
  await expect(
    f.service.operate(
      task.threadId,
      { action: "participants" },
      "plan",
      randomUUID(),
    ),
  ).rejects.toThrow();
});
