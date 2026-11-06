import {
  reportChannelDrop,
  validateChannelEvent,
} from "../channel-diagnostics.js";
import type { ChannelEvent } from "@artemis/protocol";
import { record, string } from "../channel-values.js";
import type { ChannelConnection } from "../channel-connection.js";
/** Some WeCom file callbacks omit a filename. Recover supported document types before desktop parsing. */
export function wecomAttachmentName(
  name: string,
  data: Buffer,
  disposition: string | null,
): string {
  if (name !== "attachment") return name;
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition ?? "")?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      /* Fall through to a plain filename or document signature. */
    }
  }
  const plain = /filename="([^"]+)"/iu.exec(disposition ?? "")?.[1];
  if (plain) return plain;
  if (data.subarray(0, 5).toString() === "%PDF-") return "attachment.pdf";
  if (data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4]))) {
    for (const [entry, extension] of [
      ["word/document.xml", "docx"],
      ["xl/workbook.xml", "xlsx"],
      ["ppt/presentation.xml", "pptx"],
    ])
      if (data.includes(Buffer.from(entry!))) return `attachment.${extension}`;
  }
  return name; // The desktop still validates UTF-8 text or rejects unsupported binary data.
}

export function normalizeWecom(
  connection: Extract<ChannelConnection, { channel: "wecom" }>,
  value: unknown,
): ChannelEvent | undefined {
  const raw = record(value),
    body = record(raw.body),
    from = record(body.from);
  if (raw.cmd !== "aibot_msg_callback" && raw.cmd !== "aibot_event_callback")
    return undefined;
  if (body.aibotid !== connection.botId || !string(from.userid))
    return undefined;
  let text = string(record(body.text).content);
  const attachments: ChannelEvent["attachments"] = [];
  const add = (kind: "image" | "file", input: unknown) => {
    const item = record(input);
    if (string(item.url))
      attachments.push({
        kind,
        name:
          string(item.filename) ||
          (kind === "image" ? "image.png" : "attachment"),
        resourceId: string(body.msgid),
        url: string(item.url),
        ...(string(item.aeskey) ? { decryptionKey: string(item.aeskey) } : {}),
      });
    else reportChannelDrop("wecom", body.msgtype, "missing-resource");
  };
  if (body.msgtype === "image") add("image", body.image);
  if (body.msgtype === "file") add("file", body.file);
  if (body.msgtype === "mixed")
    for (const item of Array.isArray(record(body.mixed).msg_item)
      ? body.mixed.msg_item
      : []) {
      const entry = record(item);
      if (entry.msgtype === "text")
        text += `\n${string(record(entry.text).content)}`;
      if (entry.msgtype === "image") add("image", entry.image);
    }
  if (body.msgtype === "event") {
    const event = record(body.event);
    if (event.eventtype !== "template_card_event") return undefined;
    text = string(event.event_key);
  }
  if (!text.trim() && !attachments.length) {
    reportChannelDrop("wecom", body.msgtype, "empty-message");
    return undefined;
  }
  return validateChannelEvent("wecom", body.msgtype, {
    version: 1,
    messageId: string(body.msgid),
    identity: {
      channel: "wecom",
      connectionId: connection.id,
      tenantId: connection.tenantId,
      appId: connection.botId,
      userId: from.userid,
    },
    conversation: {
      connectionId: connection.id,
      id: body.chattype === "group" ? string(body.chatid) : from.userid,
      kind: body.chattype === "group" ? "group" : "direct",
    },
    text: text
      .trim()
      .replace(/^@\S+\s*/u, "")
      .trim(),
    timestamp:
      Number(body.create_time) > 0
        ? Number(body.create_time) * 1000
        : Date.now(),
    mentioned: true,
    bot: false,
    attachments,
  });
}
