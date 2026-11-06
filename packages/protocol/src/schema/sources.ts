import { z } from "zod";
import { promptAttachmentReferenceSchema } from "./attachments.js";

export const mcpToolUsedPayloadSchema = z.object({
  type: z.literal("mcp.tool.used"),
  toolCallId: z.string().min(1).max(200),
  serverId: z.string().min(1).max(200),
  serverName: z.string().min(1).max(200),
  toolName: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
});

export type McpToolUsedPayload = z.infer<typeof mcpToolUsedPayloadSchema>;

export const taskSourceHttpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  }, "Task source URL must use HTTP(S) without embedded credentials");

export const taskAttachmentSourceAddedPayloadSchema = z.object({
  type: z.literal("task.source.added"),
  sourceId: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  kind: z.enum(["file", "image"]),
  attachment: promptAttachmentReferenceSchema.optional(),
});

export const taskWebSearchSourceAddedPayloadSchema = z.object({
  type: z.literal("task.source.added"),
  sourceId: z.string().min(1).max(200),
  kind: z.literal("web-search"),
  query: z.string().trim().min(1).max(500),
  engine: z.string().trim().min(1).max(120),
  resultCount: z.number().int().min(0).max(10),
  searchUrl: taskSourceHttpUrlSchema,
  links: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        url: taskSourceHttpUrlSchema,
      }),
    )
    .max(10),
});

export const taskSourceAddedPayloadSchema = z.discriminatedUnion("kind", [
  taskAttachmentSourceAddedPayloadSchema,
  taskWebSearchSourceAddedPayloadSchema,
]);

export type TaskSourceAddedPayload = z.infer<
  typeof taskSourceAddedPayloadSchema
>;
