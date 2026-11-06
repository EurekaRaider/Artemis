import { mkdir, writeFile } from "node:fs/promises";

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { type AgentEvent, type CollaborationSpace } from "@artemis/protocol";

import { ImPermissionError } from "../../../../src/main/im/im-policy.js";
import { type ImTaskOperations } from "../../../../src/main/im/im-service.js";
import {
  fixture,
  delegatedFixture,
  automaticallyDelegatedFixture,
} from "../../../fixtures/im/native-groups.js";
it.runIf(process.platform === "darwin")(
  "projects file-only scopes and denies only the rejected operation while legal work continues",
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
        "work",
        randomUUID(),
        "denied-turn",
      ),
    ).resolves.toEqual({
      entries: [{ path: "allowed.txt", directory: false }],
    });
    await expect(
      f.service.operate(
        f.threadId,
        { action: "read", path: "first/private.txt" },
        "work",
        randomUUID(),
        "denied-turn",
      ),
    ).resolves.toMatchObject({
      state: "operation-denied",
      code: "scope-denied",
      parkPermission: false,
    });
    await expect(
      f.service.operate(
        f.threadId,
        {
          action: "read",
          path: "allowed.txt",
        },
        "work",
        randomUUID(),
        "denied-turn",
      ),
    ).resolves.toMatchObject({ output: "allowed" });
    expect(
      f.service.status().remoteTasks!.find((t) => t.threadId === f.threadId)
        ?.permissionBlock,
    ).toBeUndefined();
    await setScope([]);
    expect(f.service.hasPermissionBlock(f.threadId)).toBe(false);
    const read = () =>
      f.service.operate(
        f.threadId,
        { action: "read", path: "." },
        "work",
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
      f.gateway.store.put(
        "native-tasks",
        JSON.stringify([task.groupId, task.id]),
        {
          ...task,
          state: "completed",
          result: "Late result",
        },
      );
  await f.service.poll();
  expect(resume).not.toHaveBeenCalled();
});
it("reports system denials without blocking unrelated operations in the same turn", async () => {
  const f = await delegatedFixture();
  const error = new ImPermissionError(
    "system-denied",
    "System denied directory listing",
  );
  const blocked = f.service.blockPermission(f.threadId, error, "old-turn");
  expect(blocked).toMatchObject({
    state: "operation-denied",
    parkPermission: false,
  });
  expect(() =>
    f.service.authorizeOperation(
      f.threadId,
      { action: "read", path: "." },
      "work",
      "old-turn",
    ),
  ).not.toThrow();
  expect(f.service.hasPermissionBlock(f.threadId)).toBe(false);
  expect(() =>
    f.service.authorizeOperation(
      f.threadId,
      { action: "read", path: "." },
      "work",
      "new-turn",
    ),
  ).not.toThrow();
});
it("keeps member discovery and coordination available while a local writer is busy", async () => {
  const f = await delegatedFixture();
  f.threads.push({
    ...f.thread,
    id: "local-writer",
    status: "running",
    mode: "work",
  });
  expect(() => f.service.authorizeThread(f.threadId, "work")).not.toThrow();
  await expect(
    f.service.operate(
      f.threadId,
      { action: "participants" },
      "work",
      randomUUID(),
    ),
  ).resolves.toHaveProperty("members");
  await expect(
    f.service.operate(
      f.threadId,
      { action: "collaborate", command: { action: "status", text: "" } },
      "work",
      randomUUID(),
    ),
  ).resolves.toBeDefined();
  expect(() =>
    f.service.authorizeOperation(
      f.threadId,
      { action: "write", path: "denied.txt", content: "no" },
      "plan",
    ),
  ).toThrow();
});
it("changes only the edited audience revision and keeps another audience active", async () => {
  const f = await delegatedFixture();
  const before = f.service.profile(f.threadId)!.security!.revision;
  const settings = f.service.status().settings;
  await f.service.save({
    ...settings,
    grants: settings.grants.map((g) => ({
      ...g,
      security: {
        ...g.security!,
        scopes: [
          ...g.security!.scopes.filter((s) => s.audience !== "owner"),
          {
            audience: "owner",
            readPaths: ["README.md"],
            writePaths: [],
            confirmedAt: 0,
          },
        ],
      },
    })),
  });
  expect(f.service.profile(f.threadId)!.security!.revision).toBe(before);
  expect(() => f.service.authorizeThread(f.threadId, "work")).not.toThrow();
});
it("defaults to configured reads in an enabled group while write confirmation is pending", async () => {
  const f = await fixture();
  f.grant.mode = "work";
  await f.authorize();
  const settings = f.service.status().settings;
  await f.service.save({
    ...settings,
    grants: settings.grants.map((grant) => ({
      ...grant,
      security: {
        ...grant.security!,
        scopes: grant.security!.scopes.map((scope) => ({
          ...scope,
          confirmedAt: 0,
          readMode: "selected" as const,
          readPaths: ["docs/public"],
          writePaths: ["docs/public"],
          filePaths: [],
        })),
      },
    })),
  });
  f.gateway.router.ingest({
    ...f.event,
    messageId: randomUUID(),
    text: "List the project directories",
    timestamp: Date.now(),
  });
  f.gateway.router.processIncoming();
  await f.service.poll();
  expect(f.starts).toHaveLength(1);
  const id = f.starts[0]!;
  await expect(
    f.service.operate(id, { action: "read", path: "." }, "work", randomUUID()),
  ).resolves.toEqual({ entries: [{ path: "docs", directory: true }] });
  for (const path of ["private.txt", "docs/public/.env"]) {
    expect(() =>
      f.service.authorizeOperation(id, { action: "read", path }, "work"),
    ).toThrow();
  }
  expect(() =>
    f.service.authorizeOperation(
      id,
      { action: "write", path: "docs/public/new.txt", content: "no" },
      "work",
    ),
  ).toThrow();
  expect(() =>
    f.service.authorizeOperation(
      id,
      { action: "shell", command: "ls", timeoutSeconds: 1 },
      "work",
    ),
  ).toThrow();
  const turnId = randomUUID();
  const events: AgentEvent[] = [
    {
      version: 1,
      eventId: randomUUID(),
      threadId: id,
      turnId,
      timestamp: new Date().toISOString(),
      payload: {
        type: "message.part.delta",
        messageId: "read-result",
        partId: "read-result",
        partType: "text",
        delta: "Default read result: docs",
      },
    },
    {
      version: 1,
      eventId: randomUUID(),
      threadId: id,
      turnId,
      timestamp: new Date().toISOString(),
      payload: { type: "turn.completed", reason: "completed", durationMs: 1 },
    },
  ];
  f.ops.events = () => events;
  f.service.observe(events);
  await f.service.poll();
  expect(
    f.gateway.store
      .pending<{ text: string }>("outgoing")
      .some((item) => item.payload.text.includes("Default read result: docs")),
  ).toBe(true);
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
it.runIf(process.platform === "darwin")(
  "queues an actual write behind a local writer, rechecks its scope, and cancels waiting work",
  async () => {
    const f = await delegatedFixture();
    f.thread.status = "idle";
    const settings = f.service.status().settings;
    await f.service.save({
      ...settings,
      grants: settings.grants.map((g) => ({
        ...g,
        security: {
          ...g.security!,
          scopes: g.security!.scopes.map((s) => ({
            ...s,
            writeMode: "project",
          })),
        },
      })),
    });
    const local = {
      ...f.thread,
      id: "local-writer",
      status: "running" as const,
    };
    f.threads.push(local);
    let finished = false;
    const writing = f.service
      .operate(
        f.threadId,
        { action: "write", path: "queued.txt", content: "OK" },
        "work",
        randomUUID(),
      )
      .then((result) => {
        finished = true;
        return result;
      });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(finished).toBe(false);
    await expect(
      f.service.operate(
        f.threadId,
        { action: "participants" },
        "work",
        randomUUID(),
      ),
    ).resolves.toHaveProperty("members");
    local.status = "idle";
    await expect(writing).resolves.toMatchObject({ exitCode: 0 });
    local.status = "running";
    const cancelled = f.service.operate(
      f.threadId,
      { action: "write", path: "cancelled.txt", content: "NO" },
      "work",
      randomUUID(),
    );
    const rejected = expect(cancelled).rejects.toThrow();
    f.service.cancelOperations(f.threadId);
    await rejected;
    const { readFile } = await import("node:fs/promises");
    await expect(
      readFile(join(f.root, "project", "cancelled.txt")),
    ).rejects.toThrow();
  },
);
it("preserves the model context for additive access and replaces it when readable data shrinks", async () => {
  const f = await delegatedFixture();
  f.thread.status = "idle";
  await mkdir(join(f.root, "project", "src"));
  await mkdir(join(f.root, "project", "docs"));
  const setReads = async (readPaths: string[]) => {
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
            filePaths: [],
            confirmedAt: Date.now(),
          })),
        },
      })),
    });
    return f.service.profile(f.threadId)!.security!;
  };
  const restricted = await setReads(["src"]);
  const expanded = await setReads(["src", "docs"]);
  expect(expanded.revision).not.toBe(restricted.revision);
  expect(expanded.contextRevision).toBe(restricted.contextRevision);
  const narrowed = await setReads(["docs"]);
  expect(narrowed.contextRevision).not.toBe(expanded.contextRevision);
  const close = vi.spyOn(f.ops, "close");
  await f.service.prepareLocalTurn(f.threadId, randomUUID());
  expect(close).toHaveBeenCalledWith(f.threadId);
  expect(f.service.profile(f.threadId)!.security!.contextRevision).toBe(
    narrowed.contextRevision,
  );
});
