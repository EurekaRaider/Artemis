import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { type CollaborationSpace } from "@artemis/protocol";

import type { Delivery } from "../../../../../../packages/gateway/src/router.js";

import {
  ImService,
  type ImTaskOperations,
} from "../../../../src/main/im/im-service.js";
import {
  cleanup,
  fixture,
  delegatedFixture,
} from "../../../fixtures/im/native-groups.js";
it.each(["slack", "feishu", "lark"] as const)(
  "%s creates the receiver conversation on an explicit fresh dispatch after an unaccepted older assignment on the same desktop",
  async (platform) => {
    const f = await fixture(platform === "slack" ? "slack" : "feishu");
    f.grant.mode = "work";
    const receiverEvent = {
      ...f.event,
      messageId: randomUUID(),
      identity: {
        ...f.event.identity,
        connectionId: "venus",
        appId: "venus-app",
      },
      conversation: { ...f.event.conversation, connectionId: "venus" },
    };
    for (const [connectionId, botId, appId] of [
      ["bot", "jupiter", "app"],
      ["venus", "venus", "venus-app"],
    ])
      f.gateway.store.put("connections", connectionId!, {
        sealed: f.gateway.store.seal({
          id: connectionId,
          channel: f.event.identity.channel,
          domain: platform === "lark" ? "lark" : "feishu",
          tenantId: "tenant",
          appId,
          botUserId: botId,
          botOpenId: botId,
          enabled: true,
        }),
      });
    await f.authorize();
    f.gateway.store.pair(
      f.gateway.store.pairCode(f.service.status().settings.deviceId),
      receiverEvent.identity,
    );
    f.gateway.router.ingest(receiverEvent);
    f.gateway.router.processIncoming();
    await f.service.manage({ action: "refresh" });
    await f.service.manage({
      action: "authorize-native-group",
      conversation: receiverEvent.conversation,
      owner: receiverEvent.identity,
      name: "Test room",
      grant: f.grant,
      confirmed: true,
    });
    const groups = f.gateway.store.list<CollaborationSpace>("native-groups");
    const sender = groups.find((g) => g.endpoints[0]!.connectionId === "bot")!;
    const receiver = groups.find(
      (g) => g.endpoints[0]!.connectionId === "venus",
    )!;
    for (const [group, peer] of [
      [sender, "venus"],
      [receiver, "jupiter"],
    ] as const) {
      f.gateway.store.put("native-groups", group.id, {
        ...group,
        nativeGroup: {
          ...group.nativeGroup,
          capability: "events",
          allowedBots: [peer],
        },
      });
      f.gateway.store.put("native-peers", group.id, [
        { id: peer, name: peer, verifiedAt: Date.now() },
      ]);
    }
    await f.service.manage({ action: "refresh" });
    const request = f.gateway.router.groupConversationContext(
      f.service.status().settings.deviceId,
      sender.id,
    );
    await f.service.accept({ ...request, text: "Ask Venus to report its RAM" });
    const coordinator = f.starts.at(-1)!;
    const command = {
      action: "delegate" as const,
      participantId: "venus",
      text: "Report your computer's RAM",
    };
    const [old] = (await f.service.operate(
      coordinator,
      { action: "collaborate", command },
      "work",
      randomUUID(),
    )) as Array<{ id: string; envelope: { id: string } }>;
    // The provider accepted the old message, but the receiver never accepted it.
    f.gateway.store.mark("outgoing", `native:${old!.envelope.id}`, "done");
    await f.service.poll();
    expect(f.starts).toEqual([coordinator]);
    expect(f.gateway.router.native.tasks(receiver.id)).toEqual([]);
    const oldWait = f.service
      .status()
      .remoteTasks!.find((t) => t.threadId === coordinator)!
      .delegationWaits![0]!;
    await f.service.manage({
      action: "delegation-stop-wait",
      waitId: oldWait.id,
    });
    const tasks = (await f.service.operate(
      coordinator,
      {
        action: "collaborate",
        command: { ...command, newTask: true },
      },
      "work",
      randomUUID(),
    )) as Array<{ id: string }>;
    expect(tasks[0]!.id).not.toBe(old!.id);
    const delivery = f.gateway.store
      .pending<Delivery>("outgoing", Date.now(), "bot")
      .find((item) => item.payload.native?.action === "delegate")!;
    expect(delivery.payload.native?.platform).toBe(platform);
    // Only the serialized IM message crosses into the other bot connection.
    const incoming = {
      ...receiverEvent,
      messageId: randomUUID(),
      timestamp: Date.now(),
      identity: { ...receiverEvent.identity, userId: "jupiter" },
      bot: true,
      text: delivery.payload.text,
    };
    f.gateway.router.ingest(incoming);
    f.gateway.store.mark("outgoing", delivery.id, "done");
    await f.service.poll();
    const worker = f.starts.at(-1)!;
    expect(worker).not.toBe(coordinator);
    expect(f.starts).toEqual([coordinator, worker]);
    expect(
      f.service.status().remoteTasks!.find((t) => t.threadId === worker)?.group
        ?.spaceId,
    ).toBe(receiver.id);
    expect(f.gateway.router.native.tasks(receiver.id)).toEqual([
      expect.objectContaining({
        id: tasks[0]!.id,
        direction: "incoming",
        state: "running",
        threadId: worker,
      }),
    ]);
    f.gateway.router.ingest(incoming);
    await f.service.poll();
    expect(f.starts).toEqual([coordinator, worker]);
  },
);
it.each(["slack", "feishu", "wecom"] as const)(
  "keeps %s human follow-ups in one group task until an explicit new-task request",
  async (channel) => {
    const f = await fixture(channel);
    await f.authorize();
    const send = async (userId: string, text: string) => {
      f.gateway.router.ingest({
        ...f.event,
        messageId: randomUUID(),
        identity: { ...f.event.identity, userId },
        text,
        timestamp: Date.now(),
      });
      f.gateway.router.processIncoming();
      await f.service.poll();
    };
    await send("owner", "Analyze the project");
    const first = f.starts[0]!;
    await send("second-owner", "Please include the test results");
    await send("third-owner", "Also explain the findings");
    expect(f.starts).toEqual([first, first, first]);
    const firstThread = f.threads.find((t) => t.id === first)!;
    firstThread.status = "running";
    f.ops.queue = vi.fn(async () => {});
    await send("second-owner", "One more detail while it is running");
    expect(f.ops.queue).toHaveBeenCalledWith(
      first,
      expect.stringContaining("One more detail"),
      [],
      "One more detail while it is running",
    );
    expect(f.starts).toHaveLength(3);
    firstThread.status = "idle";
    f.ops.classifyControlIntent = vi.fn().mockResolvedValue("new-task");
    await send("second-owner", "这是另一个任务，请单独新建对话分析文档");
    const second = f.starts.at(-1)!;
    expect(second).not.toBe(first);
    f.ops.classifyControlIntent = vi.fn().mockResolvedValue("message");
    await send("owner", "继续补充文档结论");
    expect(f.starts.at(-1)).toBe(second);
    await send("third-owner", "/new Explicit separate task");
    expect(f.starts.at(-1)).not.toBe(second);
    expect(f.starts.at(-1)).not.toBe(first);
  },
);
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
    "work",
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
  f.gateway.store.put("native-tasks", JSON.stringify([task.groupId, task.id]), {
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
      "work",
      randomUUID(),
    );
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([f.groupId, f.task.id]),
      {
        ...f.task,
        state: "completed",
        result: "Done",
      },
    );
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
    "work",
    randomUUID(),
  )) as { waitId: string };
  await f.service
    .manage({ action: "delegation-cancel", waitId: wait.waitId })
    .catch(() => {});
  f.gateway.store.put("native-tasks", JSON.stringify([f.groupId, f.task.id]), {
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
  f.gateway.store.put("native-tasks", JSON.stringify([f.groupId, f.task.id]), {
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
    "work",
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
    "work",
    randomUUID(),
  );
  f.gateway.store.put("native-tasks", JSON.stringify([f.groupId, f.task.id]), {
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
      f.gateway.store.put(
        "native-tasks",
        JSON.stringify([f.groupId, f.task.id]),
        {
          ...f.task,
          state: "completed",
          result: "Quick result",
        },
      ),
    20,
  );
  try {
    const result = await f.service.operate(
      f.threadId,
      { action: "collaborate", command },
      "work",
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
        "work",
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
    "work",
    randomUUID(),
  );
  expect(status).toMatchObject([{ id: f.task.id, invocationId: f.request.id }]);
  f.gateway.store.put("native-tasks", JSON.stringify([f.groupId, "foreign"]), {
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
      "work",
      randomUUID(),
    ),
  ).rejects.toThrow(/owned/);
  // A completed task can be locally cancelled without sending another IM frame.
  f.gateway.store.put("native-tasks", JSON.stringify([f.groupId, f.task.id]), {
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
      "work",
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
      "work",
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
          "work",
          randomUUID(),
        )
        .catch(() => {});
    }
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    expect(cancelContinuation).toHaveBeenCalledWith(
      f.threadId,
      expect.arrayContaining([wait.waitId]),
    );
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([f.groupId, f.task.id]),
      {
        ...f.task,
        state: "completed",
        result: "Late",
      },
    );
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
    "work",
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
  f.gateway.store.put("native-tasks", JSON.stringify([f.groupId, f.task.id]), {
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
