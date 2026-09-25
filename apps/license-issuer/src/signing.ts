import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  decodeLicense,
  type SignedLicense,
} from "../../desktop/src/license/codec.js";

export function newVault(password: string): string {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new Error("口令至少需要 12 个字符。请离线备份，遗失无法恢复。");
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey
    .export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: password,
    })
    .toString();
}
export function unlockVault(pem: string, password: string): KeyObject {
  if (
    !pem.startsWith("-----BEGIN ENCRYPTED PRIVATE KEY-----") ||
    pem.length > 16384
  )
    throw new Error("请选择加密私钥文件。");
  const key = createPrivateKey({ key: pem, passphrase: password });
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("需要 Ed25519 签发密钥。");
  return key;
}
export function publicConfiguration(key: KeyObject): Record<string, string> {
  const publicKey = createPublicKey(
    key.export({ type: "pkcs8", format: "pem" }),
  )
    .export({ type: "spki", format: "pem" })
    .toString();
  return {
    [createHash("sha256").update(publicKey).digest("hex").slice(0, 16)]:
      publicKey,
  };
}
export function issue(
  key: KeyObject,
  input: {
    device: string;
    expiresAt: number;
    recovery?: { challenge: string };
  },
  now = Date.now(),
): string {
  const keys = publicConfiguration(key);
  const payload: SignedLicense = {
    version: 1,
    product: "artemis",
    kind: input.recovery ? "recovery" : "license",
    id: randomUUID(),
    keyId: Object.keys(keys)[0]!,
    device: input.device,
    issuedAt: now,
    notBefore: now,
    expiresAt: input.expiresAt,
    ...(input.recovery
      ? { challenge: input.recovery.challenge, baseline: now }
      : {}),
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const result = `ART1.${data}.${sign(null, Buffer.from(`ART1.${data}`), key).toString("base64url")}`;
  decodeLicense(result, keys, input.device);
  return result;
}
