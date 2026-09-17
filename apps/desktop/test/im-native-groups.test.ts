import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
import { ImPermissionError } from "../src/main/im-policy.js";
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
    { channel: "slack", initialTitle: "Slack · finish work" },
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
  f.grant.mode = "execute";
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
  expect(f.service.profile(original)?.collaborationRole).toBe("worker");
  await expect(
    f.service.operate(
      original,
      {
        action: "collaborate",
        command: {
          action: "delegate",
          participantId: "sender",
          text: "Send it back",
        },
      },
      "execute",
      "reverse-delegation",
    ),
  ).rejects.toThrow(/received assignment/);
  const followUp = assignment(original);
  await f.service.accept(followUp);
  await f.service.accept(followUp);
  expect(f.starts).toEqual([original, original]);
  expect(f.threads).toHaveLength(2); // Group entry and one worker session.
  // Renewing permission must continue the original session.
  const settings = f.service.status().settings;
  await f.service.save({
    ...settings,
    grants: settings.grants.map((g) => ({
      ...g,
      expiresAt: g.expiresAt + 60000,
    })),
  });
  await f.service.accept(assignment(original));
  expect(f.starts).toEqual([original, original, original]);
  expect(f.threads).toHaveLength(2);
  // Revocation still blocks execution without creating a replacement session.
  await f.service.save({
    ...f.service.status().settings,
    defaultProjectId: "",
    grants: [],
  });
  await f.service.accept(assignment(original));
  expect(f.starts).toEqual([original, original, original]);
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

async function delegatedFixture() {
  const f = await fixture();
  f.grant.mode = "execute";
  await f.authorize();
  const groupId = f.service.status().remoteTasks![0]!.group!.spaceId;
  const group = f.gateway.store.get<
    import("@artemis/protocol").CollaborationSpace
  >("native-groups", groupId)!;
  f.gateway.store.put("native-groups", groupId, {
    ...group,
    nativeGroup: { ...group.nativeGroup, capability: "events" },
  });
  await f.service.manage({ action: "refresh" });
  const request = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    groupId,
  );
  await f.service.accept({
    ...request,
    text: "Ask Solar to analyze the project",
  });
  const threadId = f.starts.at(-1)!;
  const thread = f.threads.find((t) => t.id === threadId)!;
  thread.status = "running";
  const task = {
    version: 1,
    id: "delegate-a",
    groupId,
    workflow: "workflow",
    direction: "outgoing",
    threadId,
    invocationId: request.id,
    peer: "solar",
    state: "running",
    text: "Analyze",
    dependencies: [],
    sequence: 1,
    updatedAt: Date.now(),
    envelope: { id: "attempt-a" },
  };
  f.gateway.store.put("native-tasks", task.id, task);
  return { ...f, groupId, request, threadId, thread, task };
}

it("parks delegated work, preserves intervening conversation, and resumes once after the turn is idle", async () => {
  const f = await delegatedFixture();
  const { threadId, thread, task } = f;
  const resume = vi.fn<NonNullable<ImTaskOperations["resumeDelegation"]>>(
    async () => true,
  );
  f.ops.resumeDelegation = resume;
  const result = await f.service.operate(
    threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [task.id],
        waitSeconds: 0,
        text: "Review results",
      },
    },
    "execute",
    randomUUID(),
  );
  expect(result).toMatchObject({ state: "waiting" });
  expect(f.service.hasDelegationWait(threadId)).toBe(true);
  // A real intervening message updates the invocation while this turn is busy.
  await f.service.accept({
    ...f.request,
    id: randomUUID(),
    messageId: randomUUID(),
    taskId: threadId,
    text: "What is two plus two?",
  });
  f.gateway.store.put("native-tasks", task.id, {
    ...task,
    state: "completed",
    result: "Solar result",
  });
  await f.service.poll();
  expect(resume).not.toHaveBeenCalled();
  expect(
    f.service.status().remoteTasks!.find((t) => t.threadId === threadId)
      ?.delegationWaits?.[0]?.state,
  ).toBe("ready");
  thread.status = "idle";
  await f.service.poll();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(resume.mock.calls[0]?.[1]).toContain("newer user messages");
  await f.service.poll();
  expect(resume).toHaveBeenCalledTimes(1);
});

