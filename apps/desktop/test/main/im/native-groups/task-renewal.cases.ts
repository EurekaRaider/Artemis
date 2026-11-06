import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  type ImOutboundCandidate,
  type AgentEvent,
  type CollaborationSpace,
} from "@artemis/protocol";

import { fixture, pendingReply } from "../../../fixtures/im/native-groups.js";
it("keeps an existing group task usable when the same authorization is saved again", async () => {
  const f = await fixture();
  await f.authorize();
  f.gateway.router.ingest({
    ...f.event,
    messageId: randomUUID(),
    timestamp: Date.now(),
  });
  f.gateway.router.processIncoming();
  await f.service.poll();
  const threadId = f.starts[0]!;
  expect(threadId).toBeDefined();
  await f.authorize();
  await expect(
    f.service.prepareLocalTurn(threadId, randomUUID()),
  ).resolves.toBeUndefined();
});
it("renews an idle group task for a new desktop turn only after current authorization is confirmed", async () => {
  const f = await fixture();
  await f.authorize();
  f.gateway.router.ingest({
    ...f.event,
    messageId: randomUUID(),
    timestamp: Date.now(),
  });
  f.gateway.router.processIncoming();
  await f.service.poll();
  const threadId = f.starts[0]!;
  const before = f.service.profile(threadId)!;
  const groupId = before.security!.audience.slice("space:".length);
  const group = f.gateway.store.get<CollaborationSpace>(
    "native-groups",
    groupId,
  )!;
  f.gateway.store.put("native-groups", groupId, {
    ...group,
    revision: randomUUID(),
  });
  await f.service.manage({ action: "refresh" });
  const close = vi.spyOn(f.ops, "close");
  await expect(
    f.service.prepareLocalTurn(threadId, randomUUID()),
  ).rejects.toThrow();
  expect(close).not.toHaveBeenCalled();
  await f.authorize();
  close.mockClear();
  const thread = f.threads.find((t) => t.id === threadId)!;
  thread.status = "running";
  await expect(
    f.service.prepareLocalTurn(threadId, randomUUID()),
  ).rejects.toThrow(/active turn/);
  expect(close).not.toHaveBeenCalled();
  thread.status = "idle";
  await expect(
    f.service.prepareLocalTurn(threadId, randomUUID()),
  ).resolves.toBeUndefined();
  expect(close).toHaveBeenCalledWith(threadId);
  expect(f.service.profile(threadId)!.security!.spaceRevision).not.toBe(
    before.security!.spaceRevision,
  );
  expect(() => f.service.authorizeThread(threadId, "plan")).not.toThrow();
});
it("retires pending output and prevents replaying old events after a new group turn", async () => {
  const f = await pendingReply();
  const groupId = f.service
    .profile(f.threadId)!
    .security!.audience.slice("space:".length);
  const group = f.gateway.store.get<CollaborationSpace>(
    "native-groups",
    groupId,
  )!;
  f.gateway.store.put("native-groups", groupId, {
    ...group,
    revision: randomUUID(),
  });
  await f.service.manage({ action: "refresh" });
  await f.authorize();
  const historical: AgentEvent = {
    ...f.events[0]!,
    eventId: randomUUID(),
    seq: 50,
    payload: {
      type: "turn.completed",
      reason: "completed",
      finalPartId: "answer",
    },
  };
  f.events.push(historical);
  await f.service.prepareLocalTurn(f.threadId, randomUUID());
  const candidates = (await f.service.manage({
    action: "outbound-list",
  })) as ImOutboundCandidate[];
  expect(candidates.find((c) => c.id === f.item.id)).toBeUndefined();
  f.service.observe(f.events);
  const db = new DatabaseSync(join(f.root, "im.sqlite"));
  try {
    const candidate = db
      .prepare(
        "SELECT value FROM im_state WHERE namespace='outbound-candidates' AND id=?",
      )
      .get(f.item.id)!;
    expect(JSON.parse(String(candidate.value)).state).toBe("expired");
    const rows = db
      .prepare("SELECT value FROM im_state WHERE namespace='outbox'")
      .all();
    expect(
      rows
        .map((r) => JSON.parse(String(r.value)))
        .filter((r) => r.taskId === f.threadId),
    ).toEqual([]);
    expect(
      db
        .prepare(
          "SELECT value FROM im_state WHERE namespace='observed' AND id=?",
        )
        .get(historical.eventId),
    ).toBeUndefined();
  } finally {
    db.close();
  }
});
