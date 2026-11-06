import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { type AgentEvent } from "@artemis/protocol";

import { ImService } from "../../../../src/main/im/im-service.js";
import {
  cleanup,
  delegatedFixture,
  automaticallyDelegatedFixture,
} from "../../../fixtures/im/native-groups.js";
it.each(["slack", "feishu", "lark"] as const)(
  "%s distinguishes transport delivery from peer acceptance and a stopped local wait",
  async (platform) => {
    const f = await automaticallyDelegatedFixture(false, undefined, platform);
    const task = f.result[0]!;
    const waitId = f.waits()[0]!.id;
    f.gateway.store.mark("outgoing", `native:${task.envelope.id}`, "done");
    const status = () =>
      f.service.operate(
        f.threadId,
        { action: "collaborate", command: { action: "status", text: "" } },
        "work",
        randomUUID(),
        randomUUID(),
      );
    expect(await status()).toMatchObject({
      state: "waiting",
      tasks: expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          state: "unknown",
          reportedState: "sent",
          delivery: "done",
          localWait: { active: true, state: "waiting", waitId },
          instruction: expect.stringContaining(
            "does not confirm peer acceptance",
          ),
        }),
      ]),
    });
    await f.service.manage({ action: "delegation-stop-wait", waitId });
    expect(await status()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: task.id,
          delivery: "done",
          localWait: { active: false, state: "inactive" },
          instruction: expect.stringContaining(
            "Do not claim automatic waiting",
          ),
        }),
      ]),
    );
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    await expect(
      f.service.operate(
        f.threadId,
        {
          action: "collaborate",
          command: {
            action: "message",
            taskId: task.id,
            text: "Say hello and reply to the earlier question",
          },
        },
        "work",
        randomUUID(),
        randomUUID(),
      ),
    ).rejects.toThrow("Notes require an accepted, active task");
    await expect(
      f.service.operate(
        f.threadId,
        {
          action: "collaborate",
          command: {
            action: "wait",
            taskIds: [task.id],
            text: "Wait for a reply to the note",
            waitSeconds: 0,
          },
        },
        "work",
        randomUUID(),
        randomUUID(),
      ),
    ).rejects.toThrow("Automatic waiting for this attempt has ended");
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    expect(
      f.gateway.router.native.tasks(f.groupId).filter((t) => t.id === task.id),
    ).toHaveLength(1);
  },
);
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
    "work",
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
    "work",
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
  f.gateway.store.put(
    "native-tasks",
    JSON.stringify([f.groupId, f.result[0]!.id]),
    {
      ...f.result[0],
      state: "completed",
      result: "Disk result from old protocol",
    },
  );
  await f.service.operate(
    f.threadId,
    { action: "collaborate", command: { action: "status", text: "" } },
    "work",
    randomUUID(),
  );
  expect(f.waits()).toHaveLength(1);
  expect(f.waits()[0]!.taskIds).toEqual([f.result[1]!.id]);
  f.thread.status = "idle";
  await f.service.poll();
  expect(resume).not.toHaveBeenCalled();
  f.gateway.store.put(
    "native-tasks",
    JSON.stringify([f.groupId, f.result[1]!.id]),
    {
      ...f.result[1],
      state: "completed",
      result: "RAM result",
    },
  );
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
    "work",
    f.callId,
  );
  expect(f.waits()).toHaveLength(0);
});
it("restores an automatically registered wait and resumes unread results once after restart", async () => {
  const f = await automaticallyDelegatedFixture();
  const resume = vi.fn(async () => true);
  f.ops.resumeDelegation = resume;
  f.gateway.store.put(
    "native-tasks",
    JSON.stringify([f.groupId, f.result[0]!.id]),
    {
      ...f.result[0],
      state: "completed",
      result: "Old-format peer result",
    },
  );
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
    "work",
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
      "work",
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
    "work",
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
      "work",
      randomUUID(),
      origin,
    ),
  ).rejects.toThrow("cancelled");
  expect(f.waits()).toHaveLength(0);
  await f.service.operate(
    f.threadId,
    { action: "collaborate", command: f.command },
    "work",
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
    "work",
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
    f.gateway.store.get<{ state: string }>(
      "native-tasks",
      JSON.stringify([f.groupId, tasks[0]!.id]),
    )?.state,
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
      "work",
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
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([f.groupId, f.result[0]!.id]),
      {
        ...f.result[0],
        state,
        result: "Peer stopped this task",
      },
    );
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
        "work",
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
it.each(["wait", "status"] as const)(
  "publishes one terminal rejection instead of stale model text after %s",
  async (action) => {
    const turnId = randomUUID();
    const f = await automaticallyDelegatedFixture(false, turnId);
    const events: AgentEvent[] = [
      {
        version: 1,
        eventId: randomUUID(),
        threadId: f.threadId,
        turnId,
        timestamp: new Date().toISOString(),
        payload: {
          type: "message.part.delta",
          messageId: "message",
          partId: "part",
          partType: "text",
          delta: "任务已发送给 Solar，现在等待它的结果。",
        },
      },
    ];
    f.ops.events = () => events;
    f.ops.groupActivity = vi.fn();
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([f.groupId, f.result[0]!.id]),
      {
        ...f.result[0],
        state: "rejected",
        result: "Peer scope is not confirmed",
      },
    );
    await f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command:
          action === "wait"
            ? {
                action,
                taskIds: [f.result[0]!.id],
                waitSeconds: 0,
                text: "Review result",
              }
            : { action, text: "" },
      },
      "work",
      randomUUID(),
      turnId,
    );
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    const finished: AgentEvent = {
      version: 1,
      eventId: randomUUID(),
      threadId: f.threadId,
      turnId,
      timestamp: new Date().toISOString(),
      payload: { type: "turn.completed", reason: "completed", durationMs: 1 },
    };
    events.push(finished);
    f.service.observe([finished]);
    f.service.observe([finished]);
    const db = new DatabaseSync(join(f.root, "im.sqlite"));
    try {
      const replies = db
        .prepare("SELECT value FROM im_state WHERE namespace='outbox'")
        .all()
        .map((row) => JSON.parse(String(row.value)))
        .filter(
          (reply) => reply.invocationId === f.request.id && !reply.started,
        );
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({
        final: true,
        outcome: "failed",
        status: "failed",
      });
      expect(replies[0].text).toContain("Peer scope is not confirmed");
      expect(replies[0].text).not.toContain("现在等待");
      expect(replies[0].text).not.toContain("/stopwait");
    } finally {
      db.close();
    }
    expect(f.ops.groupActivity).toHaveBeenCalledWith(
      expect.any(String),
      f.threadId,
      "failed",
    );
  },
);