it.each(["archived", "deleted", "revoked", "review", "busy", "queued"])(
  "does not auto-resume when %s",
  async (condition) => {
    const f = await delegatedFixture();
    const resume = vi.fn<NonNullable<ImTaskOperations["resumeDelegation"]>>(
      async () => condition !== "queued",
    );
    f.ops.resumeDelegation = resume;
    await f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command: {
          action: "wait",
          taskIds: [f.task.id],
          waitSeconds: 0,
          text: "Review results",
        },
      },
      "execute",
      randomUUID(),
    );
    f.gateway.store.put("native-tasks", f.task.id, {
      ...f.task,
      state: "completed",
      result: "Done",
    });
    f.thread.status = "idle";
    if (condition === "archived") f.thread.archived = true;
    if (condition === "deleted")
      f.threads.splice(f.threads.indexOf(f.thread), 1);
    if (condition === "revoked")
      await f.service.save({ ...f.service.status().settings, grants: [] });
    if (condition === "review") f.thread.mode = "review";
    if (condition === "busy") f.thread.status = "waiting-approval";
    await f.service.poll();
    if (condition === "queued") {
      expect(resume).toHaveBeenCalledTimes(1);
      expect(f.service.hasDelegationWait(f.threadId)).toBe(true);
      resume.mockResolvedValue(true);
      await f.service.poll();
      expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    } else expect(resume).not.toHaveBeenCalled();
  },
);

it("cancels local continuation even if the remote cancellation cannot be delivered", async () => {
  const f = await delegatedFixture();
  const resume = vi.fn<NonNullable<ImTaskOperations["resumeDelegation"]>>(
    async () => true,
  );
  f.ops.resumeDelegation = resume;
  const wait = (await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [f.task.id],
        waitSeconds: 0,
        text: "Review",
      },
    },
    "execute",
    randomUUID(),
  )) as { waitId: string };
  await f.service
    .manage({ action: "delegation-cancel", waitId: wait.waitId })
    .catch(() => {});
  f.gateway.store.put("native-tasks", f.task.id, {
    ...f.task,
    state: "completed",
    result: "Late result",
  });
  f.thread.status = "idle";
  await f.service.poll();
  expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
  expect(resume).not.toHaveBeenCalled();
});

it("returns already available results synchronously without scheduling a second turn", async () => {
  const f = await delegatedFixture();
  f.gateway.store.put("native-tasks", f.task.id, {
    ...f.task,
    state: "completed",
    result: "Fast result",
  });
  const result = await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [f.task.id],
        waitSeconds: 30,
        text: "Review",
      },
    },
    "execute",
    randomUUID(),
  );
  expect(result).toMatchObject({
    state: "results",
    tasks: [{ result: "Fast result" }],
  });
  expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
});

it("recovers a persisted wait and result after the IM service restarts", async () => {
  const f = await delegatedFixture();
  const resume = vi.fn<NonNullable<ImTaskOperations["resumeDelegation"]>>(
    async () => true,
  );
  f.ops.resumeDelegation = resume;
  await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [f.task.id],
        waitSeconds: 0,
        text: "Review after restart",
      },
    },
    "execute",
    randomUUID(),
  );
  f.gateway.store.put("native-tasks", f.task.id, {
    ...f.task,
    state: "completed",
    result: "Persisted result",
  });
  await f.service.close();
  f.thread.status = "idle";
  const restored = new ImService(
    f.root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    f.ops,
  );
  cleanup.push(() => restored.close());
  await restored.manage({ action: "setup-local" });
  await restored.poll();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(resume.mock.calls[0]?.[1]).toContain("Persisted result");
  await restored.poll();
  expect(resume).toHaveBeenCalledTimes(1);
});

it("returns a result during the bounded short wait and replays the same tool receipt", async () => {
  const f = await delegatedFixture();
  const command = {
    action: "wait" as const,
    taskIds: [f.task.id],
    waitSeconds: 1,
    text: "Review",
  };
  const callId = randomUUID();
  const timer = setTimeout(
    () =>
      f.gateway.store.put("native-tasks", f.task.id, {
        ...f.task,
        state: "completed",
        result: "Quick result",
      }),
    20,
  );
  try {
    const result = await f.service.operate(
      f.threadId,
      { action: "collaborate", command },
      "execute",
      callId,
    );
    expect(result).toMatchObject({
      state: "results",
      tasks: [{ result: "Quick result" }],
    });
    expect(
      await f.service.operate(
        f.threadId,
        { action: "collaborate", command },
        "execute",
        callId,
      ),
    ).toEqual(result);
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
  } finally {
    clearTimeout(timer);
  }
});

