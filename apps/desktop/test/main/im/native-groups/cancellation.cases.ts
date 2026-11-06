import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";

import type { Delivery } from "../../../../../../packages/gateway/src/router.js";

import {
  fixture,
  automaticallyDelegatedFixture,
} from "../../../fixtures/im/native-groups.js";
it.each(["/stop", "取消任务"])(
  "handles %s from a group member with no accepted task before data permission checks",
  async (text) => {
    const f = await fixture();
    await f.authorize();
    const groupId = f.service.status().remoteTasks![0]!.group!.spaceId;
    const request = f.gateway.router.groupConversationContext(
      f.service.status().settings.deviceId,
      groupId,
    );
    await f.service.save({ ...f.service.status().settings, grants: [] });
    f.ops.classifyControlIntent = vi.fn(async () => "cancel-current" as const);
    const id = randomUUID();
    await f.service.accept({
      ...request,
      id,
      messageId: id,
      text,
      originator: { ...request.identity, userId: "member" },
      sourceKind: "member",
    });
    expect(f.starts).toHaveLength(0);
    const db = new DatabaseSync(join(f.root, "im.sqlite"));
    try {
      const replies = db
        .prepare("SELECT value FROM im_state WHERE namespace='outbox'")
        .all()
        .map((row) => JSON.parse(String(row.value)))
        .filter((reply) => reply.invocationId === id);
      expect(replies).toHaveLength(1);
      expect(replies[0].text).toContain("没有可取消");
    } finally {
      db.close();
    }
  },
);
it("allows group members to stop only their own task after its data grant is revoked", async () => {
  const f = await fixture();
  await f.authorize();
  const groupId = f.service.status().remoteTasks![0]!.group!.spaceId;
  const owner = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    groupId,
  );
  const member = { ...owner.identity, userId: "member" };
  await f.service.accept({
    ...owner,
    id: randomUUID(),
    originator: member,
    sourceKind: "member",
    text: "Analyze",
  });
  const thread = f.threads.find((t) => t.id === f.starts[0])!;
  thread.status = "running";
  // A follow-up from another member cannot acquire control of the current task.
  await f.service.accept({
    ...owner,
    id: randomUUID(),
    messageId: randomUUID(),
    taskId: thread.id,
    originator: { ...member, userId: "stranger" },
    sourceKind: "member",
    text: "Additional context",
  });
  await f.service.save({ ...f.service.status().settings, grants: [] });
  thread.status = "running";
  f.ops.cancel = vi.fn(async () => {
    thread.status = "idle";
  });
  for (const userId of ["stranger", "member"]) {
    await f.service.accept({
      ...owner,
      id: randomUUID(),
      messageId: randomUUID(),
      originator: { ...member, userId },
      sourceKind: "member",
      text: `/stop ${thread.id}`,
    });
    expect(f.ops.cancel).toHaveBeenCalledTimes(userId === "member" ? 1 : 0);
  }
  expect(thread.status).toBe("idle");
});
it("sends a cancellation for an owned delegation after project access is revoked", async () => {
  const f = await automaticallyDelegatedFixture();
  await f.service.save({ ...f.service.status().settings, grants: [] });
  await expect(
    f.service.manage({
      action: "native-cancel",
      groupId: f.groupId,
      taskId: f.result[0]!.id,
      messageId: randomUUID(),
    }),
  ).resolves.toMatchObject({ state: "cancel-sent" });
  const cancellation = f.gateway.store
    .pending<import("@artemis/gateway").Delivery>("outgoing")
    .find((item) => item.payload.native?.action === "cancel")!.payload;
  expect(f.gateway.router.canDeliver(cancellation)).toBe(true);
  expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
  await expect(
    f.service.manage({
      action: "native-cancel",
      groupId: f.groupId,
      taskId: "foreign",
      messageId: randomUUID(),
    }),
  ).rejects.toThrow();
});
it.each(["/stop", "取消任务"])(
  "routes a real group member's %s through Gateway to their own task",
  async (text) => {
    const f = await fixture();
    await f.authorize();
    const send = async (body: string) => {
      f.gateway.router.ingest({
        ...f.event,
        messageId: randomUUID(),
        identity: { ...f.event.identity, userId: "member" },
        text: body,
        timestamp: Date.now(),
      });
      f.gateway.router.processIncoming();
      await f.service.poll();
    };
    await send("Do the work");
    const thread = f.threads.find((t) => t.id === f.starts[0])!;
    thread.status = "running";
    f.ops.cancel = vi.fn(async () => {
      thread.status = "idle";
    });
    f.ops.classifyControlIntent = vi.fn(async () => "cancel-current" as const);
    await send(text);
    expect(f.ops.cancel).toHaveBeenCalledOnce();
    expect(f.starts).toHaveLength(1);
    expect(
      f.gateway.store
        .pending<{ text: string }>("outgoing")
        .some((item) => item.payload.text.includes("本地任务已停止")),
    ).toBe(true);
  },
);
it("queries unknown and recovered task heartbeats without rearming an interrupted wait", async () => {
  const f = await automaticallyDelegatedFixture();
  const resume = vi.fn(async () => true);
  f.ops.resumeDelegation = resume;
  const task = f.result[0]!;
  f.gateway.store.put("native-tasks", JSON.stringify([task.groupId, task.id]), {
    ...task,
    state: "failed",
    result: "Interrupted",
  });
  f.thread.status = "idle";
  await f.service.poll();
  for (const fresh of [false, true]) {
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([task.groupId, task.id]),
      {
        ...task,
        state: "running",
        heartbeatAt: Date.now() - (fresh ? 0 : 240_000),
      },
    );
    const status = await f.service.operate(
      f.threadId,
      { action: "collaborate", command: { action: "status", text: "" } },
      "work",
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
          localWait: {
            active: false,
            state: "interrupted",
            waitId: f.waits()[0]!.id,
          },
          instruction: expect.stringContaining("choose Retry in Artemis"),
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
