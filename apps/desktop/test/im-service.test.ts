import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ArtemisGateway } from "../../../packages/gateway/src/server.js";
import { ImService, type ImTaskOperations } from "../src/main/im-service.js";
import {
  executionGrantSchema,
  imConversationKey,
  type AgentEvent,
  type ChannelEvent,
  type CollaborationTask,
  type Project,
  type RemoteInvocationContext,
  type Thread,
} from "@artemis/protocol";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const clean of cleanups.reverse()) await clean();
  cleanups.length = 0;
});
async function fixture(channel: "wecom" | "feishu" | "slack" = "wecom") {
  const root = await mkdtemp(join(tmpdir(), "artemis-im-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const gateway = new ArtemisGateway({
    databasePath: join(root, "gateway.sqlite"),
    encryptionKey: "e".repeat(32),
    adminToken: "a".repeat(32),
  });
  const port = await gateway.listen(0);
  cleanups.push(() => gateway.close());
  await mkdir(join(root, "project"));
  const projects: Project[] = [
    {
      id: "project",
      name: "Project",
      path: join(root, "project"),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const threads: Thread[] = [];
  const events: AgentEvent[] = [];
  const starts: string[] = [],
    queued: string[] = [],
    approvals: unknown[] = [],
    answers: unknown[] = [];
  const ops: ImTaskOperations = {
    projects: () => projects,
    threads: () => threads,
    thread: (id) => threads.find((t) => t.id === id),
    ready: () => true,
    events: () => events,
    create: async (id, projectId, mode, title) => {
      const t: Thread = {
        id,
        projectId,
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
    close: async () => {},
    start: async (id, text) => {
      starts.push(text);
      threads.find((t) => t.id === id)!.status = "running";
    },
    queue: async (_id, text) => {
      queued.push(text);
    },
    cancel: async (id) => {
      threads.find((t) => t.id === id)!.status = "idle";
    },
    approve: async (r) => {
      approvals.push(r);
    },
    answer: (answer) => {
      answers.push(answer);
    },
  };
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (s: Buffer) => s.toString(),
  };
  const service = new ImService(root, secure, ops);
  cleanups.push(() => service.close());
  await service.manage({
    action: "register",
    gatewayUrl: `http://127.0.0.1:${port}`,
    name: "Alice device",
    adminToken: "a".repeat(32),
  });
  const settings = service.status().settings;
  await service.save({
    ...settings,
    enabled: true,
    defaultProjectId: "project",
    grants: [
      executionGrantSchema.parse({
        projectId: "project",
        expiresAt: Date.now() + 600000,
      }),
    ],
  });
  const identity = {
    channel,
    connectionId: "w",
    tenantId: "t",
    appId: "bot",
    userId: "alice",
  };
  const code = (await service.manage({ action: "pair" })) as { code: string };
  gateway.store.pair(code.code, identity);
  await service.poll();
  const send = async (text: string, id = randomUUID(), userId = "alice") => {
    const event: ChannelEvent = {
      version: 1,
      messageId: id,
      identity: { ...identity, userId },
      conversation: { connectionId: "w", id: userId, kind: "direct" },
      text,
      timestamp: Date.now(),
      mentioned: true,
      bot: false,
      attachments: [],
    };
    gateway.router.ingest(event);
    await service.poll();
  };
  return {
    service,
    gateway,
    threads,
    events,
    starts,
    queued,
    approvals,
    answers,
    send,
    identity,
    root,
    ops,
    secure,
    port,
  };
}
async function groupFixture() {
  const f = await fixture("feishu");
  const members = [];
  for (const [name, channel] of [
    ["Bob", "slack"],
    ["Carol", "wecom"],
  ] as const) {
    const directory = join(f.root, name);
    const project = {
      ...f.ops.projects()[0]!,
      path: join(directory, "project"),
    };
    await mkdir(project.path, { recursive: true });
    const events: AgentEvent[] = [];
    const threads: Thread[] = [],
      starts: string[] = [],
      queued: string[] = [];
    const service = new ImService(directory, f.secure, {
      ...f.ops,
      events: () => events,
      projects: () => [project],
      threads: () => threads,
      thread: (id) => threads.find((t) => t.id === id),
      create: async (id, projectId, mode, title) => {
        const thread: Thread = {
          id,
          projectId,
          mode,
          title,
          target: "local",
          status: "idle",
          pinned: false,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        threads.push(thread);
        return thread;
      },
      start: async (id, text) => {
        starts.push(text);
        threads.find((t) => t.id === id)!.status = "running";
      },
      queue: async (_id, text) => {
        queued.push(text);
      },
      cancel: async (id) => {
        threads.find((t) => t.id === id)!.status = "idle";
      },
    });
    cleanups.push(() => service.close());
    await service.manage({
      action: "register",
      gatewayUrl: `http://127.0.0.1:${f.port}`,
      name,
      adminToken: "a".repeat(32),
    });
    const identity = {
      channel,
      connectionId: name,
      tenantId: "tenant",
      appId: "bot",
      userId: name,
    };
    const code = (await service.manage({ action: "pair" })) as { code: string };
    f.gateway.store.pair(code.code, identity);
    members.push({
      name,
      service,
      identity,
      threads,
      events,
      starts,
      queued,
      deviceId: service.status().settings.deviceId,
      endpoint: {
        connectionId: name,
        id: `${name}-group`,
        kind: "group" as const,
      },
    });
  }
  const source = {
    connectionId: "w",
    id: "source-group",
    kind: "group" as const,
  };
  const space = {
    id: "shared",
    revision: "revision",
    name: "Cross IM team",
    endpoints: [source, ...members.map((m) => m.endpoint)],
    administrators: [f.identity],
    participants: [
      {
        deviceId: f.service.status().settings.deviceId,
        identity: f.identity,
        name: "Alice",
      },
      ...members.map((m) => ({
        deviceId: m.deviceId,
        identity: m.identity,
        name: m.name,
      })),
    ],
  };
  f.gateway.store.put("spaces", space.id, space);
  f.gateway.store.put(
    "space-confirmations",
    space.id,
    space.endpoints.map(imConversationKey),
  );
  for (const service of [f.service, ...members.map((m) => m.service)]) {
    await service.save({
      ...service.status().settings,
      enabled: true,
      defaultProjectId: "project",
      grants: [
        executionGrantSchema.parse({
          projectId: "project",
          groups: ["space:shared"],
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    await service.poll();
  }
  const send = async (text: string, patch: Partial<ChannelEvent> = {}) => {
    f.gateway.router.ingest({
      version: 1,
      messageId: randomUUID(),
      identity: f.identity,
      conversation: source,
      text,
      mentioned: true,
      bot: false,
      timestamp: Date.now(),
      attachments: [],
      ...patch,
    });
    await f.service.poll();
  };
  return { ...f, members, source, space, send };
}
describe("IM desktop and Gateway loop", () => {
  it("creates one idle conversation per confirmed space without an IM task, survives refresh and restart, and preserves explicit deletion", async () => {
    const f = await groupFixture();
    expect(f.threads).toHaveLength(1);
    const thread = f.threads[0]!;
    expect(thread).toMatchObject({
      title: "群协作 · Cross IM team",
      status: "idle",
      projectId: "project",
    });
    expect(f.starts).toHaveLength(0);
    expect(f.service.hasGroupCollaboration(thread.id)).toBe(true);
    expect(f.service.profile(thread.id)).toBeUndefined();
    expect(f.gateway.store.pending("device")).toHaveLength(0);
    expect(f.gateway.store.pending("outgoing")).toHaveLength(0);
    await Promise.all([
      f.service.manage({ action: "refresh" }),
      f.service.manage({ action: "refresh" }),
    ]);
    expect(f.threads).toHaveLength(1);
    await f.service.close();
    const restarted = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => restarted.close());
    await restarted.poll();
    expect(f.threads.map((t) => t.id)).toEqual([thread.id]);
    f.threads.splice(0, 1);
    restarted.deleteThread(thread.id);
    await restarted.poll();
    expect(f.threads).toHaveLength(0);
  });
  it("opens idle conversations for exact target sets, persists member names across restart and rejects other targets", async () => {
    const f = await groupFixture();
    const bob = f.members[0]!,
      carol = f.members[1]!;
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service
        .status()
        .settings.grants.map((g) => ({ ...g, mode: "execute" })),
    });
    await f.service.manage({
      action: "rename-group-member",
      deviceId: bob.deviceId,
      name: "小博",
      deviceName: "后端开发机",
    });
    const action = {
      action: "open-group-conversation" as const,
      spaceId: f.space.id,
      participantIds: [bob.deviceId],
      projectId: "project",
    };
    const opened = (await Promise.all([
      f.service.manage(action),
      f.service.manage(action),
    ])) as { threadId: string }[];
    const id = opened[0]!.threadId;
    expect(opened[1]!.threadId).toBe(id);
    expect(f.threads).toHaveLength(2);
    expect(f.threads.find((t) => t.id === id)).toMatchObject({
      title: "群协作 · 小博",
      status: "idle",
    });
    expect(f.starts).toHaveLength(0);
    expect(f.gateway.store.pending("device")).toHaveLength(0);
    expect(f.gateway.store.pending("outgoing")).toHaveLength(0);
    await f.send(`/task ${id}`);
    await f.send("Continue the selected conversation from IM");
    expect(
      f.service.status().remoteTasks.find((t) => t.threadId === id)!.group!
        .targetDeviceIds,
    ).toEqual([bob.deviceId]);
    expect(() =>
      f.service.authorizeOperation(
        id,
        {
          action: "collaborate",
          command: {
            action: "delegate",
            participantId: carol.deviceId,
            text: "Do not misroute",
          },
        },
        "execute",
      ),
    ).toThrow("本对话中选择的成员");
    f.threads.find((t) => t.id === id)!.status = "idle";
    await f.service.close();
    const service = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => service.close());
    await service.poll();
    const group = service
      .status()
      .remoteTasks.find((t) => t.threadId === id)!.group!;
    expect(group.targetDeviceIds).toEqual([bob.deviceId]);
    expect(
      group.members.find((m) => m.deviceId === bob.deviceId),
    ).toMatchObject({ name: "小博", deviceName: "后端开发机" });
    expect(await service.manage(action)).toEqual({ threadId: id });
    await service.prepareLocalTurn(id, "target-turn");
    const context = service.desktopGroupContext(
      id,
      "@小博 检查接口",
      "execute",
    )!;
    expect(context).toContain(bob.deviceId);
    expect(context).toContain("后端开发机");
    expect(context).not.toContain(carol.deviceId);
    expect(() =>
      service.desktopGroupContext(id, "@小博 检查接口", "plan"),
    ).toThrow("Execute");
    expect(() =>
      service.desktopGroupContext(id, "@Carol 检查接口", "execute"),
    ).toThrow("@成员");
    const delegate = (participantId: string) => ({
      action: "collaborate" as const,
      command: {
        action: "delegate-many" as const,
        text: "",
        assignments: [{ participantId, text: "检查接口" }],
      },
    });
    await expect(
      service.operate(
        id,
        delegate(carol.deviceId),
        "execute",
        "wrong-target",
        "target-turn",
      ),
    ).rejects.toThrow("本对话中选择的成员");
    await service.operate(
      id,
      delegate(bob.deviceId),
      "execute",
      "right-target",
      "target-turn",
    );
    await Promise.all(f.members.map((m) => m.service.poll()));
    expect(bob.starts).toHaveLength(1);
    expect(carol.starts).toHaveLength(0);
    await expect(
      service.manage({ ...action, participantIds: ["missing-device"] }),
    ).rejects.toThrow();
    await expect(
      service.manage({
        action: "rename-group-member",
        deviceId: "missing-device",
        name: "Forged",
        deviceName: "Other",
      }),
    ).rejects.toThrow();
    await service.manage({
      action: "admin",
      operation: "remove-space",
      adminToken: "a".repeat(32),
      configuration: { id: f.space.id },
    });
    await expect(
      service.prepareLocalTurn(id, "deleted-space-turn"),
    ).rejects.toThrow();
  });
  it("persists conversation-only removal and revokes removed space members without disrupting remaining confirmations", async () => {
    const f = await groupFixture(),
      bob = f.members[0]!,
      carol = f.members[1]!;
    const { threadId } = (await f.service.manage({
      action: "open-group-conversation",
      spaceId: f.space.id,
      participantIds: [bob.deviceId, carol.deviceId],
    })) as { threadId: string };
    const thread = f.threads.find((t) => t.id === threadId)!;
    thread.status = "running";
    await expect(
      f.service.manage({
        action: "remove-conversation-member",
        threadId,
        deviceId: bob.deviceId,
      }),
    ).rejects.toThrow("停止当前任务");
    thread.status = "idle";
    await f.service.manage({
      action: "remove-conversation-member",
      threadId,
      deviceId: bob.deviceId,
    });
    expect(
      f.service.status().remoteTasks.find((t) => t.threadId === threadId)!
        .group!.targetDeviceIds,
    ).toEqual([carol.deviceId]);
    expect(
      f.gateway.store.get<{ participants: unknown[] }>("spaces", f.space.id)!
        .participants,
    ).toHaveLength(3);
    await f.service.prepareLocalTurn(threadId, "restricted-grant-turn");
    expect(() =>
      f.service.desktopGroupContext(threadId, "@Carol 检查接口", "execute"),
    ).toThrow("项目授权");
    const bobRequest = f.gateway.router.groupConversationContext(
      bob.deviceId,
      f.space.id,
    );
    const carolRequest = f.gateway.router.groupConversationContext(
      carol.deviceId,
      f.space.id,
    );
    await f.send(`/ask ${bob.deviceId} queued task`);
    await f.service.manage({
      action: "admin",
      operation: "remove-space-member",
      adminToken: "a".repeat(32),
      configuration: { spaceId: f.space.id, deviceId: bob.deviceId },
    });
    expect(f.gateway.router.isInvocationAuthorized(bobRequest)).toBe(false);
    expect(f.gateway.router.isInvocationAuthorized(carolRequest)).toBe(true);
    expect(f.gateway.store.get("space-confirmations", f.space.id)).toEqual(
      f.space.endpoints.map(imConversationKey),
    );
    await bob.service.poll();
    expect(bob.starts).toHaveLength(0);
    await f.service.close();
    const restarted = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => restarted.close());
    await restarted.poll();
    expect(
      restarted.status().remoteTasks.find((t) => t.threadId === threadId)!
        .group!.targetDeviceIds,
    ).toEqual([carol.deviceId]);
    await restarted.manage({
      action: "remove-conversation-member",
      threadId,
      deviceId: carol.deviceId,
    });
    await restarted.poll();
    expect(
      restarted.status().remoteTasks.find((t) => t.threadId === threadId)!
        .group!.targetDeviceIds,
    ).toEqual([]);
    expect(f.threads.find((t) => t.id === threadId)).toBeDefined();
  });
  it("scopes collaboration retries to the conversation and turn when model tool call IDs repeat", async () => {
    const f = await groupFixture(),
      bob = f.members[0]!;
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service
        .status()
        .settings.grants.map((g) => ({ ...g, mode: "execute" })),
    });
    const first = f.threads[0]!.id;
    const second = (
      (await f.service.manage({
        action: "open-group-conversation",
        spaceId: f.space.id,
        participantIds: [bob.deviceId],
      })) as { threadId: string }
    ).threadId;
    const operation = {
      action: "collaborate" as const,
      command: {
        action: "delegate" as const,
        participantId: bob.deviceId,
        text: "Inspect the project",
      },
    };
    await f.service.prepareLocalTurn(first, "first-turn");
    await f.service.operate(
      first,
      operation,
      "execute",
      "same-model-call",
      "first-turn",
    );
    await f.service.prepareLocalTurn(second, "second-turn");
    const result = await f.service.operate(
      second,
      operation,
      "execute",
      "same-model-call",
      "second-turn",
    );
    expect(
      f.gateway.store
        .list<CollaborationTask>("collaboration-tasks")
        .map((t) => t.coordinatorThreadId)
        .sort(),
    ).toEqual([first, second].sort());
    expect(
      await f.service.operate(
        second,
        operation,
        "execute",
        "same-model-call",
        "second-turn",
      ),
    ).toEqual(result);
    expect(f.gateway.store.list("collaboration-tasks")).toHaveLength(2);
    await expect(
      f.service.operate(
        second,
        {
          ...operation,
          command: { ...operation.command, text: "Different task" },
        },
        "execute",
        "same-model-call",
        "second-turn",
      ),
    ).rejects.toThrow("different command");
    await f.service.prepareLocalTurn(second, "third-turn");
    await f.service.operate(
      second,
      operation,
      "execute",
      "same-model-call",
      "third-turn",
    );
    expect(f.gateway.store.list("collaboration-tasks")).toHaveLength(3);
  });
  it("waits for every group confirmation and a local project grant before creating a group conversation", async () => {
    const f = await fixture("feishu");
    const endpoint = { connectionId: "w", id: "group", kind: "group" as const };
    const space = {
      id: "waiting",
      revision: "v1",
      name: "Waiting",
      endpoints: [endpoint],
      participants: [
        {
          deviceId: f.service.status().settings.deviceId,
          identity: f.identity,
          name: "Alice",
        },
      ],
    };
    f.gateway.store.put("spaces", space.id, space);
    await f.service.poll();
    expect(f.threads).toHaveLength(0);
    f.gateway.store.put("space-confirmations", space.id, [
      imConversationKey(endpoint),
    ]);
    await f.service.poll();
    expect(f.threads).toHaveLength(0);
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service
        .status()
        .settings.grants.map((g) => ({ ...g, groups: ["space:waiting"] })),
    });
    await f.service.poll();
    expect(f.threads).toHaveLength(1);
    expect(f.starts).toHaveLength(0);
    await f.send("Private task remains separate");
    expect(f.threads).toHaveLength(2);
  });
  it("reuses the automatic conversation for an IM prompt and retains history while deletion revokes remote work", async () => {
    const f = await groupFixture();
    const id = f.threads[0]!.id;
    await f.send("Inspect this project");
    expect(f.threads).toHaveLength(1);
    expect(f.threads[0]!.id).toBe(id);
    expect(f.starts).toHaveLength(1);
    await f.service.manage({
      action: "admin",
      operation: "remove-space",
      adminToken: "a".repeat(32),
      configuration: { id: f.space.id },
    });
    await f.service.poll();
    expect(f.gateway.store.get("spaces", f.space.id)).toBeUndefined();
    expect(f.threads).toHaveLength(1);
    expect(f.threads[0]!.status).toBe("idle");
    expect(() => f.service.authorizeThread(id, "plan")).toThrow();
    expect(f.service.status().remoteTasks[0]!.group?.confirmed).toBe(false);
    await f.send("Do not execute after deletion");
    expect(f.starts).toHaveLength(1);
    expect(f.threads).toHaveLength(1);
  });
  it("reports a failed automatic conversation separately and continues delivering other IM tasks", async () => {
    const f = await fixture("feishu");
    const endpoint = { connectionId: "w", id: "group", kind: "group" as const };
    f.gateway.store.put("spaces", "sync-failure", {
      id: "sync-failure",
      revision: "v1",
      name: "Group",
      endpoints: [endpoint],
      participants: [
        {
          deviceId: f.service.status().settings.deviceId,
          identity: f.identity,
          name: "Alice",
        },
      ],
    });
    f.gateway.store.put("space-confirmations", "sync-failure", [
      imConversationKey(endpoint),
    ]);
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service
        .status()
        .settings.grants.map((g) => ({ ...g, groups: ["space:sync-failure"] })),
    });
    const create = f.ops.create;
    f.ops.create = async (...args) => {
      if (args[3].startsWith("群协作"))
        throw new Error("Group creation failed");
      return create(...args);
    };
    await f.send("Continue private task");
    expect(f.starts).toHaveLength(1);
    expect(f.service.status().groupConversationError).toBe(
      "Group creation failed",
    );
    f.ops.create = create;
    await f.service.poll();
    expect(
      f.threads.filter((thread) => thread.title.startsWith("群协作")),
    ).toHaveLength(1);
    expect(f.service.status().groupConversationError).toBeUndefined();
  });
  it("lets an active desktop group turn delegate without reopening IM access to its local tools", async () => {
    const f = await groupFixture();
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service
        .status()
        .settings.grants.map((g) => ({ ...g, mode: "execute" })),
    });
    const thread = f.threads[0]!;
    thread.status = "idle";
    await f.service.prepareLocalTurn(thread.id, "desktop-turn");
    expect(f.service.profile(thread.id)).toBeUndefined();
    const operation = {
      action: "collaborate" as const,
      command: {
        action: "delegate-many" as const,
        text: "",
        assignments: f.members.map((m) => ({
          participantId: m.deviceId,
          text: `Inspect ${m.name}'s part`,
        })),
      },
    };
    await expect(
      f.service.operate(thread.id, operation, "execute", "bad", "other-turn"),
    ).rejects.toThrow();
    await expect(
      f.service.operate(
        thread.id,
        operation,
        "plan",
        "bad-plan",
        "desktop-turn",
      ),
    ).rejects.toThrow();
    await f.service.operate(
      thread.id,
      operation,
      "execute",
      "desktop-batch",
      "desktop-turn",
    );
    await Promise.all(f.members.map((m) => m.service.poll()));
    expect(f.members.map((m) => m.starts.length)).toEqual([1, 1]);
    for (const task of f.gateway.store.list<CollaborationTask>(
      "collaboration-tasks",
    )) {
      const member = f.members.find(
        (m) => m.deviceId === task.participantDeviceId,
      )!;
      f.gateway.router.receiveReply(member.deviceId, {
        version: 1,
        id: `final:${task.id}`,
        invocationId: task.invocationId,
        taskId: member.threads.find((t) => t.status === "running")!.id,
        text: `${member.name} findings`,
        final: true,
        visibility: "conversation",
      });
    }
    const completed = (await f.service.operate(
      thread.id,
      { action: "collaborate", command: { action: "status", text: "" } },
      "execute",
      "desktop-results",
      "desktop-turn",
    )) as CollaborationTask[];
    expect(completed.map((t) => t.state)).toEqual(["completed", "completed"]);
    expect(completed.map((t) => t.result).sort()).toEqual([
      "Bob findings",
      "Carol findings",
    ]);
    expect(
      f.gateway.store
        .pending<RemoteInvocationContext>("device")
        .filter((r) => r.recipient === f.service.status().settings.deviceId),
    ).toHaveLength(0);
    await f.service.operate(
      thread.id,
      {
        action: "collaborate",
        command: { action: "finish", text: "Combined findings" },
      },
      "execute",
      "desktop-summary",
      "desktop-turn",
    );
    expect(
      f.gateway.store
        .pending<{ text: string }>("outgoing")
        .filter((r) => r.payload.text.includes("Combined findings")),
    ).toHaveLength(3);
    expect(f.service.profile(thread.id)).toBeUndefined();
    await expect(
      f.service.operate(
        thread.id,
        { action: "read", path: "README.md" },
        "execute",
        "read",
        "desktop-turn",
      ),
    ).rejects.toThrow("local control");
  });
  it("queues different members through the real collaboration operation in one idempotent batch", async () => {
    const f = await groupFixture();
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service
        .status()
        .settings.grants.map((g) => ({ ...g, mode: "execute" })),
    });
    await f.send("让 Bob 检查接口，同时让 Carol 检查前端，完成后汇总。");
    const threadId = f.threads[0]!.id;
    const command = {
      action: "delegate-many" as const,
      text: "",
      assignments: f.members.map((m) => ({
        participantId: m.deviceId,
        text: m.name === "Bob" ? "检查接口" : "检查前端",
      })),
    };
    await expect(
      f.service.operate(
        threadId,
        { action: "collaborate", command },
        "plan",
        "denied-batch",
      ),
    ).rejects.toThrow("Plan");
    const first = await f.service.operate(
      threadId,
      { action: "collaborate", command },
      "execute",
      "batch",
    );
    expect(
      await f.service.operate(
        threadId,
        { action: "collaborate", command },
        "execute",
        "batch",
      ),
    ).toEqual(first);
    await Promise.all(f.members.map((m) => m.service.poll()));
    expect(f.members[0]!.starts).toHaveLength(1);
    expect(f.members[0]!.starts[0]).toContain("检查接口");
    expect(f.members[1]!.starts).toHaveLength(1);
    expect(f.members[1]!.starts[0]).toContain("检查前端");
  });
  it("starts two explicitly targeted member sessions without starting the sender, and exposes their current group roster", async () => {
    const f = await groupFixture();
    await f.send(
      `/ask ${f.members.map((m) => m.deviceId).join(",")} Inspect your project`,
    );
    expect(f.starts).toHaveLength(0);
    await Promise.all(f.members.map((m) => m.service.poll()));
    for (const member of f.members) {
      expect(member.starts).toHaveLength(1);
      expect(member.starts[0]).toContain("Inspect your project");
      expect(member.starts[0]).toContain("协作成员 feishu:alice");
      const group = member.service.status().remoteTasks[0]!.group!;
      expect(group).toMatchObject({
        name: "Cross IM team",
        executingDeviceId: member.deviceId,
        confirmed: true,
        stale: false,
      });
      expect(group.members.map((m) => m.name)).toEqual([
        "Alice",
        "Bob",
        "Carol",
      ]);
      expect(
        group.members.find((m) => m.deviceId === member.deviceId),
      ).toMatchObject({ deviceName: member.name, state: "online" });
    }
    const bob = f.members[0]!;
    const threadId = bob.threads.find((t) => t.status === "running")!.id;
    const envelope = (payload: AgentEvent["payload"]): AgentEvent => ({
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId,
      turnId: "turn",
      seq: 1,
      timestamp: new Date().toISOString(),
      payload,
    });
    bob.events.push(
      envelope({
        type: "message.part.delta",
        partType: "text",
        partId: "answer",
        delta: "BOB_RESULT",
      }),
    );
    bob.service.observe([
      envelope({
        type: "turn.completed",
        reason: "completed",
        finalPartId: "answer",
      }),
    ]);
    await bob.service.poll();
    const outputs = f.gateway.store.pending<{
      text: string;
      conversation: { id: string };
    }>("outgoing");
    expect(
      outputs
        .filter((o) => o.payload.text.includes("BOB_RESULT"))
        .map((o) => o.payload.conversation.id)
        .sort(),
    ).toEqual(f.space.endpoints.map((e) => e.id).sort());
    await bob.service.save({
      ...bob.service.status().settings,
      enabled: false,
    });
    expect(bob.service.status().remoteTasks[0]!.group!.stale).toBe(true);
  });
  it.each(["project", "space"])(
    "denies a targeted task before creating a thread when the target has no %s grant",
    async (scope) => {
      const f = await groupFixture(),
        bob = f.members[0]!;
      await bob.service.save({
        ...bob.service.status().settings,
        defaultProjectId: scope === "project" ? "" : "project",
        grants:
          scope === "project"
            ? []
            : [
                executionGrantSchema.parse({
                  projectId: "project",
                  expiresAt: Date.now() + 600000,
                }),
              ],
      });
      await f.send(`/ask ${bob.deviceId} Inspect`);
      await bob.service.poll();
      expect(bob.threads).toHaveLength(1); // The pre-existing idle group conversation remains.
      expect(bob.starts).toHaveLength(0);
      expect(f.starts).toHaveLength(0);
      expect(
        f.gateway.store
          .pending<{ text: string }>("outgoing")
          .some((o) => /authorized|授权/u.test(o.payload.text)),
      ).toBe(true);
    },
  );
  it("denies owner control commands and stops delivering after the requesting member is removed", async () => {
    const f = await groupFixture(),
      bob = f.members[0]!;
    await f.send(`/ask ${bob.deviceId} /approve secret yes`);
    await bob.service.poll();
    expect(bob.starts).toHaveLength(0);
    expect(f.approvals).toHaveLength(0);
    await f.send(`/ask ${bob.deviceId} Inspect`);
    f.gateway.store.put("spaces", f.space.id, {
      ...f.space,
      participants: f.space.participants.slice(1),
    });
    await bob.service.poll();
    expect(bob.starts).toHaveLength(0);
  });
  it("lets the desktop start locally after IM expires or is disabled without removing the conversation binding", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const id = f.threads[0]!.id;
    await f.service.save({ ...f.service.status().settings, enabled: false });
    const close = vi.spyOn(f.ops, "close");
    await f.service.prepareLocalTurn(id, "desktop-turn");
    expect(close).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.service.profile(id)).toBeUndefined();
    expect(f.service.status().remoteTasks).toContainEqual(
      expect.objectContaining({ threadId: id }),
    );
    expect(() =>
      f.service.authorizeOperation(
        id,
        { action: "read", path: "README.md" },
        "plan",
      ),
    ).toThrow(/local control/);
    f.threads[0]!.status = "running";
    const cancel = vi.spyOn(f.ops, "cancel");
    await f.service.save({ ...f.service.status().settings, enabled: false });
    expect(cancel).not.toHaveBeenCalled();
  });
  it("does not switch a live remote run to local execution", async () => {
    const f = await fixture();
    await f.send("/new active remote task");
    const id = f.threads[0]!.id;
    await expect(
      f.service.prepareLocalTurn(id, "desktop-turn"),
    ).rejects.toThrow(/active turn/);
    expect(f.service.profile(id)).toBeDefined();
  });
  it("keeps the remote boundary if closing the old Pi session fails", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const id = f.threads[0]!.id;
    vi.spyOn(f.ops, "close").mockRejectedValueOnce(new Error("close failed"));
    await expect(
      f.service.prepareLocalTurn(id, "desktop-turn"),
    ).rejects.toThrow("close failed");
    expect(f.service.profile(id)).toEqual({ network: false, shell: false });
  });
  it("persists local control across restart without requiring a live IM request", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const id = f.threads[0]!.id;
    await f.service.save({
      ...f.service.status().settings,
      defaultProjectId: "",
      grants: [],
    });
    await f.service.prepareLocalTurn(id, "desktop-turn");
    await f.service.close();
    const restored = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => restored.close());
    expect(restored.profile(id)).toBeUndefined();
    await expect(
      restored.prepareLocalTurn(id, "next-desktop-turn"),
    ).resolves.toBeUndefined();
    expect(() =>
      restored.authorizeOperation(
        id,
        { action: "read", path: "README.md" },
        "plan",
      ),
    ).toThrow(/local control/);
  });
  it("never forwards local approvals or late local results when IM resumes", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const threadId = f.threads[0]!.id;
    await f.service.prepareLocalTurn(threadId, "desktop-turn");
    const event: AgentEvent = {
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId,
      turnId: "desktop-turn",
      seq: 1,
      timestamp: new Date().toISOString(),
      payload: {
        type: "approval.requested",
        approvalId: "local-operation",
        nonce: randomUUID(),
        summary: "Local private operation",
        paths: ["private.txt"],
        network: [],
        risk: "medium",
        allowedScopes: ["once"],
      },
    };
    const deliveries = () =>
      f.gateway.store.pending<{ text: string }>("outgoing");
    const count = deliveries().length;
    f.service.observe([event]);
    await f.service.poll();
    expect(deliveries()).toHaveLength(count);
    await f.send("resume from IM");
    expect(f.service.profile(threadId)).toBeDefined();
    const resumedCount = deliveries().length;
    f.service.observe([{ ...event, eventId: randomUUID() }]);
    await f.service.poll();
    expect(deliveries()).toHaveLength(resumedCount);
    expect(f.approvals).toEqual([]);
  });
  it("waits for a local run before restoring a fresh remote profile, and never queues IM text into it", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const id = f.threads[0]!.id;
    await f.service.prepareLocalTurn(id, "desktop-turn");
    f.threads[0]!.status = "running";
    await f.send("continue from IM");
    expect(f.queued).toEqual([]);
    expect(f.starts).toHaveLength(1);
    expect(f.service.profile(id)).toBeUndefined();
    f.threads[0]!.status = "idle";
    const close = vi.spyOn(f.ops, "close");
    await f.service.poll();
    expect(close).toHaveBeenCalledExactlyOnceWith(id);
    expect(f.starts).toHaveLength(2);
    expect(f.starts[1]).toBe("continue from IM");
    expect(f.service.profile(id)).toEqual({ network: false, shell: false });
  });
  it("does not let an IM continuation change a local runtime while its start is pending", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const id = f.threads[0]!.id;
    const release = f.service.reserveStart(id, "execute", false);
    try {
      await f.service.prepareLocalTurn(id, "desktop-turn");
      await f.send(`/continue ${id}`);
      expect(f.service.profile(id)).toBeUndefined();
      expect(() => f.service.reserveStart(id, "execute")).toThrow(/starting/);
    } finally {
      release();
    }
  });
  it("refreshes pairing while paused without accepting or running tasks", async () => {
    const f = await fixture();
    await f.service.save({ ...f.service.status().settings, enabled: false });
    const identity = { ...f.identity, userId: "second-account" };
    const code = (await f.service.manage({ action: "pair" })) as {
      code: string;
    };
    f.gateway.store.pair(code.code, identity);
    await f.service.manage({ action: "refresh" });
    expect(f.service.status().identities).toContainEqual(identity);
    expect(f.service.status().settings.enabled).toBe(false);
    await f.send("/new queued while paused");
    expect(f.starts).toEqual([]);
  });
  it("starts one real task entry for a duplicate push, queues follow-ups, and stops the selected task", async () => {
    const f = await fixture();
    const create = f.ops.create;
    f.ops.create = async (...args) => {
      expect(
        f.service.profile(args[0]),
        "remote profile must precede eager Pi session creation",
      ).toEqual({ network: false, shell: false });
      return create(...args);
    };
    await f.send("/new analyze", "same");
    await f.send("/new analyze", "same");
    expect(f.threads).toHaveLength(1);
    expect(f.starts).toHaveLength(1);
    await f.send("extra detail");
    expect(f.queued).toEqual(["extra detail"]);
    await f.send("/stop");
    expect(f.threads[0]?.status).toBe("idle");
  });
  it("denies an unpaired sender and a revoked project before task creation", async () => {
    const f = await fixture();
    await f.send("/new steal", undefined, "bob");
    expect(f.starts).toHaveLength(0);
    await f.service.save({
      ...f.service.status().settings,
      defaultProjectId: "",
      grants: [],
    });
    await f.send("/new no grant");
    expect(f.threads).toHaveLength(0);
  });
  it.each(["wecom", "feishu", "slack"] as const)(
    "%s creates a new task after deletion without replaying the deleted task",
    async (channel) => {
      const f = await fixture(channel);
      f.ops.projects().push({ ...f.ops.projects()[0]!, id: "other-project" });
      await f.service.save({
        ...f.service.status().settings,
        defaultProjectId: "other-project",
        grants: [
          ...f.service.status().settings.grants,
          executionGrantSchema.parse({
            projectId: "other-project",
            expiresAt: Date.now() + 600000,
          }),
        ],
      });
      await f.send("/project project");
      await f.send("/new first task", "original");
      expect(() => f.service.deleteThread(f.threads[0]!.id)).toThrow(
        "Delete the task before removing its IM state",
      );
      expect(f.service.profile(f.threads[0]!.id)).toBeDefined();
      await f.send("/stop");
      const deletedId = f.threads.shift()!.id;
      f.service.deleteThread(deletedId);
      f.service.deleteThread(deletedId);
      expect(f.service.profile(deletedId)).toBeUndefined();
      expect(f.service.status().remoteTasks).toEqual([]);
      await f.send("/new first task", "original");
      expect(f.threads).toEqual([]);
      await f.send("replacement task", "replacement");
      await f.send("replacement task", "replacement");
      expect(f.threads).toHaveLength(1);
      expect(f.threads[0]).toMatchObject({
        projectId: "project",
        title: `${{ wecom: "企业微信", feishu: "飞书", slack: "Slack" }[channel]} · replacement task`,
      });
      expect(f.threads[0]!.id).not.toBe(deletedId);
      expect(f.starts).toHaveLength(2);
      expect(f.queued).toEqual([]);
    },
  );
  it("recovers a persisted selection left by an earlier deletion", async () => {
    const f = await fixture();
    await f.send("/new first task");
    await f.send("/stop");
    const deletedId = f.threads.shift()!.id;
    // Simulate deletion by the previous version, which did not notify ImService.
    expect(f.service.profile(deletedId)).toBeDefined();
    await f.send("replacement task");
    expect(f.threads).toHaveLength(1);
    expect(f.threads[0]!.id).not.toBe(deletedId);
    expect(f.service.profile(deletedId)).toBeUndefined();
    expect(f.starts).toHaveLength(2);
  });
  it("does not start or rebind a task deleted while its creation is in flight", async () => {
    const f = await fixture();
    const create = f.ops.create;
    f.ops.create = async (...args) => {
      const thread = await create(...args);
      f.threads.shift();
      f.service.deleteThread(thread.id);
      return thread;
    };
    await f.send("/new deleted during creation", "interrupted");
    expect(f.threads).toEqual([]);
    expect(f.starts).toEqual([]);
    expect(f.service.status().remoteTasks).toEqual([]);
    f.ops.create = create;
    await f.send("/new deleted during creation", "interrupted");
    expect(f.threads).toEqual([]);
    await f.send("replacement task");
    expect(f.threads).toHaveLength(1);
    expect(f.starts).toHaveLength(1);
  });
  it("does not redirect explicit deleted task references to a new task", async () => {
    const f = await fixture();
    await f.send("/new first task");
    const request =
      f.gateway.store.list<RemoteInvocationContext>("invocations")[0]!;
    await f.send("/stop");
    const deletedId = f.threads.shift()!.id;
    f.service.deleteThread(deletedId);
    for (const command of ["continue", "status", "stop"])
      await f.send(`/${command} ${deletedId}`);
    await f.service.accept({
      ...request,
      id: randomUUID(),
      taskId: deletedId,
      text: "reply to the deleted task",
    });
    expect(f.threads).toEqual([]);
    expect(f.starts).toHaveLength(1);
  });
  it.each(["archived", "revoked"])(
    "does not turn an %s selection into permission to create a different task",
    async (state) => {
      const f = await fixture();
      await f.send("/new first task");
      await f.send("/stop");
      if (state === "archived") f.threads[0]!.archived = true;
      else {
        f.threads.shift();
        await f.service.save({
          ...f.service.status().settings,
          defaultProjectId: "",
          grants: [],
        });
      }
      await f.send("follow-up");
      expect(f.starts).toHaveLength(1);
      expect(f.queued).toEqual([]);
    },
  );
  it("invalidates deleted task approvals and ignores late task events", async () => {
    const f = await fixture();
    await f.send("/new first task");
    const threadId = f.threads[0]!.id;
    const event: AgentEvent = {
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId,
      turnId: "turn",
      seq: 1,
      timestamp: new Date().toISOString(),
      payload: {
        type: "approval.requested",
        approvalId: "deleted-operation",
        nonce: randomUUID(),
        summary: "Write result.txt",
        paths: ["result.txt"],
        network: [],
        risk: "medium",
        allowedScopes: ["once"],
      },
    };
    f.service.observe([event]);
    await f.service.poll();
    const deliveries = () =>
      f.gateway.store.pending<{ text: string }>("outgoing");
    const approval = deliveries().find((r) =>
      r.payload.text.includes("/approve"),
    )!;
    const token = /\/approve ([\w-]+)/u.exec(approval.payload.text)![1]!;
    await f.send("/stop");
    f.threads.shift();
    f.service.deleteThread(threadId);
    const count = deliveries().length;
    f.service.observe([{ ...event, eventId: randomUUID() }]);
    await f.service.poll();
    expect(deliveries()).toHaveLength(count);
    await f.send(`/approve ${token} yes`);
    expect(f.approvals).toEqual([]);
    expect(deliveries().at(-1)!.payload.text).toContain("确认码无效");
  });
  it("sends only the final public answer without private reasoning", async () => {
    const f = await fixture();
    await f.send("/new analyze");
    const id = f.threads[0]!.id,
      turnId = "turn";
    const envelope = (payload: AgentEvent["payload"]): AgentEvent => ({
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId: id,
      turnId,
      seq: f.events.length + 1,
      timestamp: new Date().toISOString(),
      payload,
    });
    const thinking = envelope({
      type: "message.part.delta",
      partId: "secret",
      partType: "thinking",
      delta: "PRIVATE",
    });
    const text = envelope({
      type: "message.part.delta",
      partId: "answer",
      partType: "text",
      delta: "Public final",
    });
    f.events.push(thinking, text);
    f.service.observe([
      thinking,
      text,
      envelope({
        type: "turn.completed",
        reason: "completed",
        finalPartId: "answer",
      }),
    ]);
    await f.service.poll();
    const outbound = f.gateway.store
      .pending<{ text: string }>("outgoing")
      .map((x) => x.payload.text)
      .join("\n");
    expect(outbound).toContain("Public final");
    expect(outbound).not.toContain("PRIVATE");
  });
  it("binds approval commands to the owner, task and nonce, then invalidates duplicates", async () => {
    const f = await fixture();
    await f.send("/new analyze");
    const threadId = f.threads[0]!.id;
    const event: AgentEvent = {
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId,
      turnId: "turn",
      seq: 1,
      timestamp: new Date().toISOString(),
      payload: {
        type: "approval.requested",
        approvalId: "operation",
        nonce: randomUUID(),
        summary: "Write the selected project file",
        paths: ["result.txt"],
        network: [],
        risk: "medium",
        allowedScopes: ["once"],
      },
    };
    f.service.observe([event]);
    await f.service.poll();
    const delivery = f.gateway.store
      .pending<{ text: string }>("outgoing")
      .map((r) => r.payload.text)
      .find((text) => text.includes("/approve"))!;
    const code = /\/approve ([\w-]+)/u.exec(delivery)![1]!;
    await f.send(`/approve ${code} yes`, undefined, "bob");
    expect(f.approvals).toHaveLength(0);
    await f.send(`/approve ${code} yes`);
    await f.send(`/approve ${code} yes`);
    expect(f.approvals).toHaveLength(1);
    expect(f.approvals[0]).toMatchObject({
      approvalId: "operation",
      nonce:
        event.payload.type === "approval.requested" ? event.payload.nonce : "",
      approved: true,
      scope: "once",
    });
  });
  it("keeps a multi-question request waiting until every desktop or IM answer is resolved", async () => {
    const f = await fixture();
    await f.send("/new clarify");
    const threadId = f.threads[0]!.id,
      nonce = randomUUID();
    const envelope = (payload: AgentEvent["payload"]): AgentEvent => ({
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId,
      turnId: "turn",
      seq: 1,
      timestamp: new Date().toISOString(),
      payload,
    });
    f.service.observe([
      envelope({
        type: "approval.resolved",
        approvalId: "automatic-read",
        nonce,
        approved: true,
        scope: "once",
      }),
    ]);
    await f.service.poll();
    expect(
      f.gateway.store
        .pending<{ text: string }>("outgoing")
        .some((row) => row.payload.text.includes("确认已处理")),
    ).toBe(false);
    f.service.observe([
      envelope({
        type: "user-input.requested",
        kind: "multi-question",
        requestId: "questions",
        nonce,
        header: "选择",
        questions: ["a", "b"].map((questionId) => ({
          questionId,
          question: `Question ${questionId}`,
          options: [],
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        })),
      }),
    ]);
    await f.service.poll();
    const texts = () =>
      f.gateway.store
        .pending<{ text: string }>("outgoing")
        .map((row) => row.payload.text)
        .join("\n");
    const token = /\/answer ([\w-]+)/u.exec(texts())![1]!;
    f.service.observe([
      envelope({
        type: "user-input.resolved",
        kind: "multi-question",
        requestId: "questions",
        nonce,
        questionId: "a",
        customAnswer: "desktop answer",
        source: "user",
      }),
    ]);
    await f.service.poll();
    expect(texts()).not.toContain("确认已处理，正在继续任务");
    await f.send(`/answer ${token} a duplicate`);
    expect(f.answers).toHaveLength(0);
    await f.send(`/answer ${token} b IM answer`);
    expect(f.answers).toMatchObject([
      { questionId: "b", customAnswer: "IM answer" },
    ]);
    f.service.observe([
      envelope({
        type: "user-input.resolved",
        kind: "multi-question",
        requestId: "questions",
        nonce,
        questionId: "b",
        customAnswer: "IM answer",
        source: "user",
      }),
    ]);
    await f.service.poll();
    expect(texts()).toContain("确认已处理，正在继续任务");
    await f.send(`/answer ${token} b duplicate`);
    expect(f.answers).toHaveLength(1);
  });
  it("separates two device sessions across WeCom and Feishu and delivers a delegated result to its coordinator", async () => {
    const f = await fixture();
    const secondDir = join(f.root, "second");
    await mkdir(secondDir);
    const bobProject = {
      ...f.ops.projects()[0]!,
      path: join(secondDir, "project"),
    };
    await mkdir(bobProject.path);
    const bobIdentity = {
      channel: "feishu" as const,
      connectionId: "f",
      tenantId: "ft",
      appId: "fb",
      userId: "bob",
    };
    const bobThreads: Thread[] = [],
      bobStarts: string[] = [];
    const bobOps: ImTaskOperations = {
      ...f.ops,
      projects: () => [bobProject],
      threads: () => bobThreads,
      thread: (id) => bobThreads.find((t) => t.id === id),
      create: async (id, projectId, mode, title) => {
        const thread: Thread = {
          id,
          projectId,
          mode,
          title,
          target: "local",
          status: "idle",
          pinned: false,
          archived: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        bobThreads.push(thread);
        return thread;
      },
      start: async (id, text) => {
        bobStarts.push(text);
        bobThreads.find((t) => t.id === id)!.status = "running";
      },
      cancel: async (id) => {
        bobThreads.find((t) => t.id === id)!.status = "idle";
      },
    };
    const bob = new ImService(secondDir, f.secure, bobOps);
    cleanups.push(() => bob.close());
    await bob.manage({
      action: "register",
      gatewayUrl: `http://127.0.0.1:${f.port}`,
      name: "Bob device",
      adminToken: "a".repeat(32),
    });
    const code = (await bob.manage({ action: "pair" })) as { code: string };
    f.gateway.store.pair(code.code, bobIdentity);
    const aliceEndpoint = {
        connectionId: "w",
        id: "wg",
        kind: "group" as const,
      },
      bobEndpoint = { connectionId: "f", id: "fg", kind: "group" as const };
    const space = {
      id: "space",
      revision: "revision",
      name: "Team",
      endpoints: [aliceEndpoint, bobEndpoint],
      participants: [
        {
          deviceId: f.service.status().settings.deviceId,
          identity: f.identity,
          name: "Alice",
        },
        {
          deviceId: bob.status().settings.deviceId,
          identity: bobIdentity,
          name: "Bob",
        },
      ],
    };
    f.gateway.store.put("spaces", "space", space);
    f.gateway.store.put("space-confirmations", "space", [
      JSON.stringify(["w", "group", "wg"]),
      JSON.stringify(["f", "group", "fg"]),
    ]);
    await f.service.save({
      ...f.service.status().settings,
      grants: [
        executionGrantSchema.parse({
          projectId: "project",
          groups: ["space:space"],
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    await bob.save({
      ...bob.status().settings,
      enabled: true,
      defaultProjectId: "project",
      grants: [
        executionGrantSchema.parse({
          projectId: "project",
          groups: ["space:space"],
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    f.gateway.router.ingest({
      version: 1,
      messageId: "group-request",
      identity: f.identity,
      conversation: aliceEndpoint,
      text: "Compare two independent findings",
      timestamp: Date.now(),
      mentioned: true,
      bot: false,
      attachments: [],
    });
    await f.service.poll();
    expect(f.starts).toHaveLength(1);
    const rootRequest = f.gateway.store
      .list<{ id: string; deviceId: string; conversation: { kind: string } }>(
        "invocations",
      )
      .find((r) => r.conversation.kind === "group")!;
    const assignment = f.gateway.router.collaborate(
      rootRequest.deviceId,
      rootRequest.id,
      f.threads[0]!.id,
      {
        action: "delegate",
        participantId: bob.status().settings.deviceId,
        text: "Inspect the second dataset and return evidence",
      },
    ) as { id: string; invocationId: string };
    await bob.poll();
    expect(bobStarts).toHaveLength(1);
    const delegatedThread = bobThreads.find((t) => t.status === "running")!;
    expect(delegatedThread.id).not.toBe(f.threads[0]?.id);
    expect(bobProject.path).not.toBe(f.ops.projects()[0]?.path);
    expect(
      f.gateway.store.get<{ state: string }>(
        "collaboration-tasks",
        assignment.id,
      )?.state,
    ).toBe("working");
    const originalRoute = f.gateway.store.get(
      "thread-links",
      `${rootRequest.deviceId}:${f.threads[0]!.id}`,
    );
    await f.send("/status");
    expect(
      f.gateway.store.get(
        "thread-links",
        `${rootRequest.deviceId}:${f.threads[0]!.id}`,
      ),
    ).toEqual(originalRoute);
    f.gateway.router.collaborate(
      rootRequest.deviceId,
      rootRequest.id,
      f.threads[0]!.id,
      {
        action: "message",
        participantId: bob.status().settings.deviceId,
        taskId: assignment.id,
        text: "Check the edge cases too",
      },
    );
    await bob.poll();
    const peerMessage = f.gateway.store
      .list<{ id: string; collaboration?: { taskId: string } }>("invocations")
      .find((r) => r.id.startsWith("message:"))!;
    expect(peerMessage.collaboration?.taskId).toBe(assignment.id);
    expect(() =>
      f.gateway.router.collaborate(
        bob.status().settings.deviceId,
        peerMessage.id,
        delegatedThread.id,
        {
          action: "delegate",
          participantId: rootRequest.deviceId,
          text: "Nested delegation",
        },
      ),
    ).toThrow("initiating coordinator");
    f.gateway.router.receiveReply(bob.status().settings.deviceId, {
      version: 1,
      id: "bob-final",
      invocationId: assignment.invocationId,
      text: "Second dataset checked: 3 cases passed.",
      taskId: delegatedThread.id,
      final: true,
    });
    await f.service.poll();
    expect(f.queued.join("\n")).toContain("3 cases passed");
    expect(
      f.gateway.store.get<{ state: string }>(
        "collaboration-tasks",
        assignment.id,
      )?.state,
    ).toBe("completed");
    expect(() =>
      f.gateway.router.collaborate(
        bob.status().settings.deviceId,
        assignment.invocationId,
        delegatedThread.id,
        {
          action: "delegate",
          participantId: rootRequest.deviceId,
          text: "Expand permissions",
        },
      ),
    ).toThrow("initiating coordinator");
    delegatedThread.mode = "execute";
    const queuedAssignment = f.gateway.router.collaborate(
      rootRequest.deviceId,
      rootRequest.id,
      f.threads[0]!.id,
      {
        action: "delegate",
        participantId: bob.status().settings.deviceId,
        text: "Do not start this cancelled assignment",
      },
    ) as { id: string };
    await bob.poll();
    expect(bobStarts).toHaveLength(1);
    const cancelling = f.gateway.router.collaborate(
      rootRequest.deviceId,
      rootRequest.id,
      f.threads[0]!.id,
      { action: "cancel", taskId: queuedAssignment.id, text: "" },
    ) as { state: string };
    expect(cancelling.state).toBe("cancelling");
    await bob.poll();
    delegatedThread.status = "idle";
    await bob.poll();
    expect(bobStarts).toHaveLength(1);
    expect(
      f.gateway.store.get<{ state: string }>(
        "collaboration-tasks",
        queuedAssignment.id,
      )?.state,
    ).toBe("cancelled");
    const deletedId = delegatedThread.id;
    bobThreads.splice(
      bobThreads.findIndex((t) => t.id === deletedId),
      1,
    );
    bob.deleteThread(deletedId);
    const originalAssignment = f.gateway.store.get<RemoteInvocationContext>(
      "invocations",
      assignment.invocationId,
    )!;
    await bob.accept({
      ...originalAssignment,
      id: randomUUID(),
      text: "A late message must not recreate the deleted assignment",
    });
    expect(
      bobThreads.every((t) => t.id !== deletedId && t.status === "idle"),
    ).toBe(true);
    expect(bobStarts).toHaveLength(1);
  });
  it.runIf(process.platform === "darwin")(
    "publishes only an explicitly selected file using an expiring download capability",
    async () => {
      const f = await fixture();
      await writeFile(join(f.root, "project", "report.txt"), "shared evidence");
      await f.send("/new analyze");
      await f.send("/publish report.txt");
      const text = f.gateway.store
        .pending<{ text: string }>("outgoing")
        .map((d) => d.payload.text)
        .find((t) => t.includes("/artifacts/"))!;
      expect(
        text,
        JSON.stringify(f.gateway.store.pending("outgoing")),
      ).toBeTruthy();
      const url = /http:\/\/[^\s]+/u.exec(text)![0];
      expect(await (await fetch(url)).text()).toBe("shared evidence");
      const id = new URL(url).pathname.split("/")[2]!;
      const artifact = f.gateway.store.get<Record<string, unknown>>(
        "artifacts",
        id,
      )!;
      f.gateway.store.put("artifacts", id, { ...artifact, expiresAt: 0 });
      expect((await fetch(url)).status).toBe(404);
    },
  );
});