it("keeps task ownership checks after an intervening message changes the invocation", async () => {
  const f = await delegatedFixture();
  await f.service.accept({
    ...f.request,
    id: randomUUID(),
    messageId: randomUUID(),
    taskId: f.threadId,
    text: "Only inspect login now",
  });
  const status = await f.service.operate(
    f.threadId,
    { action: "collaborate", command: { action: "status", text: "" } },
    "execute",
    randomUUID(),
  );
  expect(status).toMatchObject([{ id: f.task.id, invocationId: f.request.id }]);
  f.gateway.store.put("native-tasks", "foreign", {
    ...f.task,
    id: "foreign",
    threadId: "another-thread",
  });
  await expect(
    f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command: { action: "cancel", taskId: "foreign", text: "" },
      },
      "execute",
      randomUUID(),
    ),
  ).rejects.toThrow(/owned/);
  // A completed task can be locally cancelled without sending another IM frame.
  f.gateway.store.put("native-tasks", f.task.id, {
    ...f.task,
    state: "completed",
    result: "Done",
  });
  await expect(
    f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command: { action: "cancel", taskId: f.task.id, text: "" },
      },
      "execute",
      randomUUID(),
    ),
  ).resolves.toMatchObject({ id: f.task.id, state: "completed" });
});

it.each(["desktop", "chat", "tool"] as const)(
  "%s cancellation persists before delivery and prevents late continuation after restart",
  async (entry) => {
    const f = await delegatedFixture();
    const resume = vi.fn(async () => true);
    f.ops.resumeDelegation = resume;
    const cancelContinuation = vi.fn(async () => {});
    f.ops.cancelDelegationContinuation = cancelContinuation;
    const wait = (await f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command: {
          action: "wait",
          taskIds: [f.task.id],
          waitSeconds: 0,
          text: "Review",
        },
      },
      "execute",
      randomUUID(),
    )) as { waitId: string };
    f.thread.status = "idle";
    if (entry === "chat") {
      await f.service.accept({
        ...f.request,
        id: randomUUID(),
        messageId: randomUUID(),
        text: `/stop ${f.threadId}`,
      });
    } else if (entry === "desktop") {
      await f.service
        .manage({ action: "delegation-cancel", waitId: wait.waitId })
        .catch(() => {});
    } else {
      await f.service
        .operate(
          f.threadId,
          {
            action: "collaborate",
            command: { action: "cancel", taskId: f.task.id, text: "" },
          },
          "execute",
          randomUUID(),
        )
        .catch(() => {});
    }
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    expect(cancelContinuation).toHaveBeenCalledWith(
      f.threadId,
      expect.arrayContaining([wait.waitId]),
    );
    f.gateway.store.put("native-tasks", f.task.id, {
      ...f.task,
      state: "completed",
      result: "Late",
    });
    await f.service.poll();
    expect(resume).not.toHaveBeenCalled();
    await f.service.close();
    const restored = new ImService(
      f.root,
      {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      f.ops,
    );
    cleanup.push(() => restored.close());
    await restored.manage({ action: "setup-local" });
    await restored.poll();
    expect(restored.hasDelegationWait(f.threadId)).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  },
);

it("preserves cancellation when a continuation dispatch completes concurrently", async () => {
  const f = await delegatedFixture();
  const wait = (await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [f.task.id],
        waitSeconds: 0,
        text: "Review",
      },
    },
    "execute",
    randomUUID(),
  )) as { waitId: string };
  const stopped = vi.fn(async () => {});
  f.ops.cancelDelegationContinuation = stopped;
  f.ops.resumeDelegation = async () => {
    await f.service
      .manage({ action: "delegation-cancel", waitId: wait.waitId })
      .catch(() => {});
    return true;
  };
  f.gateway.store.put("native-tasks", f.task.id, {
    ...f.task,
    state: "completed",
    result: "Ready",
  });
  f.thread.status = "idle";
  await f.service.poll();
  expect(stopped).toHaveBeenCalledWith(
    f.threadId,
    expect.arrayContaining([wait.waitId]),
  );
  expect(f.service.canResumeDelegation(wait.waitId)).toBe(false);
  const db = new DatabaseSync(join(f.root, "im.sqlite"));
  try {
    const row = db
      .prepare(
        "SELECT value FROM im_state WHERE namespace='delegation-waits' AND id=?",
      )
      .get(wait.waitId) as { value: string };
    expect(JSON.parse(row.value).state).toBe("cancelled");
  } finally {
    db.close();
  }
});

