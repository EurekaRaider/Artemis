import { createPublicKey, verify } from "node:crypto";
import { valid, prerelease } from "semver";
import { z } from "zod";

export const updateIndexPayloadSchema = z.strictObject({
  version: z
    .string()
    .refine((value) => Boolean(valid(value)) && !prerelease(value)),
  platform: z.literal("win32"),
  arch: z.literal("x64"),
  distribution: z.literal("nsis"),
  sequence: z.number().int().positive(),
  minUpdaterVersion: z.literal(1),
  assets: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[A-Za-z0-9._-]+$/u),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        size: z
          .number()
          .int()
          .positive()
          .max(2 * 1024 ** 3),
      }),
    )
    .min(1)
    .max(8),
});
export type UpdateIndexPayload = z.infer<typeof updateIndexPayloadSchema>;
export function canonicalUpdatePayload(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalUpdatePayload).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalUpdatePayload((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
export function verifyUpdateIndex(
  bytes: Uint8Array,
  keys: Record<string, string>,
  minimumSequence = 0,
): UpdateIndexPayload {
  if (bytes.byteLength > 64 * 1024)
    throw new Error("Update index exceeds 64 KiB");
  const envelope = z
    .strictObject({
      schemaVersion: z.literal(1),
      keyId: z.string(),
      signature: z.string(),
      payload: updateIndexPayloadSchema,
    })
    .parse(JSON.parse(Buffer.from(bytes).toString("utf8")));
  const pem = keys[envelope.keyId];
  if (!pem) throw new Error("Unknown update signing key");
  const key = createPublicKey(pem);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(canonicalUpdatePayload(envelope.payload)),
      key,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    throw new Error("Invalid update signature");
  if (envelope.payload.sequence < minimumSequence)
    throw new Error("Update index replay refused");
  const names = new Set(envelope.payload.assets.map((asset) => asset.name));
  if (
    names.size !== envelope.payload.assets.length ||
    !names.has(`Artemis-Windows-x64-${envelope.payload.version}.exe`)
  )
    throw new Error("Update installer is missing or ambiguous");
  return envelope.payload;
}
