import { z } from "zod";
import {
  imGrantSecuritySchema,
  imDeliverySecuritySchema,
  type ImSecurityContext,
  type ImDataScope,
} from "./im-security.js";

export const IM_PROTOCOL_VERSION = 1 as const;
const id = z.string().min(1).max(256);
const text = z.string().max(64 * 1024);
export const imChannelSchema = z.enum(["wecom", "feishu", "slack"]);
export const imIdentitySchema = z
  .object({
    channel: imChannelSchema,
    connectionId: id,
    tenantId: id,
    appId: id,
    userId: id,
  })
  .strict();
export type ImIdentity = z.infer<typeof imIdentitySchema>;
export function imIdentityKey(identity: ImIdentity): string {
  return JSON.stringify([
    identity.channel,
    identity.connectionId,
    identity.tenantId,
    identity.appId,
    identity.userId,
  ]);
}
export const imConversationSchema = z
  .object({
    connectionId: id,
    id,
    kind: z.enum(["direct", "group"]),
    spaceId: id.optional(),
    spaceRevision: id.optional(),
  })
  .strict();
export type ImConversation = z.infer<typeof imConversationSchema>;
export const imPairingRequestSchema = z
  .object({
    id: z.string().uuid(),
    identity: imIdentitySchema,
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ImPairingRequest = z.infer<typeof imPairingRequestSchema>;

export interface ImConnectionStatus {
  callbackUrl?: string;
  id: string;
  name: string;
  channel: ImIdentity["channel"];
  state: "disabled" | "connecting" | "connected" | "error";
  error?: string;
  // Only public identifiers, never saved secrets.
  configuration?: Partial<
    Record<
      | "id"
      | "name"
      | "tenantId"
      | "botId"
      | "appId"
      | "botOpenId"
      | "transport"
      | "domain",
      string
    >
  >;
}
export function imConversationKey(conversation: ImConversation): string {
  return JSON.stringify([
    conversation.connectionId,
    conversation.kind,
    conversation.id,
  ]);
}
export const channelEventSchema = z
  .object({
    version: z.literal(IM_PROTOCOL_VERSION),
    messageId: id,
    identity: imIdentitySchema,
    conversation: imConversationSchema,
    text,
    timestamp: z.number().int().nonnegative(),
    mentioned: z.boolean(),
    bot: z.boolean(),
    replyTo: id.optional(),
    attachments: z
      .array(
        z
          .object({
            name: z.string().min(1).max(256),
            kind: z.enum(["image", "file"]),
            resourceId: id,
            url: z.string().url().optional(),
            decryptionKey: z.string().max(256).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();
export type ChannelEvent = z.infer<typeof channelEventSchema>;

export const executionGrantSchema = z
  .object({
    projectId: id,
    tokenBudget: z.number().int().min(1024).max(1000000).default(100000),
    approval: z.enum(["ask", "automatic"]).default("ask"),
    mode: z.enum(["plan", "review", "execute"]).default("plan"),
    network: z.boolean().default(false),
    shell: z.boolean().default(false),
    groups: z.array(z.string().min(1).max(1024)).max(100).default([]),
    expiresAt: z.number().int().positive(),
    security: imGrantSecuritySchema.optional(),
  })
  .strict();
export type ExecutionGrant = z.infer<typeof executionGrantSchema>;
export const imSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    gatewayUrl: z.string().max(2048).default(""),
    deviceId: z.string().max(256).default(""),
    deviceName: z.string().min(1).max(100).default("Artemis"),
    defaultProjectId: z.string().max(256).default(""),
    grants: z.array(executionGrantSchema).max(100).default([]),
  })
  .strict();
export type ImSettings = z.infer<typeof imSettingsSchema>;
export interface ImDevicePresence {
  mobile: boolean;
  desktop: boolean;
}
export const imGroupContextSchema = z.object({
  spaceId: id,
  name: z.string(),
  confirmed: z.boolean(),
  executingDeviceId: id,
  stale: z.boolean(),
  targetDeviceIds: z.array(id).max(100).optional(),
  members: z.array(
    z.object({
      deviceId: id,
      identity: imIdentitySchema,
      name: z.string(),
      deviceName: z.string().default(""),
      state: z
        .enum(["online", "offline", "unavailable", "unknown"])
        .default("unknown"),
    }),
  ),
});
export type ImGroupContext = z.infer<typeof imGroupContextSchema>;

// The picker and host resolve the same visible tokens against the current roster.
export function imGroupMentionTargets(group: ImGroupContext) {
  const members = [
    ...new Map(group.members.map((m) => [m.deviceId, m])).values(),
  ];
  const label = (value: string) => value.replace(/\s+/gu, " ").trim();
  return members
    .filter(
      (m) =>
        !group.targetDeviceIds || group.targetDeviceIds.includes(m.deviceId),
    )
    .map((member) => {
      const name =
        label(member.name) || label(member.deviceName) || member.deviceId;
      const sameName = members.filter(
        (m) => label(m.name) === label(member.name),
      );
      let suffix = "";
      if (sameName.length > 1) {
        const computer = label(member.deviceName);
        suffix =
          computer &&
          sameName.filter((m) => label(m.deviceName) === computer).length === 1
            ? computer
            : `${computer || "Artemis"} · ${member.deviceId}`;
      }
      return { ...member, token: `@${name}${suffix ? `（${suffix}）` : ""}` };
    });
}

export function resolveImGroupMentions(group: ImGroupContext, text: string) {
  const members = imGroupMentionTargets(group).sort(
    (a, b) => b.token.length - a.token.length,
  );
  const found = new Map<string, (typeof members)[number]>();
  for (const match of text.matchAll(/(^|[\s，。；：、(（])@/gu)) {
    const start = match.index + match[1]!.length;
    const member = members.find(
      (m) =>
        text.startsWith(m.token, start) &&
        /^(?:$|[\s,.!?;:，。！？；：、)）])/u.test(
          text.slice(start + m.token.length),
        ),
    );
    if (!member)
      throw new Error("无法识别 @成员，请从对话输入框的成员列表中选择。");
    found.set(member.deviceId, member);
  }
  return [...found.values()];
}
export interface ImStatus {
  scopedShellSupported?: boolean;
  scopedFileCreationSupported?: boolean;
  settings: ImSettings;
  state: "disabled" | "connecting" | "connected" | "error";
  error?: string;
  groupConversationError?: string;
  identities: ImIdentity[];
  pairingRequests?: ImPairingRequest[];
  remoteTasks?: Array<{
    threadId: string;
    channel: string;
    kind: string;
    devicePresence?: ImDevicePresence;
    group?: ImGroupContext;
  }>;
  localGateway?: { state: "stopped" | "running" | "error"; error?: string };
}
export const remoteInvocationSchema = z
  .object({
    sourceKind: z.enum(["direct", "tool-result", "member"]).optional(),
    version: z.literal(IM_PROTOCOL_VERSION),
    id,
    deviceId: id,
    identity: imIdentitySchema,
    conversation: imConversationSchema,
    messageId: id,
    text,
    taskId: id.optional(),
    originator: imIdentitySchema.optional(),
    desktopTurnId: id.optional(),
    control: z.literal("cancel").optional(),
    expiresAt: z.number().int().positive(),
    attachments: channelEventSchema.shape.attachments,
    collaboration: z
      .object({
        taskId: id,
        coordinatorDeviceId: id,
        coordinatorThreadId: id,
        mission: text,
      })
      .strict()
      .optional(),
  })
  .strict();
export type RemoteInvocationContext = z.infer<typeof remoteInvocationSchema>;
export const imReplySchema = z
  .object({
    deliveryState: z.enum(["pending", "delivered"]).optional(),
    security: imDeliverySecuritySchema.optional(),
    version: z.literal(IM_PROTOCOL_VERSION),
    id,
    invocationId: id,
    text,
    taskId: id.optional(),
    approval: z
      .object({
        token: z.string().uuid(),
        expiresAt: z.number().int().positive(),
        resolved: z.enum(["approved", "denied"]).optional(),
      })
      .strict()
      .optional(),
    visibility: z.enum(["conversation", "owner"]).default("conversation"),
    final: z.boolean().default(false),
    started: z.boolean().optional(),
    outcome: z.enum(["completed", "failed", "cancelled"]).optional(),
    status: z
      .enum([
        "queued",
        "running",
        "waiting",
        "completed",
        "failed",
        "cancelled",
      ])
      .optional(),
  })
  .strict();
export type ImReply = z.infer<typeof imReplySchema>;
export interface RemoteExecutionProfile {
  dataScope?: ImDataScope;
  network: boolean;
  shell: boolean;
  security?: ImSecurityContext;
}
export const collaborationCommandSchema = z
  .object({
    action: z.enum([
      "participants",
      "delegate",
      "delegate-many",
      "message",
      "status",
      "cancel",
      "finish",
    ]),
    participantId: id.optional(),
    assignments: z
      .array(z.object({ participantId: id, text: text.min(1) }).strict())
      .min(1)
      .max(16)
      .optional(),
    taskId: id.optional(),
    text: text.default(""),
  })
  .strict();
export type CollaborationCommand = z.infer<typeof collaborationCommandSchema>;
export interface CollaborationSpace {
  id: string;
  revision?: string;
  name: string;
  endpoints: ImConversation[];
  participants: Array<{ deviceId: string; identity: ImIdentity; name: string }>;
}
export interface CollaborationTask {
  deliveryState?: "pending" | "delivered";
  id: string;
  spaceId: string;
  coordinatorDeviceId: string;
  coordinatorThreadId: string;
  participantDeviceId: string;
  invocationId: string;
  state:
    "queued" | "working" | "cancelling" | "completed" | "failed" | "cancelled";
  mission: string;
  result: string;
  expiresAt: number;
}

export function assertImGatewayUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "Gateway must be an origin without credentials, query or path.",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
    )
  ) {
    throw new Error(
      "Gateway requires HTTPS (HTTP is allowed only on loopback).",
    );
  }
  return url;
}

export function requireImGrant(
  settings: ImSettings,
  request: RemoteInvocationContext,
  projectId: string,
  now = Date.now(),
): ExecutionGrant {
  if (
    !settings.enabled ||
    settings.deviceId !== request.deviceId ||
    request.expiresAt <= now
  )
    throw new Error(
      "Remote request is disabled, expired or addressed to another device.",
    );
  const grant = settings.grants.find(
    (item) => item.projectId === projectId && item.expiresAt > now,
  );
  if (!grant)
    throw new Error("The owner has not authorized this project for IM access.");
  if (
    request.conversation.kind === "group" &&
    !grant.groups.includes(imConversationKey(request.conversation)) &&
    !(
      request.conversation.spaceId &&
      grant.groups.includes(`space:${request.conversation.spaceId}`)
    )
  ) {
    throw new Error(
      "The owner has not authorized this group or collaboration space.",
    );
  }
  return grant;
}

export const remoteOperationSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("read"), path: z.string().min(1).max(4096) })
    .strict(),
  z
    .object({
      action: z.literal("write"),
      path: z.string().min(1).max(4096),
      content: z.string().max(1_000_000),
    })
    .strict(),
  z
    .object({
      action: z.literal("shell"),
      command: z.string().min(1).max(64_000),
      timeoutSeconds: z.number().int().min(1).max(300),
    })
    .strict(),
  z
    .object({
      action: z.literal("collaborate"),
      command: collaborationCommandSchema,
    })
    .strict(),
]);
export type RemoteOperation = z.infer<typeof remoteOperationSchema>;
export const imManagementSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("scope-entries"),
      projectId: id,
      path: z.string().max(4096).default(""),
    })
    .strict(),
  z.object({ action: z.literal("outbound-list") }).strict(),
  z.object({ action: z.literal("outbound-preview"), id }).strict(),
  z
    .object({
      action: z.literal("outbound-resolve"),
      id,
      contentHash: id,
      approve: z.boolean(),
      text: z.string().max(64000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("handoff"),
      threadId: id,
      text: z.string().max(64000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove-conversation-member"),
      threadId: id,
      deviceId: id,
    })
    .strict(),
  z
    .object({
      action: z.literal("rename-group-member"),
      deviceId: id,
      name: z.string().trim().min(1).max(100),
      deviceName: z.string().trim().min(1).max(100),
    })
    .strict(),
  z
    .object({
      action: z.literal("open-group-conversation"),
      spaceId: id,
      participantIds: z.array(id).min(1).max(16),
      projectId: id.optional(),
    })
    .strict(),
  z.object({ action: z.literal("preview-legacy") }).strict(),
  z
    .object({
      action: z.literal("import-legacy"),
      importId: z.string().uuid(),
      tenantId: id,
      botOpenId: id,
      legacyStopped: z.literal(true),
      adminToken: z.string().min(32).max(1024).optional(),
    })
    .strict(),
  z.object({ action: z.literal("setup-local") }).strict(),
  z.object({ action: z.literal("export-gateway") }).strict(),
  z
    .object({
      action: z.literal("register"),
      gatewayUrl: z.string().min(1).max(2048),
      name: z.string().min(1).max(100),
      adminToken: z.string().min(32).max(1024),
    })
    .strict(),
  z
    .object({
      action: z.literal("pair"),
      requireConfirmation: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("resolve-pairing"),
      requestId: z.string().uuid(),
      approve: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("refresh") }).strict(),
  z
    .object({ action: z.literal("unpair"), identity: imIdentitySchema })
    .strict(),
  z
    .object({
      action: z.literal("admin"),
      operation: z.enum([
        "connections",
        "remove-connection",
        "remove-space",
        "remove-space-member",
        "spaces",
        "status",
      ]),
      adminToken: z.string().min(32).max(1024).optional(),
      configuration: z.unknown().optional(),
    })
    .strict(),
]);
export type ImManagement = z.infer<typeof imManagementSchema>;

export interface CollaborationArtifact {
  id: string;
  invocationId: string;
  name: string;
  mimeType: string;
  sha256: string;
  size: number;
  expiresAt: number;
}