async function automaticallyDelegatedFixture(
  batch = false,
  originTurnId?: string,
) {
  const f = await delegatedFixture();
  const group = f.gateway.store.get<
    import("@artemis/protocol").CollaborationSpace
  >("native-groups", f.groupId)!;
  f.gateway.store.put("native-groups", f.groupId, {
    ...group,
    nativeGroup: { ...group.nativeGroup, allowedBots: ["solar"] },
  });
  f.gateway.store.put("native-peers", f.groupId, [
    { id: "solar", name: "Solar", verifiedAt: Date.now() },
  ]);
  f.gateway.store.put("connections", "bot", {
    sealed: f.gateway.store.seal({
      id: "bot",
      channel: "slack",
      tenantId: "tenant",
      appId: "app",
      botUserId: "jupiter",
      enabled: true,
    }),
  });
  const command = batch
    ? {
        action: "delegate-many" as const,
        text: "",
        assignments: [
          { participantId: "solar", text: "Check disk" },
          { participantId: "solar", text: "Check RAM" },
        ],
      }
    : {
        action: "delegate" as const,
        newTask: true,
        participantId: "solar",
        text: "Check disk",
      };
  const callId = randomUUID();
  const result = (await f.service.operate(
    f.threadId,
    { action: "collaborate", command },
    "execute",
    callId,
    originTurnId,
  )) as Array<typeof f.task>;
  const waits = () =>
    f.service.status().remoteTasks!.find((t) => t.threadId === f.threadId)!
      .delegationWaits!;
  return { ...f, command, callId, result, waits };
}

it("registers waiting immediately on successful dispatch without a wait tool and reuses it for explicit wait", async () => {
  const f = await automaticallyDelegatedFixture();
  expect(f.waits()).toHaveLength(1);
  const id = f.waits()[0]!.id;
  expect(f.waits()[0]).toMatchObject({
    continuation: "Check disk",
    state: "waiting",
    taskIds: [f.result[0]!.id],
  });
  await f.service.operate(
    f.threadId,
    { action: "collaborate", command: f.command },
    "execute",
    f.callId,
  );
  expect(f.waits()).toHaveLength(1);
  const waited = await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [f.result[0]!.id],
        text: "Summarize latest requirements",
        waitSeconds: 0,
      },
    },
    "execute",
    randomUUID(),
  );
  expect(waited).toMatchObject({ waitId: id });
  expect(f.waits()[0]!.continuation).toBe("Summarize latest requirements");
});

it("consumes only results actually returned by status and preserves the remaining batch wait", async () => {
  const f = await automaticallyDelegatedFixture(true);
  const resume = vi.fn(async () => true);
  f.ops.resumeDelegation = resume;
  expect(f.waits()).toHaveLength(2);
  f.gateway.store.put("native-tasks", f.result[0]!.id, {
    ...f.result[0],
    state: "completed",
    result: "Disk result from old protocol",
  });
  await f.service.operate(
    f.threadId,
    { action: "collaborate", command: { action: "status", text: "" } },
    "execute",
    randomUUID(),
  );
  expect(f.waits()).toHaveLength(1);
  expect(f.waits()[0]!.taskIds).toEqual([f.result[1]!.id]);
  f.thread.status = "idle";
  await f.service.poll();
  expect(resume).not.toHaveBeenCalled();
  f.gateway.store.put("native-tasks", f.result[1]!.id, {
    ...f.result[1],
    state: "completed",
    result: "RAM result",
  });
  await f.service.poll();
  expect(resume).toHaveBeenCalledTimes(1);
  await f.service.poll();
  expect(resume).toHaveBeenCalledTimes(1);
});

it("does not resurrect automatic waits on dispatch replay after cancellation", async () => {
  const f = await automaticallyDelegatedFixture();
  await f.service
    .manage({ action: "delegation-cancel", waitId: f.waits()[0]!.id })
    .catch(() => {});
  await f.service.operate(
    f.threadId,
    { action: "collaborate", command: f.command },
    "execute",
    f.callId,
  );
  expect(f.waits()).toHaveLength(0);
});

