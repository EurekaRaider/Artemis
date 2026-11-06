import { imUserMessageText } from "../../../../src/renderer/im/im-user-message.js";
import { mkdir } from "node:fs/promises";

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { type AgentEvent } from "@artemis/protocol";

import { retireGroup } from "../../../../../../packages/gateway/src/groups/group-retirement.js";

import { ImService } from "../../../../src/main/im/im-service.js";
import { cleanup, fixture } from "../../../fixtures/im/native-groups.js";
it.each(["idle", "running"] as const)(
  "acknowledges remote cancellation of a %s assignment",
  async (status) => {
    const f = await fixture();
    await f.authorize();
    const owner = f.gateway.router.groupConversationContext(
      f.service.status().settings.deviceId,
      f.service.status().remoteTasks![0]!.group!.spaceId,
    );
    const nativeTaskId = randomUUID();
    const request = {
      ...owner,
      id: randomUUID(),
      messageId: randomUUID(),
      nativeTaskId,
      text: "Do the work",
      collaboration: {
        taskId: nativeTaskId,
        coordinatorDeviceId: owner.deviceId,
        coordinatorThreadId: owner.id,
        mission: "Do the work",
      },
    };
    await f.service.accept(request);
    const thread = f.threads.find((t) => t.id === f.starts[0])!;
    thread.status = status;
    const cancel = vi.fn(async () => {
      if (thread.status !== "running")
        throw new Error("Task has no active turn.");
      thread.status = "idle";
    });
    f.ops.cancel = cancel;
    const cancellation = {
      ...request,
      id: randomUUID(),
      text: "",
      control: "cancel",
    };
    await f.service.accept(cancellation);
    expect(cancel).toHaveBeenCalledTimes(status === "running" ? 1 : 0);
    const db = new DatabaseSync(join(f.root, "im.sqlite"));
    try {
      const replies = db
        .prepare("SELECT value FROM im_state WHERE namespace='outbox'")
        .all()
        .map((r) => JSON.parse(String(r.value)))
        .filter((r) => r.invocationId === cancellation.id);
      expect(replies).toEqual([
        expect.objectContaining({ final: true, outcome: "cancelled" }),
      ]);
    } finally {
      db.close();
    }
  },
);
it.each(["feishu", "slack"] as const)(
  "%s retires group permissions but retains read-only conversation history across restart",
  async (channel) => {
    const f = await fixture(channel);
    await f.authorize();
    const before = f.service.status();
    const thread = f.threads[0]!;
    const groupId = before.remoteTasks![0]!.group!.spaceId;
    const ownerScopes = before.settings.grants.flatMap(
      (grant) =>
        grant.security?.scopes.filter(
          (scope) => scope.audience !== `space:${groupId}`,
        ) ?? [],
    );
    retireGroup(f.gateway.store, f.event.conversation, "dissolved");
    await f.service.manage({ action: "refresh" });
    const after = f.service.status();
    expect(after.spaces).toEqual([]);
    expect(after.authorizationOperations).toEqual([]);
    expect(
      after.settings.grants.flatMap((grant) => grant.groups),
    ).not.toContain(`space:${groupId}`);
    expect(
      after.settings.grants.flatMap((grant) => grant.security?.scopes ?? []),
    ).toEqual(ownerScopes);
    expect(
      after.remoteTasks!.find((task) => task.threadId === thread.id)?.group,
    ).toMatchObject({ retired: "dissolved", confirmed: false });
    expect(f.threads).toContain(thread);
    expect(() =>
      f.service.desktopGroupContext(thread.id, "continue", "work"),
    ).toThrow(/对话不可用/);
    await expect(f.authorize()).rejects.toThrow();
    await f.service.close();
    const restarted = new ImService(
      f.root,
      {
        isEncryptionAvailable: () => true,
        encryptString: (s) => Buffer.from(s),
        decryptString: (b) => b.toString(),
      },
      f.ops,
    );
    cleanup.push(() => restarted.close());
    expect(
      restarted
        .status()
        .remoteTasks!.find((task) => task.threadId === thread.id)?.group
        ?.retired,
    ).toBe("dissolved");
    expect(() =>
      restarted.desktopGroupContext(thread.id, "continue", "work"),
    ).toThrow(/对话不可用/);
  },
);
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
it("queues group prompts with clean display text separate from private context", async () => {
  const f = await fixture();
  await f.authorize();
  const queue = vi.spyOn(f.ops, "queue");
  const send = async (text: string) => {
    f.gateway.router.ingest({
      ...f.event,
      messageId: randomUUID(),
      timestamp: Date.now(),
      text,
    });
    f.gateway.router.processIncoming();
    await f.service.poll();
  };
  await send("first");
  const child = f.starts[0]!;
  f.threads.find((thread) => thread.id === child)!.status = "running";
  await send("@Mino 请报告内存");
  expect(queue).toHaveBeenCalledWith(
    child,
    expect.stringContaining("[IM provenance"),
    [],
    "@Mino 请报告内存",
  );
  expect(imUserMessageText(queue.mock.calls[0]![1])).toBe("@Mino 请报告内存");
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
  f.grant.mode = "work";
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
      "work",
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
  ).toThrow(/Plan/);
  await f.service.save({ ...f.service.status().settings, enabled: false });
  expect(() => f.service.authorizeThread(threadId, "plan")).toThrow();
});
it("queries Slack bots in Plan without dispatching or requiring bot authorization", async () => {
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
  for (const mode of ["plan"] as const) {
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
