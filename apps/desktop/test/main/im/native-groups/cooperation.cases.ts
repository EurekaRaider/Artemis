import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { type AgentEvent } from "@artemis/protocol";

import { type ImTaskOperations } from "../../../../src/main/im/im-service.js";
import {
  fixture,
  delegatedFixture,
} from "../../../fixtures/im/native-groups.js";
it.each(["slack", "feishu"] as const)(
  "answers a %s reverse request in the original session and restores the user reply target",
  async (channel) => {
    const f = await delegatedFixture(channel);
    await f.service.operate(
      f.threadId,
      {
        action: "collaborate",
        command: {
          action: "wait",
          taskIds: [f.task.id],
          waitSeconds: 0,
          text: "Finish the user's task",
        },
      },
      "work",
      randomUUID(),
    );
    const nativeTaskId = randomUUID();
    const incoming = {
      ...f.request,
      id: randomUUID(),
      messageId: randomUUID(),
      nativeTaskId,
      taskId: f.threadId,
      text: "What deployment target should I use?",
      collaboration: {
        taskId: nativeTaskId,
        coordinatorDeviceId: f.request.deviceId,
        coordinatorThreadId: f.request.id,
        mission: "Clarify deployment target",
      },
    };
    await f.service.accept(incoming);
    expect(f.starts).toHaveLength(1); // Never overwrite the running user's reply binding.
    f.thread.status = "idle";
    await f.service.poll();
    expect(f.starts).toEqual([f.threadId, f.threadId]);
    expect(f.threads).toHaveLength(2); // Group entry plus the shared conversation.
    expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
    const resume = vi.fn(async () => true);
    f.ops.resumeDelegation = resume;
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([f.groupId, f.task.id]),
      {
        ...f.task,
        state: "completed",
        result: "Analysis ready",
      },
    );
    await f.service.poll();
    expect(resume).not.toHaveBeenCalled();
    const completed = (eventId: string): AgentEvent => ({
      version: 1,
      eventId,
      threadId: f.threadId,
      turnId: eventId,
      timestamp: new Date().toISOString(),
      sequence: 1,
      payload: { type: "turn.completed", reason: "completed", durationMs: 1 },
    });
    const peerReplyId = randomUUID();
    f.service.observe([completed(peerReplyId)]);
    const db = new DatabaseSync(join(f.root, "im.sqlite"));
    const read = (namespace: string, id: string) =>
      JSON.parse(
        String(
          db
            .prepare("SELECT value FROM im_state WHERE namespace=? AND id=?")
            .get(namespace, id)!.value,
        ),
      );
    try {
      expect(read("outbox", peerReplyId)).toMatchObject({
        invocationId: incoming.id,
        final: true,
      });
      expect(read("bindings", f.threadId).request.id).toBe(f.request.id);
      await f.service.poll();
      expect(resume).toHaveBeenCalledTimes(1);
      expect(resume.mock.calls[0]![0]).toBe(f.threadId);
      const userReplyId = randomUUID();
      f.service.observe([completed(userReplyId)]);
      expect(read("outbox", userReplyId)).toMatchObject({
        invocationId: f.request.id,
        final: true,
      });
    } finally {
      db.close();
    }
  },
);
it("cancels a reverse assignment without cancelling the suspended user workflow", async () => {
  const f = await delegatedFixture();
  await f.service.operate(
    f.threadId,
    {
      action: "collaborate",
      command: {
        action: "wait",
        taskIds: [f.task.id],
        waitSeconds: 0,
        text: "Continue user work",
      },
    },
    "work",
    randomUUID(),
  );
  f.thread.status = "idle";
  const nativeTaskId = randomUUID();
  const request = {
    ...f.request,
    id: randomUUID(),
    messageId: randomUUID(),
    nativeTaskId,
    taskId: f.threadId,
    text: "Peer question",
    collaboration: {
      taskId: nativeTaskId,
      coordinatorDeviceId: f.request.deviceId,
      coordinatorThreadId: f.request.id,
      mission: "Peer question",
    },
  };
  await f.service.accept(request);
  expect(f.service.hasDelegationWait(f.threadId)).toBe(false);
  await f.service.accept({
    ...request,
    id: randomUUID(),
    text: "",
    control: "cancel",
  });
  expect(f.service.hasDelegationWait(f.threadId)).toBe(true);
  expect(
    f.gateway.store.get<{ state: string }>(
      "native-tasks",
      JSON.stringify([f.groupId, f.task.id]),
    )?.state,
  ).toBe("running");
  expect(f.starts).toEqual([f.threadId, f.threadId]);
});
it("shares human and native group messages unless a native new conversation is explicit", async () => {
  const f = await fixture("feishu");
  f.grant.mode = "work";
  await f.authorize();
  const owner = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    f.service.status().remoteTasks![0]!.group!.spaceId,
  );
  await f.service.accept({ ...owner, text: "User task" });
  const original = f.starts[0]!;
  const nativeTaskId = randomUUID();
  const assignment = {
    ...owner,
    id: randomUUID(),
    messageId: randomUUID(),
    nativeTaskId,
    text: "Peer question",
    collaboration: {
      taskId: nativeTaskId,
      coordinatorDeviceId: owner.deviceId,
      coordinatorThreadId: owner.id,
      mission: "Peer question",
    },
  };
  await f.service.accept(assignment);
  expect(f.starts).toEqual([original, original]);
  await f.service.accept({
    ...assignment,
    id: randomUUID(),
    messageId: randomUUID(),
    nativeTaskId: randomUUID(),
    nativeNewSession: true,
    collaboration: { ...assignment.collaboration, taskId: randomUUID() },
  });
  const fresh = f.starts.at(-1)!;
  expect(fresh).not.toBe(original);
  await f.service.accept({
    ...owner,
    id: randomUUID(),
    messageId: randomUUID(),
    text: "User follow-up",
  });
  expect(f.starts.at(-1)).toBe(fresh);
});
it("lets a receiving worker wait for a prerequisite and resume its own assignment once", async () => {
  const f = await delegatedFixture();
  f.thread.status = "idle";
  const nativeTaskId = randomUUID();
  const workerInvocationId = randomUUID();
  await f.service.accept({
    ...f.request,
    id: workerInvocationId,
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
  expect(workerId).toBe(f.threadId);
  const worker = f.threads.find((t) => t.id === workerId)!;
  const child = {
    ...f.task,
    id: randomUUID(),
    threadId: workerId,
    invocationId: workerInvocationId,
    text: "Provide deployment constraints",
  };
  f.gateway.store.put(
    "native-tasks",
    JSON.stringify([child.groupId, child.id]),
    child,
  );
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
      "work",
      randomUUID(),
    ),
  ).resolves.toMatchObject({ state: "waiting" });
  f.gateway.store.put(
    "native-tasks",
    JSON.stringify([child.groupId, child.id]),
    {
      ...child,
      state: "completed",
      result: "Linux only",
    },
  );
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
    f.gateway.store.put(
      "native-tasks",
      JSON.stringify([f.groupId, nativeTaskId]),
      {
        ...f.task,
        id: nativeTaskId,
        invocationId: request.id,
        threadId: workerId,
        direction: "incoming",
        state: "running",
      },
    );
    f.threads.splice(
      f.threads.findIndex((t) => t.id === workerId),
      1,
    );
    if (cleanBinding) f.service.deleteThread(workerId);
    await f.service.poll();
    expect(
      f.gateway.store.get<{ state: string }>(
        "native-tasks",
        JSON.stringify([f.groupId, nativeTaskId]),
      )?.state,
    ).toBe("cancelled");
    await f.service.poll();
    expect(f.starts.filter((id) => id === workerId)).toHaveLength(2);
    expect(
      f.gateway.store
        .pending<{ native?: { task: string } }>("outgoing")
        .filter((i) => i.payload.native?.task === nativeTaskId),
    ).toHaveLength(0);
  },
);
