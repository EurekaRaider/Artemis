import { createDecipheriv, createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { sameSecret } from "../../store.js";
import { string, parseObject, record } from "../channel-values.js";
import type { ChannelConnection } from "../channel-connection.js";
export function verifyFeishu(
  connection: Extract<ChannelConnection, { channel: "feishu" }>,
  raw: string,
  headers: IncomingHttpHeaders,
  now = Date.now(),
): Record<string, any> {
  if (
    connection.transport === "websocket" ||
    !connection.encryptKey ||
    !connection.verificationToken
  )
    throw new Error("Feishu HTTPS callback transport is not configured.");
  const timestamp = string(headers["x-lark-request-timestamp"]),
    nonce = string(headers["x-lark-request-nonce"]),
    signature = string(headers["x-lark-signature"]);
  let data = parseObject(raw);
  if (typeof data.encrypt === "string") {
    const encrypted = Buffer.from(data.encrypt, "base64");
    const key = createHash("sha256").update(connection.encryptKey).digest();
    const decipher = createDecipheriv(
      "aes-256-cbc",
      key,
      encrypted.subarray(0, 16),
    );
    data = parseObject(
      Buffer.concat([
        decipher.update(encrypted.subarray(16)),
        decipher.final(),
      ]).toString("utf8"),
    );
  }
  const token = string(data.token) || string(record(data.header).token);
  if (!sameSecret(token, connection.verificationToken))
    throw new Error("Invalid Feishu verification token.");
  // URL verification has no user action; authenticated event delivery additionally requires its raw-body signature.
  if (data.type === "url_verification" && string(data.challenge)) return data;
  if (
    !/^\d+$/u.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !nonce ||
    !signature
  )
    throw new Error("Missing or expired Feishu signature.");
  const expected = createHash("sha256")
    .update(timestamp + nonce + connection.encryptKey + raw)
    .digest("hex");
  if (!sameSecret(expected, signature.toLowerCase()))
    throw new Error("Invalid Feishu signature.");
  if (
    record(data.header).app_id !== connection.appId ||
    record(data.header).tenant_key !== connection.tenantId
  )
    throw new Error("Feishu app or tenant does not match this connection.");
  return data;
}
