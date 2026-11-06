import {
  reportChannelDrop,
  validateChannelEvent,
} from "../channel-diagnostics.js";
import { feishuNativeLink, localizeFeishuNative } from "./feishu-native.js";
import type { ChannelEvent } from "@artemis/protocol";
import { record, string } from "../channel-values.js";
import type { ChannelConnection } from "../channel-connection.js";
export function normalizeFeishu(
  connection: Extract<ChannelConnection, { channel: "feishu" }>,
  value: unknown,
): ChannelEvent | undefined {
  const data = record(value),
    header = record(data.header),
    event = record(data.event),
    message = record(event.message),
    sender = record(event.sender);
  if (header.event_type !== "im.message.receive_v1") return undefined;
  let content: Record<string, any>;
  try {
    content = record(JSON.parse(string(message.content)));
  } catch {
    reportChannelDrop("feishu", message.message_type, "invalid-content");
    return undefined;
  }
  let text = string(content.text),
    messageId = string(message.message_id),
    userId = string(record(sender.sender_id).open_id),
    chatId = string(message.chat_id);
  const mentionItems = Array.isArray(message.mentions)
    ? message.mentions.map(record)
    : [];
  const mentions = mentionItems
    .flatMap((item) => {
      const userId = string(record(item.id).open_id);
      const name = string(item.name).trim().slice(0, 200);
      return userId && name ? [{ userId, name }] : [];
    })
    .slice(0, 100);
  let mentioned =
    Array.isArray(message.mentions) &&
    message.mentions.some(
      (item: any) => item.id?.open_id === connection.botOpenId,
    );
  const bot = sender.sender_type === "bot" || sender.sender_type === "app";
  let firstMention: string | undefined;
  const renderMention = (userId: string, name: string): string => {
    const first = firstMention === undefined;
    firstMention ??= userId;
    // Only the addressed mention is routing syntax; later names are task content.
    return userId === connection.botOpenId && (bot || first)
      ? ""
      : `@${name || userId}`;
  };
  const replacements = new Map(
    mentionItems.flatMap((item) => {
      const key = string(item.key);
      const userId = string(record(item.id).open_id);
      return key && userId
        ? [[key, { userId, name: string(item.name).trim() }] as const]
        : [];
    }),
  );
  // Longest keys first, with one pass so display names stay literal.
  const pattern = [...replacements.keys()]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const replaceMentions = (value: string): string =>
    pattern
      ? value.replace(new RegExp(pattern, "g"), (key) => {
          const item = replacements.get(key)!;
          return renderMention(item.userId, item.name);
        })
      : value;
  // Card actions use the issued-card identity and single-use receiver, never arbitrary commands.
  const attachments: ChannelEvent["attachments"] = [];
  const nativeLinks: string[] = [];
  if (message.message_type === "post") {
    // The event normally carries the selected locale directly. Older clients
    // wrap it in a locale key; select one rendition, never duplicate every locale.
    const post = Array.isArray(content.content)
      ? content
      : (Object.values(content)
          .map(record)
          .find((item) => Array.isArray(item.content)) ?? {});
    const lines = [replaceMentions(string(post.title))];
    for (const row of Array.isArray(post.content) ? post.content : []) {
      if (!Array.isArray(row)) continue;
      lines.push(
        row
          .map((value) => {
            const node = record(value);
            if (
              node.tag === "img" &&
              string(node.image_key) &&
              !attachments.some((item) => item.resourceId === node.image_key)
            )
              attachments.push({
                kind: "image",
                name: `image-${attachments.length + 1}.png`,
                resourceId: node.image_key,
              });
            if (node.tag === "at") {
              const key = string(node.user_id);
              const reference = replacements.get(key);
              const userId = reference?.userId ?? key;
              return renderMention(
                userId,
                reference?.name ||
                  string(node.user_name) ||
                  mentions.find((item) => item.userId === userId)?.name ||
                  "",
              );
            }
            if (node.tag === "a") {
              const native = feishuNativeLink(
                string(node.href),
                chatId,
                connection.domain ?? "feishu",
              );
              if (native) nativeLinks.push(native);
              return [replaceMentions(string(node.text)), string(node.href)]
                .filter(Boolean)
                .join(" ");
            }
            return node.tag === "text" || node.tag === "md"
              ? replaceMentions(string(node.text))
              : "";
          })
          .join(""),
      );
    }
    text = lines.filter(Boolean).join("\n");
  }
  if (message.message_type !== "post") text = replaceMentions(text);
  if (!bot && message.chat_type !== "p2p")
    mentioned = firstMention === connection.botOpenId;
  if (
    (sender.sender_type === "bot" || sender.sender_type === "app") &&
    nativeLinks.length === 1
  )
    text = nativeLinks[0]!;
  if (sender.sender_type === "bot" || sender.sender_type === "app") {
    const native = localizeFeishuNative(
      text.trim(),
      userId,
      mentioned,
      connection,
    );
    if (native) text = native;
    else if (text.trim().startsWith("ARTEMIS-IM/1:")) return undefined;
  }
  if (message.message_type === "image" && string(content.image_key))
    attachments.push({
      kind: "image",
      name: "image.png",
      resourceId: content.image_key,
    });
  if (message.message_type === "file" && string(content.file_key))
    attachments.push({
      kind: "file",
      name: string(content.file_name) || "attachment",
      resourceId: content.file_key,
    });
  if (!text.trim() && !attachments.length) {
    reportChannelDrop("feishu", message.message_type, "empty-message");
    return undefined;
  }
  return validateChannelEvent("feishu", message.message_type, {
    version: 1,
    messageId,
    identity: {
      channel: "feishu",
      connectionId: connection.id,
      tenantId: connection.tenantId,
      appId: connection.appId,
      userId,
    },
    conversation: {
      connectionId: connection.id,
      id: chatId,
      kind: message.chat_type === "p2p" ? "direct" : "group",
    },
    text: text.trim(),
    timestamp: Number(message.create_time) || Date.now(),
    mentioned,
    ...(mentions.length ? { mentions } : {}),
    bot: sender.sender_type === "bot" || sender.sender_type === "app",
    ...(string(message.parent_id) ? { replyTo: message.parent_id } : {}),
    attachments,
  });
}
