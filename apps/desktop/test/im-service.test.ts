import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ArtemisGateway } from "../../../packages/gateway/src/server.js";
import { ImService, type ImTaskOperations } from "../src/main/im-service.js";
import * as imSandbox from "../src/main/im-sandbox.js";
import {
  executionGrantSchema,
  imConversationKey,
  IM_ADHOC_PROJECT_ID,
  type AgentEvent,
  type ChannelEvent,
  type CollaborationTask,
  type Project,
  type RemoteInvocationContext,
  type Thread,
  type ImOutboundCandidate,
} from "@artemis/protocol";

// Routing tests simulate only sandbox preflight; im-sandbox.test.ts exercises
// the real platform policy and native execution boundaries.
function mockSandboxPreflight() {
  vi.spyOn(imSandbox, "buildRemoteShellLaunch").mockImplementation(
    (workspace, command) => ({
      executable: "test-im-sandbox",
      args: [command],
      cwd: workspace,
      env: {},
    }),
  );
  return vi
    .spyOn(imSandbox, "runRemoteShell")
    .mockImplementation(async (launch) => {
      const command = launch.args[0];
      if (
        command === "printf ARTEMIS_REMOTE_SANDBOX_READY" ||
        command === "Write-Output 'ARTEMIS_REMOTE_SANDBOX_READY'"
      ) {
        return {
          output: "ARTEMIS_REMOTE_SANDBOX_READY",
          exitCode: 0,
          cancelled: false,
        };
      }
      if (
        command?.includes("private-probe.txt") &&
        /^(?:cat |Get-Content )/u.test(command)
      ) {
        return { output: "Permission denied", exitCode: 1, cancelled: false };
      }
      throw new Error(
        `Unexpected shell command in IM routing test: ${command}`,
      );
    });
}

