import { z } from "zod";
import { collaborationDependencySchema } from "@artemis/protocol";

export const NATIVE_PREFIX = "ARTEMIS-IM/1:";
const identity = z.string().min(1).max(256);
export const nativeEnvelopeSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    platform: z.enum(["slack", "feishu", "lark", "wecom"]),
    tenant: identity,
    group: identity,
    sender: identity,
    recipient: identity,
    workflow: z.string().uuid(),
    task: z.string().uuid(),
    action: z.enum([
      "note",
      "hello",
      "probe",
      "proof",
      "delegate",
      "continue",
      "accepted",
      "rejected",
      "progress",
      "heartbeat",
      "completed",
      "failed",
      "cancel",
      "cancelled",
    ]),
    replyTo: z.string().uuid().optional(),
    previousTask: z.string().uuid().optional(),
    parentTask: z.string().uuid().optional(),
    dependency: collaborationDependencySchema.optional(),
    ancestors: z
      .array(
        z
          .object({
            task: z.string().uuid(),
            sender: identity,
            objective: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .strict(),
      )
      .min(1)
      .max(16)
      .optional(),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    sequence: z.number().int().min(0),
    text: z.string().max(8000),
  })
  .strict()
  .refine(
    (frame) => {
      const linked = !!frame.parentTask;
      return (
        linked === !!frame.dependency &&
        linked === !!frame.ancestors &&
        (!linked ||
          (["delegate", "continue"].includes(frame.action) &&
            frame.ancestors!.at(-1)!.task === frame.parentTask))
      );
    },
    {
      message: "Dependency assignments require a parent and bounded ancestry.",
    },
  )
  .refine((frame) => (frame.action === "continue") === !!frame.previousTask, {
    message: "Only continuation frames must identify a previous task.",
  });
export type NativeEnvelope = z.infer<typeof nativeEnvelopeSchema>;
export function encodeNativeEnvelope(input: NativeEnvelope): string {
  const encoded =
    NATIVE_PREFIX +
    Buffer.from(JSON.stringify(nativeEnvelopeSchema.parse(input))).toString(
      "base64",
    );
  if (encoded.length > 24000)
    throw new Error("Collaboration message exceeds the IM protocol limit.");
  return encoded;
}
export function decodeNativeEnvelope(text: string): NativeEnvelope | undefined {
  const match = /^ARTEMIS-IM\/1:([A-Za-z0-9+/=]+)$/u.exec(text.trim());
  if (!match || text.length > 24000) return undefined;
  try {
    const result = nativeEnvelopeSchema.safeParse(
      JSON.parse(Buffer.from(match[1]!, "base64").toString("utf8")),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
