import { createHash, createPublicKey, verify } from "node:crypto";

export type TrustKeys = Record<string, string>;
export interface SignedLicense {
  version: 1;
  product: "artemis";
  kind: "license" | "recovery";
  keyId: string;
  id: string;
  device: string;
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
  challenge?: string;
  baseline?: number;
}

export function deviceCode(platform: string, identity: string): string {
  const normalized = identity.trim().toLowerCase();
  if (
    !normalized
      .split(":")
      .every(
        (part) => /^[a-f0-9-]{32,36}$/.test(part) && !/^[0f-]+$/.test(part),
      )
  ) {
    throw new Error("device_unavailable");
  }
  return `AM1-${createHash("sha256").update(`artemis-device-v1\0${platform}\0${normalized}`).digest("hex").toUpperCase()}`;
}

export function decodeLicense(
  input: unknown,
  keys: TrustKeys,
  device: string,
): SignedLicense {
  if (typeof input !== "string" || input.length > 16384)
    throw new Error("invalid_license");
  const parts = input.trim().split(".");
  if (
    parts.length !== 3 ||
    parts[0] !== "ART1" ||
    !parts.slice(1).every((p) => /^[A-Za-z0-9_-]+$/.test(p))
  )
    throw new Error("invalid_license");
  try {
    const value = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as SignedLicense;
    if (
      !value ||
      value.version !== 1 ||
      value.product !== "artemis" ||
      !["license", "recovery"].includes(value.kind) ||
      typeof value.keyId !== "string" ||
      !Object.hasOwn(keys, value.keyId) ||
      typeof value.id !== "string" ||
      value.id.length < 1 ||
      value.id.length > 128 ||
      ![value.issuedAt, value.notBefore, value.expiresAt].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      value.notBefore < value.issuedAt ||
      value.expiresAt <= value.notBefore ||
      !/^AM1-[A-F0-9]{64}$/.test(value.device)
    )
      throw new Error("invalid_license");
    const key = createPublicKey(keys[value.keyId]!);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(`ART1.${parts[1]}`),
        key,
        Buffer.from(parts[2]!, "base64url"),
      )
    )
      throw new Error("invalid_license");
    if (value.device !== device) throw new Error("device_mismatch");
    if (
      value.kind === "recovery" &&
      (typeof value.challenge !== "string" ||
        !/^[a-f0-9]{64}$/.test(value.challenge) ||
        !Number.isSafeInteger(value.baseline) ||
        value.baseline! < value.issuedAt ||
        value.baseline! >= value.expiresAt)
    )
      throw new Error("invalid_license");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === "device_mismatch")
      throw error;
    throw new Error("invalid_license");
  }
}