it("restores an automatically registered wait and resumes unread results once after restart", async () => {
  const f = await automaticallyDelegatedFixture();
  const resume = vi.fn(async () => true);
  f.ops.resumeDelegation = resume;
  f.gateway.store.put("native-tasks", f.result[0]!.id, {
    ...f.result[0],
    state: "completed",
    result: "Old-format peer result",
  });
  await f.service.poll();
  expect(resume).not.toHaveBeenCalled();
  await f.service.close();
  f.thread.status = "idle";
  const restored = new ImService(
    f.root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    f.ops,
  );
  cleanup.push(() => restored.close());
  await restored.manage({ action: "setup-local" });
  await restored.poll();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(resume.mock.calls[0])).toContain(
    "Old-format peer result",
  );
  await restored.poll();
  expect(resume).toHaveBeenCalledTimes(1);
});

it("merges explicit batch waiting without retaining duplicate automatic continuations", async () => {
  const f = await automaticallyDelegatedFixture(true);
  await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: f.result.map((t) => t.id),
        text: "Combine both results",
        waitSeconds: 0,
      },
    },
    "execute",
    randomUUID(),
  );
  expect(f.waits()).toHaveLength(1);
  expect(f.waits()[0]!.taskIds).toHaveLength(2);
});

it("does not show a wait when dispatch is rejected", async () => {
  const f = await delegatedFixture();
  await expect(
    f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command: {
          action: "delegate",
          participantId: "unknown",
          text: "Analyze",
        },
      },
      "execute",
      randomUUID(),
    ),
  ).rejects.toThrow();
  expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
});

it("parks pending polling and cancels its original turn, blocking new dispatch from that turn", async () => {
  const origin = randomUUID();
  const f = await automaticallyDelegatedFixture(false, origin);
  const cancelled = vi.fn(async () => {});
  f.ops.cancelDelegationContinuation = cancelled;
  const status = await f.service.operate(
    f.threadId,
    { action: "collaborate", command: { action: "status", text: "" } },
    "execute",
    randomUUID(),
    origin,
  );
  expect(status).toMatchObject({ parkDelegation: true, state: "waiting" });
  await f.service.manage({
    action: "delegation-cancel",
    waitId: f.waits()[0]!.id,
  });
  expect(cancelled).toHaveBeenCalledWith(
    f.threadId,
    expect.arrayContaining([origin]),
  );
  await expect(
    f.service.operate(
      f.threadId,
      { action: "collaborate", command: f.command },
      "execute",
      randomUUID(),
      origin,
    ),
  ).rejects.toThrow("cancelled");
  expect(f.waits()).toHaveLength(0);
  await f.service.operate(
    f.threadId,
    { action: "collaborate", command: f.command },
    "execute",
    randomUUID(),
    randomUUID(),
  );
  expect(f.waits()).toHaveLength(1);
});

it("cancels an in-flight dispatch that returns after its originating turn was cancelled", async () => {
  const origin = randomUUID();
  const f = await automaticallyDelegatedFixture(false, origin);
  const service = f.service as unknown as {
    http(path: string, method: string, body: unknown): Promise<Response>;
  };
  const original = service.http.bind(service);
  let release!: () => void;
  let accepted!: () => void;
  const ready = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(service, "http").mockImplementation(async (path, method, body) => {
    const response = await original(path, method, body);
    if (
      path === "/v1/device/native-command" &&
      (body as { command?: { action: string } }).command?.action === "delegate"
    ) {
      accepted();
      await gate;
    }
    return response;
  });
  const pending = f.service.operate(
    f.threadId,
    { action: "collaborate", command: f.command },
    "execute",
    randomUUID(),
    origin,
  );
  await ready;
  await f.service.manage({
    action: "delegation-cancel",
    waitId: f.waits()[0]!.id,
  });
  release();
  const tasks = (await pending) as Array<{ id: string }>;
  expect(f.waits()).toHaveLength(0);
  expect(
    f.gateway.store.get<{ state: string }>("native-tasks", tasks[0]!.id)?.state,
  ).toBe("cancel-sent");
});

it("recovers the origin of an older wait from a real tool receipt when cancelling", async () => {
  const f = await automaticallyDelegatedFixture();
  const origin = randomUUID();
  f.ops.events = () =>
    [
      {
        turnId: origin,
        payload: {
          type: "tool.completed",
          toolCallId: f.callId,
          output: JSON.stringify(f.result),
          isError: false,
        },
      },
    ] as AgentEvent[];
  const stop = vi.fn(async () => {});
  f.ops.cancelDelegationContinuation = stop;
  await f.service.manage({
    action: "delegation-cancel",
    waitId: f.waits()[0]!.id,
  });
  expect(stop).toHaveBeenCalledWith(
    f.threadId,
    expect.arrayContaining([origin]),
  );
  await expect(
    f.service.operate(
      f.threadId,
      { action: "collaborate", command: f.command },
      "execute",
      randomUUID(),
      origin,
    ),
  ).rejects.toThrow("cancelled");
});

