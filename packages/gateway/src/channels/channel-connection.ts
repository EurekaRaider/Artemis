import { z } from "zod";

export const base = {
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(100),
  tenantId: z.string().min(1).max(256),
  enabled: z.boolean(),
};

export const channelConnectionSchema = z
  .discriminatedUnion("channel", [
    z
      .object({
        ...base,
        channel: z.literal("wecom"),
        botId: z.string().min(1),
        secret: z.string().min(1),
      })
      .strict(),
    z
      .object({
        ...base,
        channel: z.literal("feishu"),
        /* Scan-minted apps cannot query their tenant; a websocket subscription
           is authenticated by the app credentials and adopts the tenant key
           from its first event, so only that transport may start empty. */
        tenantId: z.string().max(256),
        appId: z.string().min(1),
        botOpenId: z.string().min(1),
        appSecret: z.string().min(1),
        transport: z.enum(["webhook", "websocket"]).optional(),
        domain: z.enum(["feishu", "lark"]).optional(),
        verificationToken: z.string().min(1).optional(),
        encryptKey: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        ...base,
        channel: z.literal("slack"),
        appId: z.string().min(1),
        botUserId: z.string().min(1),
        botToken: z.string().startsWith("xoxb-").max(1024),
        appToken: z.string().startsWith("xapp-").max(1024),
      })
      .strict(),
  ])
  .superRefine((connection, context) => {
    if (
      connection.channel === "feishu" &&
      connection.transport !== "websocket"
    ) {
      for (const key of ["verificationToken", "encryptKey"] as const) {
        if (!connection[key])
          context.addIssue({
            code: "custom",
            path: [key],
            message: "Required for Feishu HTTPS callbacks.",
          });
      }
    }
    if (!connection.tenantId) {
      const websocket =
        connection.channel === "feishu" && connection.transport === "websocket";
      if (!websocket)
        context.addIssue({
          code: "custom",
          path: ["tenantId"],
          message: "Required unless the Feishu websocket transport adopts it.",
        });
    }
  });

export type ChannelConnection = z.infer<typeof channelConnectionSchema>;
