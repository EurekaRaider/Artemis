import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect } from "vitest";
import { ArtemisGateway } from "../../../packages/gateway/src/server.js";
import { ImService, type ImTaskOperations } from "../src/main/im-service.js";
import {
  executionGrantSchema,
  type AgentEvent,
  type ChannelEvent,
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
describe("IM desktop and Gateway loop", () => {
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
    expect(bobThreads[0]?.id).not.toBe(f.threads[0]?.id);
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
        bobThreads[0]!.id,
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
      taskId: bobThreads[0]!.id,
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
        bobThreads[0]!.id,
        {
          action: "delegate",
          participantId: rootRequest.deviceId,
          text: "Expand permissions",
        },
      ),
    ).toThrow("initiating coordinator");
    bobThreads[0]!.mode = "execute";
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
    bobThreads[0]!.status = "idle";
    await bob.poll();
    expect(bobStarts).toHaveLength(1);
    expect(
      f.gateway.store.get<{ state: string }>(
        "collaboration-tasks",
        queuedAssignment.id,
      )?.state,
    ).toBe("cancelled");
    const deletedId = bobThreads.shift()!.id;
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
    expect(bobThreads).toEqual([]);
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