it.each(["cancelled", "failed", "rejected"] as const)(
  "ends waiting on peer %s without waking the model or allowing automatic redispatch",
  async (state) => {
    const f = await automaticallyDelegatedFixture();
    const resume = vi.fn(async () => true);
    f.ops.resumeDelegation = resume;
    f.gateway.store.put("native-tasks", f.result[0]!.id, {
      ...f.result[0],
      state,
      result: "Peer stopped this task",
    });
    f.thread.status = "idle";
    await f.service.poll();
    expect(resume).not.toHaveBeenCalled();
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    expect(f.waits()[0]).toMatchObject({
      state: "interrupted",
      reason: expect.stringContaining("Peer stopped"),
    });
    await expect(
      f.service.operate(
        f.threadId,
        { action: "collaborate", command: f.command },
        "execute",
        randomUUID(),
        randomUUID(),
      ),
    ).rejects.toThrow("click Retry");
    const waitId = f.waits()[0]!.id;
    if (state === "cancelled") {
      await f.service.accept({
        ...f.request,
        id: randomUUID(),
        messageId: randomUUID(),
        taskId: f.threadId,
        text: `/retry ${waitId}`,
      });
    } else {
      await f.service.manage({ action: "delegation-retry", waitId });
    }
    await f.service.poll();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(resume.mock.calls[0])).toContain(
      "explicitly authorized retry",
    );
    await f.service.poll();
    expect(resume).toHaveBeenCalledTimes(1);
  },
);

it("queries unknown and recovered task heartbeats without rearming an interrupted wait", async () => {
  const f = await automaticallyDelegatedFixture();
  const resume = vi.fn(async () => true);
  f.ops.resumeDelegation = resume;
  const task = f.result[0]!;
  f.gateway.store.put("native-tasks", task.id, {
    ...task,
    state: "failed",
    result: "Interrupted",
  });
  f.thread.status = "idle";
  await f.service.poll();
  for (const fresh of [false, true]) {
    f.gateway.store.put("native-tasks", task.id, {
      ...task,
      state: "running",
      heartbeatAt: Date.now() - (fresh ? 0 : 240_000),
    });
    const status = await f.service.operate(
      f.threadId,
      { action: "collaborate", command: { action: "status", text: "" } },
      "execute",
      randomUUID(),
      randomUUID(),
    );
    expect(status).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          state: fresh ? "running" : "unknown",
          reportedState: "running",
          liveness: fresh ? "responsive" : "unknown",
        }),
      ]),
    );
    await f.service.accept({
      ...f.request,
      id: randomUUID(),
      messageId: randomUUID(),
      taskId: f.threadId,
      text: `/status ${f.threadId}`,
    });
    expect(f.waits()[0]!.state).toBe("interrupted");
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    expect(resume).not.toHaveBeenCalled();
  }
});

