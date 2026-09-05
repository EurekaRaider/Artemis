import { z } from "zod";

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
export interface ImStatus {
  settings: ImSettings;
  state: "disabled" | "connecting" | "connected" | "error";
  error?: string;
  identities: ImIdentity[];
  localGateway?: { state: "stopped" | "running" | "error"; error?: string };
}
export const remoteInvocationSchema = z
  .object({
    version: z.literal(IM_PROTOCOL_VERSION),
    id,
    deviceId: id,
    identity: imIdentitySchema,
    conversation: imConversationSchema,
    messageId: id,
    text,
    taskId: id.optional(),
    originator: imIdentitySchema.optional(),
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
    version: z.literal(IM_PROTOCOL_VERSION),
    id,
    invocationId: id,
    text,
    taskId: id.optional(),
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
  network: boolean;
  shell: boolean;
}
export const collaborationCommandSchema = z
  .object({
    action: z.enum([
      "participants",
      "delegate",
      "message",
      "status",
      "cancel",
      "finish",
    ]),
    participantId: id.optional(),
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
  z.object({ action: z.literal("pair") }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
  z
    .object({ action: z.literal("unpair"), identity: imIdentitySchema })
    .strict(),
  z
    .object({
      action: z.literal("admin"),
      operation: z.enum(["connections", "spaces", "status"]),
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
