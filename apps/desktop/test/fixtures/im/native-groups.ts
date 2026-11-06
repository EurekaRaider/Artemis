import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect, vi } from "vitest";
import {
  imAuthorizationFingerprint,
  imAuthorizationImpactVersion,
  type ImAuthorizationCommand,
  executionGrantSchema,
  IM_SECURITY_VERSION,
  type Thread,
  type ChannelEvent,
  type ImOutboundCandidate,
  type AgentEvent,
  type CollaborationSpace,
} from "@artemis/protocol";
import type { ArtemisGateway } from "@artemis/gateway";

import {
  ImService,
  type ImTaskOperations,
} from "../../../src/main/im/im-service.js";
export const cleanup: Array<() => Promise<void>> = [];
export async function fixture(channel: "wecom" | "feishu" | "slack" = "slack") {
  const root = await mkdtemp(join(tmpdir(), "artemis-native-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "project");
  await mkdir(path);
  const threads: Thread[] = [],
    starts: string[] = [];
  const ops: ImTaskOperations = {
    projects: () => [
      {
        id: "p",
        name: "Project",
        path,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    threads: () => threads,
    thread: (id) => threads.find((t) => t.id === id),
    ready: () => true,
    events: () => [],
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
    start: async (id) => {
      starts.push(id);
    },
    queue: async () => {},
    close: async () => {},
    cancel: async () => {},
    approve: async () => {},
    answer: () => {},
  };
  const service = new ImService(
    root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    ops,
  );
  cleanup.push(() => service.close());
  await service.manage({ action: "setup-local" });
  await service.save({ ...service.status().settings, enabled: true });
  // Inject authenticated adapter events into the actual local gateway; no provider credentials or network mocks.
  const gateway = (
    service as unknown as { localGateway: { gateway: ArtemisGateway } }
  ).localGateway.gateway;
  const identity = {
    channel,
    connectionId: "bot",
    tenantId: "tenant",
    appId: "app",
    userId: "owner",
  };
  const pair = (await service.manage({ action: "pair" })) as { code: string };
  gateway.store.pair(pair.code, identity);
  await service.manage({ action: "refresh" });
  const conversation = {
    connectionId: "bot",
    id: "room",
    kind: "group" as const,
  };
  const event: ChannelEvent = {
    version: 1,
    messageId: randomUUID(),
    identity,
    conversation,
    text: "first work",
    timestamp: Date.now(),
    mentioned: true,
    bot: false,
    attachments: [],
  };
  gateway.router.ingest(event);
  gateway.router.processIncoming();
  const grant = executionGrantSchema.parse({
    projectId: "p",
    expiresAt: Date.now() + 3600000,
    security: {
      version: IM_SECURITY_VERSION,
      revision: "draft",
      confirmedAt: Date.now(),
      scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
    },
  });
  const authorize = () =>
    service.manage({
      action: "authorize-native-group",
      conversation,
      owner: identity,
      name: "Test room",
      grant,
      confirmed: true,
    });
  return {
    service,
    gateway,
    threads,
    starts,
    authorize,
    event,
    grant,
    ops,
    root,
  };
}
export async function delegatedFixture(channel: "slack" | "feishu" = "slack") {
  const f = await fixture(channel);
  f.grant.mode = "work";
  await f.authorize();
  const groupId = f.service.status().remoteTasks![0]!.group!.spaceId;
  const group = f.gateway.store.get<
    import("@artemis/protocol").CollaborationSpace
  >("native-groups", groupId)!;
  f.gateway.store.put("native-groups", groupId, {
    ...group,
    nativeGroup: { ...group.nativeGroup, capability: "events" },
  });
  await f.service.manage({ action: "refresh" });
  const request = f.gateway.router.groupConversationContext(
    f.service.status().settings.deviceId,
    groupId,
  );
  await f.service.accept({
    ...request,
    text: "Ask Solar to analyze the project",
  });
  const threadId = f.starts.at(-1)!;
  const thread = f.threads.find((t) => t.id === threadId)!;
  thread.status = "running";
  const task = {
    version: 1,
    id: "delegate-a",
    groupId,
    workflow: "workflow",
    direction: "outgoing",
    threadId,
    invocationId: request.id,
    peer: "solar",
    state: "running",
    text: "Analyze",
    dependencies: [],
    sequence: 1,
    updatedAt: Date.now(),
    envelope: { id: "attempt-a" },
  };
  f.gateway.store.put(
    "native-tasks",
    JSON.stringify([task.groupId, task.id]),
    task,
  );
  return { ...f, groupId, request, threadId, thread, task };
}
export async function automaticallyDelegatedFixture(
  batch = false,
  originTurnId?: string,
  platform: "slack" | "feishu" | "lark" = "slack",
) {
  const f = await delegatedFixture(platform === "slack" ? "slack" : "feishu");
  const group = f.gateway.store.get<
    import("@artemis/protocol").CollaborationSpace
  >("native-groups", f.groupId)!;
  f.gateway.store.put("native-groups", f.groupId, {
    ...group,
    nativeGroup: { ...group.nativeGroup, allowedBots: ["solar"] },
  });
  f.gateway.store.put("native-peers", f.groupId, [
    { id: "solar", name: "Solar", verifiedAt: Date.now() },
  ]);
  f.gateway.store.put("connections", "bot", {
    sealed: f.gateway.store.seal({
      id: "bot",
      channel: f.event.identity.channel,
      domain: platform === "lark" ? "lark" : "feishu",
      tenantId: "tenant",
      appId: "app",
      botUserId: "jupiter",
      botOpenId: "jupiter",
      enabled: true,
    }),
  });
  const command = batch
    ? {
        action: "delegate-many" as const,
        newTask: true,
        text: "",
        assignments: [
          { participantId: "solar", text: "Check disk" },
          { participantId: "solar", text: "Check RAM" },
        ],
      }
    : {
        action: "delegate" as const,
        newTask: true,
        participantId: "solar",
        text: "Check disk",
      };
  const callId = randomUUID();
  const result = (await f.service.operate(
    f.threadId,
    { action: "collaborate", command },
    "work",
    callId,
    originTurnId,
  )) as Array<typeof f.task>;
  const waits = () =>
    f.service.status().remoteTasks!.find((t) => t.threadId === f.threadId)!
      .delegationWaits!;
  return { ...f, command, callId, result, waits };
}
export async function pendingReply() {
  const f = await fixture();
  const events: AgentEvent[] = [];
  f.ops.events = () => events;
  await f.authorize();
  const send = async (text: string) => {
    f.gateway.router.ingest({
      ...f.event,
      text,
      messageId: randomUUID(),
      timestamp: Date.now(),
    });
    await f.service.poll();
  };
  await send("/new analyze");
  const threadId = f.starts[0]!;
  const secret = "Authorization: Bearer " + "q".repeat(32);
  const envelope = (payload: AgentEvent["payload"]): AgentEvent => ({
    protocolVersion: 4,
    eventId: randomUUID(),
    threadId,
    turnId: "sensitive-turn",
    seq: events.length + 1,
    timestamp: new Date().toISOString(),
    payload,
  });
  const answer = envelope({
    type: "message.part.delta",
    partId: "answer",
    partType: "text",
    delta: secret,
  });
  events.push(answer);
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
  return { ...f, events, send, threadId, item: items[0]!, secret };
}
export function authorizationCommand(
  f: Awaited<ReturnType<typeof fixture>>,
): ImAuthorizationCommand {
  const settings = f.service.status().settings;
  const command = {
    version: 1 as const,
    operationId: randomUUID(),
    intent: "create" as const,
    deviceId: settings.deviceId,
    gatewayUrl: settings.gatewayUrl,
    conversation: f.event.conversation,
    owner: f.event.identity,
    name: "Synthetic room",
    projectId: "p",
    expectedPolicyVersion: null,
    expectedGroupVersion: null,
    expectedScopeVersion: null,
    expectedDeviceEnabled: settings.enabled,
    expectedImpactVersion: imAuthorizationImpactVersion(
      settings,
      "p",
      true,
      true,
    ),
    policy: {
      mode: "plan" as const,
      approval: "ask" as const,
      shell: false,
      network: false,
      expiresAt: f.grant.expiresAt,
    },
    scope: {
      audience: "owner",
      readMode: "project" as const,
      readPaths: [],
      writePaths: [],
      confirmedAt: Date.now(),
    },
    enableService: true,
  };
  return {
    ...command,
    confirmationFingerprint: imAuthorizationFingerprint(command),
  };
}
export const cleanupNativeGroupFixtures = async () => {
  vi.restoreAllMocks();
  for (const fn of cleanup.splice(0).reverse()) await fn();
};