it("lets a receiving worker wait for a prerequisite and resume its own assignment once", async () => {
  const f = await delegatedFixture();
  f.thread.status = "idle";
  const nativeTaskId = randomUUID();
  await f.service.accept({
    ...f.request,
    id: randomUUID(),
    messageId: randomUUID(),
    nativeTaskId,
    text: "Analyze this project's deployment readiness",
    collaboration: {
      taskId: nativeTaskId,
      coordinatorDeviceId: f.request.deviceId,
      coordinatorThreadId: f.request.id,
      mission: "Analyze this project's deployment readiness",
    },
  });
  const workerId = f.starts.at(-1)!;
  expect(workerId).not.toBe(f.threadId);
  const worker = f.threads.find((t) => t.id === workerId)!;
  const child = {
    ...f.task,
    id: randomUUID(),
    threadId: workerId,
    text: "Provide deployment constraints",
  };
  f.gateway.store.put("native-tasks", child.id, child);
  const resume = vi.fn<NonNullable<ImTaskOperations["resumeDelegation"]>>(
    async () => true,
  );
  f.ops.resumeDelegation = resume;
  worker.status = "running";
  await expect(
    f.service.operate(
      workerId,
      {
        action: "collaborate",
        command: {
          action: "wait",
          taskIds: [child.id],
          waitSeconds: 0,
          text: "Apply constraints to my own project",
        },
      },
      "execute",
      randomUUID(),
    ),
  ).resolves.toMatchObject({ state: "waiting" });
  f.gateway.store.put("native-tasks", child.id, {
    ...child,
    state: "completed",
    result: "Linux only",
  });
  worker.status = "idle";
  await f.service.poll();
  expect(resume).toHaveBeenCalledTimes(1);
  expect(resume.mock.calls[0]![0]).toBe(workerId);
  await f.service.poll();
  expect(resume).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "reconciles deleted native workers from receipts (binding cleaned: %s) even after sharing changed",
  async (cleanBinding) => {
    const f = await delegatedFixture();
    f.thread.status = "idle";
    const nativeTaskId = randomUUID();
    const request = {
      ...f.request,
      id: randomUUID(),
      messageId: randomUUID(),
      nativeTaskId,
      text: "Query local RAM",
      collaboration: {
        taskId: nativeTaskId,
        coordinatorDeviceId: f.request.deviceId,
        coordinatorThreadId: f.request.id,
        mission: "Query local RAM",
      },
    };
    await f.service.accept(request);
    const workerId = f.starts.at(-1)!;
    f.gateway.store.put("invocations", request.id, {
      ...request,
      conversation: {
        ...request.conversation,
        spaceRevision: "previous-sharing",
      },
    });
    f.gateway.store.put("native-tasks", nativeTaskId, {
      ...f.task,
      id: nativeTaskId,
      invocationId: request.id,
      threadId: workerId,
      direction: "incoming",
      state: "running",
    });
    f.threads.splice(
      f.threads.findIndex((t) => t.id === workerId),
      1,
    );
    if (cleanBinding) f.service.deleteThread(workerId);
    await f.service.poll();
    expect(
      f.gateway.store.get<{ state: string }>("native-tasks", nativeTaskId)
        ?.state,
    ).toBe("cancelled");
    await f.service.poll();
    expect(f.starts.filter((id) => id === workerId)).toHaveLength(1);
    expect(
      f.gateway.store
        .pending<{ native?: { task: string } }>("outgoing")
        .filter((i) => i.payload.native?.task === nativeTaskId),
    ).toHaveLength(0);
  },
);

it.runIf(process.platform === "darwin")(
  "lists the authorized root and future directories, but parks a file-only scope until it changes",
  async () => {
    const f = await delegatedFixture();
    f.thread.status = "idle";
    const root = join(f.root, "project");
    await writeFile(join(root, "allowed.txt"), "allowed");
    await mkdir(join(root, "first"));
    await writeFile(join(root, ".env"), "secret");
    const setScope = async (readPaths: string[]) => {
      const settings = f.service.status().settings;
      await f.service.save({
        ...settings,
        grants: settings.grants.map((g) => ({
          ...g,
          security: {
            ...g.security!,
            scopes: g.security!.scopes.map((s) => ({
              ...s,
              readPaths,
              writePaths: [],
              filePaths: readPaths.length ? ["allowed.txt"] : [],
            })),
          },
        })),
      });
    };
    await setScope(["allowed.txt"]);
    await expect(
      f.service.operate(
        f.threadId,
        { action: "read", path: "." },
        "execute",
        randomUUID(),
        "denied-turn",
      ),
    ).resolves.toMatchObject({
      state: "permission-required",
      code: "scope-denied",
      parkPermission: true,
    });
    await expect(
      f.service.operate(
        f.threadId,
        {
          action: "shell",
          command: "python3 -c 'print(1)'",
          timeoutSeconds: 1,
        },
        "execute",
        randomUUID(),
        "denied-turn",
      ),
    ).resolves.toMatchObject({ state: "permission-required" });
    expect(
      f.service.status().remoteTasks!.find((t) => t.threadId === f.threadId)
        ?.permissionBlock,
    ).toContain("根目录");
    await setScope([]);
    expect(f.service.hasPermissionBlock(f.threadId)).toBe(false);
    const read = () =>
      f.service.operate(
        f.threadId,
        { action: "read", path: "." },
        "execute",
        randomUUID(),
        "new-turn",
      );
    const listing = (await read()) as {
      entries: Array<{ path: string; directory: boolean }>;
    };
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        { path: "first", directory: true },
        { path: "allowed.txt", directory: false },
      ]),
    );
    expect(listing.entries.some((e) => e.path === ".env")).toBe(false);
    await mkdir(join(root, "later"));
    expect(await read()).toMatchObject({
      entries: expect.arrayContaining([{ path: "later", directory: true }]),
    });
    expect(f.service.profile(f.threadId)).toBeDefined();
  },
);