function security(...audiences: string[]) {
  return {
    version: 2 as const,
    revision: "test",
    confirmedAt: Date.now(),
    scopes: audiences.map((audience) => ({
      audience,
      ...(audience.startsWith("space:") ? { spaceRevision: "revision" } : {}),
      filePaths: ["README.md", "result.txt", "report.txt", "artifact.txt"],
      readPaths: [
        "src",
        "README.md",
        "result.txt",
        "report.txt",
        "artifact.txt",
      ],
      writePaths: ["src", "result.txt", "report.txt"],
    })),
  };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const clean of cleanups.reverse()) await clean();
  cleanups.length = 0;
  vi.restoreAllMocks();
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
        security: security("owner"),
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
async function groupFixture(mode: "plan" | "execute" = "plan") {
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
          mode,
          security: security("owner", "space:shared"),
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
  it.runIf(process.platform === "darwin")(
    "rejects an Execute grant when sandbox preflight fails",
    async () => {
      const f = await fixture();
      const settings = f.service.status().settings;
      mockSandboxPreflight().mockResolvedValueOnce({
        output: "Sandbox unavailable",
        exitCode: 1,
        cancelled: false,
      });
      await expect(
        f.service.save({
          ...settings,
          grants: settings.grants.map((grant) => ({
            ...grant,
            mode: "execute",
            shell: true,
          })),
        }),
      ).rejects.toThrow("原生沙箱验证失败");
      expect(f.service.status().settings.grants).toEqual(settings.grants);
    },
  );
  it("does not recreate legacy group entries after refresh or restart", async () => {
    const f = await groupFixture();
    await f.service.manage({ action: "refresh" });
    await f.service.close();
    const restarted = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => restarted.close());
    await restarted.poll();
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("rejects the retired group-opening API even for confirmed members", async () => {
    const f = await groupFixture();
    await expect(
      f.service.manage({
        action: "open-group-conversation",
        spaceId: f.space.id,
        participantIds: [f.members[0]!.deviceId],
      }),
    ).rejects.toThrow(/退役/);
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("removing a legacy space cannot revive its tasks or conversations", async () => {
    const f = await groupFixture();
    await f.service.manage({
      action: "admin",
      operation: "remove-space",
      adminToken: "a".repeat(32),
      configuration: { id: f.space.id },
    });
    await f.send("Inspect");
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("repeated legacy delegation IDs never enqueue work", async () => {
    const f = await groupFixture();
    for (let i = 0; i < 2; i++)
      expect(() =>
        f.gateway.router.collaborate(
          f.service.status().settings.deviceId,
          "same",
          "thread",
          { action: "delegate", text: "Inspect" },
        ),
      ).toThrow(/退役/);
    expect(f.gateway.store.pending("device")).toHaveLength(0);
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
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
      grants: f.service.status().settings.grants.map((g) => ({
        ...g,
        groups: ["space:waiting"],
        security: security("owner", "space:waiting"),
      })),
    });
    await f.service.poll();
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    await f.send("Private task remains separate");
    expect(f.threads).toHaveLength(1);
  });
  it("a message in a confirmed legacy group does not create an execution", async () => {
    const f = await groupFixture();
    await f.send("Inspect this project");
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("legacy group rejection does not prevent paired direct messages", async () => {
    const f = await groupFixture();
    await f.send("Group work");
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
    await f.send("/new Private task", {
      conversation: {
        connectionId: "w",
        id: f.identity.userId,
        kind: "direct",
      },
    });
    expect(f.starts).toHaveLength(1);
  });
  it("legacy collaboration cannot acquire execution through a desktop turn", async () => {
    const f = await groupFixture();
    await expect(
      f.service.operate(
        "legacy-thread",
        { action: "read", path: "README.md" },
        "plan",
        "call",
      ),
    ).rejects.toThrow(/unavailable/);
    expect(() =>
      f.gateway.router.collaborate(
        f.service.status().settings.deviceId,
        "invocation",
        "legacy-thread",
        { action: "delegate", text: "Inspect" },
      ),
    ).toThrow(/退役/);
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("legacy same-device assignments require the native IM path", async () => {
    const f = await groupFixture();
    await f.send("/ask " + f.service.status().settings.deviceId + " Inspect");
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("legacy batch delegation never queues recipient tasks", async () => {
    const f = await groupFixture();
    expect(() =>
      f.gateway.router.collaborate(
        f.service.status().settings.deviceId,
        "invocation",
        "thread",
        {
          action: "delegate-many",
          assignments: f.members.map((m) => ({
            target: m.deviceId,
            text: "Inspect",
          })),
        },
      ),
    ).toThrow(/退役/);
    expect(f.gateway.store.pending("device")).toHaveLength(0);
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("legacy explicit targets cannot start sessions on other devices", async () => {
    const f = await groupFixture();
    for (const member of f.members)
      await f.send("/ask " + member.deviceId + " Inspect");
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
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
      expect(bob.threads).toHaveLength(0); // Retired groups cannot create conversations.
      expect(bob.starts).toHaveLength(0);
      expect(f.starts).toHaveLength(0);
      expect(
        f.gateway.store
          .pending<{ text: string }>("outgoing")
          .some((o) => /退役|已发现/u.test(o.payload.text)),
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
  it("keeps the restricted profile after disabling IM and across restart", async () => {
    const f = await fixture();
    await f.send("/new remote task");
    await f.send("/stop");
    const id = f.threads[0]!.id;
    await f.service.save({ ...f.service.status().settings, enabled: false });
    await expect(
      f.service.prepareLocalTurn(id, "desktop-turn"),
    ).rejects.toThrow();
    expect(f.service.profile(id)?.security?.version).toBe(2);
    await f.service.close();
    const restored = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => restored.close());
    expect(restored.profile(id)?.security?.version).toBe(2);
    await expect(restored.prepareLocalTurn(id, "next-turn")).rejects.toThrow();
  });
  it("keeps desktop turns within the same data scope and prevents switching active turns", async () => {
    const f = await fixture();
    await f.send("/new active remote task");
    const id = f.threads[0]!.id;
    await expect(
      f.service.prepareLocalTurn(id, "desktop-turn"),
    ).rejects.toThrow(/active turn/);
    await f.send("/stop");
    await f.service.prepareLocalTurn(id, "desktop-turn");
    expect(f.service.profile(id)?.security?.audience).toBe("owner");
    await expect(
      f.service.operate(
        id,
        { action: "read", path: "private.txt" },
        "plan",
        "read",
        "desktop-turn",
      ),
    ).rejects.toThrow(/授权范围/);
    const release = f.service.reserveStart(id, "plan", false);
    try {
      await f.send(`/continue ${id}`);
      expect(f.service.profile(id)).toBeDefined();
      expect(() => f.service.reserveStart(id, "plan")).toThrow(/starting/);
    } finally {
      release();
    }
  });
  it.each(["slack", "feishu"] as const)(
    "reports the bound %s connection and follows disconnect, recovery and disable",
    async (channel) => {
      const f = await fixture(channel);
      await f.send("/new project plan");
      const originalFetch = globalThis.fetch;
      let state = "connected";
      let missing = false;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
        if (String(args[0]).endsWith("/v1/device/status")) {
          const body = await (await originalFetch(...args)).json();
          return Response.json({
            ...body,
            connections: [
              {
                id: "other",
                channel,
                name: "Other workspace",
                state: "connected",
              },
              {
                id: "w",
                channel: "wecom",
                name: "Other platform",
                state: "connected",
              },
              ...(!missing
                ? [{ id: "w", channel, name: "Bound workspace", state }]
                : []),
            ],
          });
        }
        return originalFetch(...args);
      });
      for (const next of [
        "connected",
        "connecting",
        "error",
        "disabled",
        "connected",
      ]) {
        state = next;
        await f.service.poll();
        expect(f.service.status().remoteTasks[0]).toMatchObject({
          connectionState: next,
        });
        expect(
          f.service.status().remoteTasks[0]!.devicePresence,
        ).toBeUndefined();
      }
      missing = true;
      await f.service.poll();
      expect(f.service.status().remoteTasks[0]).toMatchObject({
        connectionState: "unknown",
      });
      missing = false;
      await f.service.poll();
      await f.service.save({ ...f.service.status().settings, enabled: false });
      expect(f.service.status().remoteTasks[0]).toMatchObject({
        connectionState: "disabled",
      });
    },
  );
  it("invalidates cached channel signals when the Gateway is unreachable and restores them after recovery", async () => {
    const f = await fixture();
    await f.send("/new project plan");
    const originalFetch = globalThis.fetch;
    let offline = false;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (...args) => {
        if (String(args[0]).endsWith("/v1/device/status")) {
          if (offline) throw new Error("Gateway unreachable");
          const response = await originalFetch(...args);
          const body = await response.json();
          return Response.json({
            ...body,
            connections: [
              { id: "w", channel: "wecom", name: "Test", state: "connected" },
            ],
          });
        }
        return originalFetch(...args);
      });
    try {
      await f.service.poll();
      expect(f.service.status().connections).toMatchObject([
        { state: "connected" },
      ]);
      expect(f.service.status().remoteTasks[0]).toMatchObject({
        connectionState: "connected",
      });
      offline = true;
      await f.service.poll();
      expect(f.service.status()).toMatchObject({
        state: "error",
        connections: [{ state: "error", error: "Gateway unreachable" }],
      });
      expect(f.service.status().remoteTasks[0]).toMatchObject({
        connectionState: "error",
      });
      offline = false;
      await f.service.poll();
      expect(f.service.status().connections).toMatchObject([
        { state: "connected" },
      ]);
      expect(f.service.status().remoteTasks[0]).toMatchObject({
        connectionState: "connected",
      });
    } finally {
      fetchSpy.mockRestore();
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
      ).toMatchObject({ network: false, shell: false });
      return create(...args);
    };
    await f.send("/new analyze", "same");
    await f.send("/new analyze", "same");
    expect(f.threads).toHaveLength(1);
    expect(f.starts).toHaveLength(1);
    await f.send("extra detail");
    expect(f.queued).toHaveLength(1);
    expect(f.queued[0]).toContain("extra detail");
    await f.send("/stop");
    expect(f.threads[0]?.status).toBe("idle");
  });
  it("denies an unpaired sender before task creation", async () => {
    const f = await fixture();
    await f.send("/new steal", undefined, "bob");
    expect(f.starts).toHaveLength(0);
    expect(f.threads).toHaveLength(0);
  });
  it("requires renewed consent when legacy empty read scopes acquire whole-project meaning", async () => {
    const f = await fixture();
    const settings = f.service.status().settings;
    await f.service.save({
      ...settings,
      grants: settings.grants.map((grant) => ({
        ...grant,
        security: {
          ...grant.security!,
          scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
        },
      })),
    });
    await f.service.close();
    const db = new DatabaseSync(join(f.root, "im.sqlite"));
    db.prepare(
      "DELETE FROM im_state WHERE namespace='migrations' AND id='whole-project-reads'",
    ).run();
    db.close();
    const upgraded = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => upgraded.close());
    expect(upgraded.status().settings.grants[0]!.security!.confirmedAt).toBe(0);
    const current = upgraded.status().settings;
    await upgraded.save({
      ...current,
      grants: current.grants.map((grant) => ({
        ...grant,
        security: { ...grant.security!, confirmedAt: Date.now() },
      })),
    });
    await upgraded.close();
    const reopened = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => reopened.close());
    expect(
      reopened.status().settings.grants[0]!.security!.confirmedAt,
    ).toBeGreaterThan(0);
  });
  it("starts zero-grant owner chats as plan-only ad-hoc tasks and keeps them scoped", async () => {
    const f = await fixture();
    await f.service.save({
      ...f.service.status().settings,
      defaultProjectId: "",
      grants: [],
    });
    await f.send("/new quick advice");
    expect(f.threads).toHaveLength(1);
    expect(f.threads[0]).toMatchObject({
      projectId: null,
      mode: "plan",
      title: "临时 · 企业微信 · quick advice",
    });
    const deliveries = () =>
      f.gateway.store.pending<{ text: string }>("outgoing");
    expect(deliveries().at(-1)!.payload.text).toContain(
      "已启动临时任务（仅咨询分析，不访问项目文件）",
    );
    // Follow-ups continue the same temporary conversation.
    await f.send("more context");
    expect(f.threads).toHaveLength(1);
    expect(f.queued).toHaveLength(1);
    expect(f.queued[0]).toContain("[IM ad-hoc plan task");
    // Execute never leaves the built-in ad-hoc grant.
    expect(() =>
      f.service.authorizeThread(f.threads[0]!.id, "execute"),
    ).toThrow("Remote Execute is not authorized for this project.");
    expect(f.service.profile(f.threads[0]!.id)).toMatchObject({
      network: false,
      shell: false,
    });
    // /tasks lists the ad-hoc task for its owner chat.
    await f.send("/tasks");
    expect(deliveries().at(-1)!.payload.text).toContain("临时 · 企业微信");
    // /projects explains the ad-hoc path instead of dead-ending.
    await f.send("/projects");
    expect(deliveries().at(-1)!.payload.text).toContain("临时任务");
  });
  it("defaults plain owner messages to the ad-hoc chat while groups still pick explicitly", async () => {
    const f = await fixture();
    f.ops.projects().push({ ...f.ops.projects()[0]!, id: "other-project" });
    await f.service.save({
      ...f.service.status().settings,
      defaultProjectId: "",
      grants: [
        ...f.service.status().settings.grants,
        executionGrantSchema.parse({
          projectId: "other-project",
          security: security("owner"),
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    // 初始未设置默认项目：普通消息落临时会话，不卡在引导。
    await f.send("/new ambiguous");
    expect(f.threads).toHaveLength(1);
    expect(f.threads[0]).toMatchObject({ projectId: null, mode: "plan" });
    // 群聊没有临时会话语义：未配置空间时走群引导，不会静默落临时任务。
    f.gateway.router.ingest({
      version: 1 as const,
      messageId: randomUUID(),
      identity: f.identity,
      conversation: {
        connectionId: "w",
        id: "group-1",
        kind: "group" as const,
        spaceId: "space-1",
      },
      text: "/new in group",
      timestamp: Date.now(),
      mentioned: true,
      bot: false,
      attachments: [],
    });
    await f.service.poll();
    expect(f.threads).toHaveLength(1);
    const deliveries = () =>
      f.gateway.store.pending<{ text: string }>("outgoing");
    expect(deliveries().at(-1)!.payload.text).toContain("已发现这个群");
  });
  it("keeps an explicit ad-hoc default and a real project default distinct", async () => {
    const f = await fixture();
    f.ops.projects().push({ ...f.ops.projects()[0]!, id: "other-project" });
    await f.service.save({
      ...f.service.status().settings,
      defaultProjectId: IM_ADHOC_PROJECT_ID,
      grants: [
        ...f.service.status().settings.grants,
        executionGrantSchema.parse({
          projectId: "other-project",
          security: security("owner"),
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    // 哨兵默认：即使多个项目已授权，普通消息仍进临时会话。
    await f.send("/new sentinel default");
    expect(f.threads).toHaveLength(1);
    expect(f.threads[0]).toMatchObject({ projectId: null, mode: "plan" });
    // /project 显式选择后，普通消息回到所选项目。
    await f.send("/project project");
    await f.send("project follow-up");
    expect(f.threads).toHaveLength(2);
    expect(f.threads[1]).toMatchObject({ projectId: "project" });
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
  async function pendingReply() {
    const f = await fixture();
    await f.send("/new analyze");
    const secret = "Authorization: Bearer " + "q".repeat(32);
    const envelope = (payload: AgentEvent["payload"]): AgentEvent => ({
      protocolVersion: 4,
      eventId: randomUUID(),
      threadId: f.threads[0]!.id,
      turnId: "sensitive-turn",
      seq: f.events.length + 1,
      timestamp: new Date().toISOString(),
      payload,
    });
    const answer = envelope({
      type: "message.part.delta",
      partId: "answer",
      partType: "text",
      delta: secret,
    });
    f.events.push(answer);
    f.service.observe([
      answer,
      envelope({
        type: "turn.completed",
        reason: "completed",
        finalPartId: "answer",
      }),
    ]);
    await f.service.poll();
    const items = (await f.service.manage({
      action: "outbound-list",
    })) as ImOutboundCandidate[];
    expect(items).toHaveLength(1);
    expect(JSON.stringify(f.gateway.store.pending("outgoing"))).not.toContain(
      secret,
    );
    return { ...f, item: items[0]!, secret };
  }
  it("holds a credential result locally and approves the exact candidate only once without rerunning", async () => {
    const f = await pendingReply();
    const preview = await f.service.manage({
      action: "outbound-preview",
      id: f.item.id,
    });
    expect(JSON.stringify(preview)).toContain(f.secret);
    await expect(
      f.service.manage({
        action: "outbound-resolve",
        id: f.item.id,
        contentHash: "changed",
        approve: true,
      }),
    ).rejects.toThrow();
    const approval = {
      action: "outbound-resolve" as const,
      id: f.item.id,
      contentHash: f.item.contentHash,
      approve: true,
      text: "Reviewed safe result",
    };
    await f.service.manage(approval);
    await f.service.poll();
    await f.service.poll();
    await expect(f.service.manage(approval)).rejects.toThrow();
    expect(
      f.gateway.store
        .pending<{ text: string }>("outgoing")
        .filter((x) => x.payload.text === "Reviewed safe result"),
    ).toHaveLength(1);
    expect(f.starts).toHaveLength(1);
    expect(JSON.stringify(f.gateway.store.pending("outgoing"))).not.toContain(
      f.secret,
    );
  });
  it("retries an approved frozen reply after restart without duplicate delivery", async () => {
    const f = await pendingReply();
    await f.service.manage({
      action: "outbound-resolve",
      id: f.item.id,
      contentHash: f.item.contentHash,
      approve: true,
      text: "ONCE_AFTER_RESTART",
    });
    const originalFetch = globalThis.fetch;
    let lost = false;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (...args) => {
        const response = await originalFetch(...args);
        if (!lost && String(args[0]).endsWith("/v1/device/reply")) {
          lost = true;
          throw new Error("Acknowledgement lost");
        }
        return response;
      });
    await f.service.poll();
    fetchSpy.mockRestore();
    await f.service.close();
    const restored = new ImService(f.root, f.secure, f.ops);
    cleanups.push(() => restored.close());
    await restored.poll();
    await restored.poll();
    expect(
      f.gateway.store
        .pending<{ text: string }>("outgoing")
        .filter((x) => x.payload.text === "ONCE_AFTER_RESTART"),
    ).toHaveLength(1);
    expect(f.starts).toHaveLength(1);
  });
  it("renewed legacy roster consent cannot restore retired routing", async () => {
    const f = await groupFixture();
    f.gateway.store.put("spaces", f.space.id, {
      ...f.space,
      revision: "changed",
    });
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service.status().settings.grants.map((g) => ({
        ...g,
        security: {
          ...g.security!,
          confirmedAt: Date.now(),
          scopes: g.security!.scopes.map((s) => ({
            ...s,
            spaceRevision: "changed",
          })),
        },
      })),
    });
    await f.send("Inspect");
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
  });
  it("invalidates pending deliveries when a scope changes and starts a fresh context", async () => {
    const f = await pendingReply();
    const oldId = f.threads[0]!.id;
    await f.service.save({
      ...f.service.status().settings,
      grants: f.service.status().settings.grants.map((g) => ({
        ...g,
        security: {
          ...g.security!,
          scopes: [
            { audience: "owner", readPaths: ["README.md"], writePaths: [] },
          ],
        },
      })),
    });
    await expect(
      f.service.manage({
        action: "outbound-resolve",
        id: f.item.id,
        contentHash: f.item.contentHash,
        approve: true,
      }),
    ).rejects.toThrow();
    await f.send("Fresh task after scope change");
    expect(f.threads.at(-1)!.id).not.toBe(oldId);
    expect(JSON.stringify(f.gateway.store.pending("outgoing"))).not.toContain(
      f.secret,
    );
  });
  it("preserves v2 grants while leaving a paused configuration for rollback", async () => {
    const f = await fixture();
    const database = new DatabaseSync(join(f.root, "im.sqlite"));
    try {
      const legacy = JSON.parse(
        String(
          database
            .prepare(
              "SELECT value FROM im_state WHERE namespace='settings' AND id='current'",
            )
            .get()!.value,
        ),
      );
      expect(legacy.enabled).toBe(false);
      expect(legacy.grants).toEqual([]);
      const modern = JSON.parse(
        String(
          database
            .prepare(
              "SELECT value FROM im_state WHERE namespace='settings-v2' AND id='current'",
            )
            .get()!.value,
        ),
      );
      expect(modern.grants[0].security.version).toBe(2);
      expect(modern.deviceId).toBe(legacy.deviceId);
    } finally {
      database.close();
    }
  });
  it("retains legacy settings but blocks new work until the one-time scope confirmation", async () => {
    const f = await fixture();
    await f.service.save({
      ...f.service.status().settings,
      grants: [
        executionGrantSchema.parse({
          projectId: "project",
          expiresAt: Date.now() + 600000,
        }),
      ],
    });
    await f.send("Do work despite missing confirmation");
    expect(f.starts).toHaveLength(0);
    expect(f.service.status().identities).toHaveLength(1);
    expect(JSON.stringify(f.gateway.store.pending("outgoing"))).toContain(
      "确认",
    );
  });
  it("hands off a private task into an independent restricted task without its history", async () => {
    const f = await fixture();
    const original = await f.ops.create(
      "private-task",
      "project",
      "execute",
      "Private work",
    );
    await f.send(`/continue ${original.id}`);
    const shared = f.threads.at(-1)!;
    expect(shared.id).not.toBe(original.id);
    expect(f.service.profile(original.id)).toBeUndefined();
    expect(f.service.profile(shared.id)?.security?.audience).toBe("owner");
    expect(f.starts).toHaveLength(0);
    await f.service.manage({
      action: "handoff",
      threadId: shared.id,
      text: "Owner selected summary",
    });
    expect(f.starts).toHaveLength(1);
    expect(f.starts[0]).toContain("Owner selected summary");
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
  it("independent IM devices cannot delegate through a shared gateway", async () => {
    const f = await groupFixture();
    expect(
      new Set([f.identity.channel, ...f.members.map((m) => m.identity.channel)])
        .size,
    ).toBeGreaterThan(1);
    for (const member of f.members)
      expect(() =>
        f.gateway.router.collaborate(
          f.service.status().settings.deviceId,
          "invocation",
          "thread",
          { action: "delegate", target: member.deviceId, text: "Inspect" },
        ),
      ).toThrow(/退役/);
    expect(f.threads).toHaveLength(0);
    expect(f.starts).toHaveLength(0);
    for (const member of f.members) {
      await member.service.poll();
      expect(member.starts).toHaveLength(0);
      expect(member.threads).toHaveLength(0);
    }
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