it("stops an interrupted wait locally without cancelling the peer or resuming late results", async () => {
  const f = await automaticallyDelegatedFixture();
  const wait = f.waits()[0]!;
  const db = new DatabaseSync(join(f.root, "im.sqlite"));
  const row = db
    .prepare(
      "select value from im_state where namespace='delegation-waits' and id=?",
    )
    .get(wait.id)!;
  db.prepare(
    "update im_state set value=? where namespace='delegation-waits' and id=?",
  ).run(
    JSON.stringify({ ...JSON.parse(String(row.value)), state: "interrupted" }),
    wait.id,
  );
  db.close();
  const resume = vi.fn<NonNullable<ImTaskOperations["resumeDelegation"]>>(
    async () => true,
  );
  f.ops.resumeDelegation = resume;
  const before = f.gateway.router.native
    .tasks(f.groupId)
    .map((t) => ({ id: t.id, state: t.state }));
  await expect(
    f.service.manage({ action: "delegation-stop-wait", waitId: wait.id }),
  ).resolves.toEqual({ state: "cancelled", remoteCancelled: false });
  expect(
    f.gateway.router.native
      .tasks(f.groupId)
      .map((t) => ({ id: t.id, state: t.state })),
  ).toEqual(before);
  expect(
    f.service.status().remoteTasks!.find((t) => t.threadId === f.threadId)
      ?.delegationWaits,
  ).toEqual([]);
  f.thread.status = "idle";
  for (const task of f.gateway.router.native.tasks(f.groupId))
    if (task.direction === "outgoing")
      f.gateway.store.put("native-tasks", task.id, {
        ...task,
        state: "completed",
        result: "Late result",
      });
  await f.service.poll();
  expect(resume).not.toHaveBeenCalled();
});

it("parks preflight denials idempotently and permits a new turn after a system permission repair", async () => {
  const f = await delegatedFixture();
  const error = new ImPermissionError("system-denied", "System denied directory listing");
  const blocked = f.service.blockPermission(f.threadId, error, "old-turn");
  expect(blocked).toMatchObject({state: "permission-required", parkPermission: true});
  expect(() => f.service.authorizeOperation(f.threadId, {action: "read", path: "."}, "execute", "old-turn")).toThrow("System denied");
  expect(f.service.blockPermission(f.threadId, new ImPermissionError("system-denied", blocked.message), "old-turn")).toEqual(blocked);
  await expect(f.service.operate(f.threadId, {action: "read", path: "."}, "execute", randomUUID(), "old-turn")).resolves.toEqual(blocked);
  expect(() => f.service.authorizeOperation(f.threadId, {action: "read", path: "."}, "execute", "new-turn")).not.toThrow();
});

it("starts current-authorized group input independently of a stale implicit selection", async () => {
  const f = await fixture();
  await f.authorize();
  const send = async (text: string) => {
    f.gateway.router.ingest({
      ...f.event,
      messageId: randomUUID(),
      text,
      timestamp: Date.now(),
    });
    f.gateway.router.processIncoming();
    await f.service.poll();
  };
  await send("Old task");
  const old = f.starts[0]!;
  const groupId = f.service
    .status()
    .remoteTasks!.find((t) => t.threadId === old)!.group!.spaceId;
  const group = f.gateway.store.get<
    import("@artemis/protocol").CollaborationSpace
  >("native-groups", groupId)!;
  f.gateway.store.put("native-groups", groupId, {
    ...group,
    revision: randomUUID(),
  });
  await f.service.manage({ action: "refresh" });
  await send("Not yet authorized");
  expect(f.starts).toEqual([old]);
  await f.authorize();
  const targeted = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    groupId,
  );
  await f.service.accept({
    ...targeted,
    id: randomUUID(),
    messageId: randomUUID(),
    taskId: old,
    text: "Continue the old task explicitly",
  });
  expect(f.starts).toEqual([old]);
  await send("Current authorized request");
  expect(f.starts).toHaveLength(2);
  expect(f.starts[1]).not.toBe(old);
  await send("Follow up");
  expect(f.starts[2]).toBe(f.starts[1]);
  expect(() =>
    f.service.authorizeOperation(old, { action: "read", path: "." }, "plan"),
  ).toThrow();
});
