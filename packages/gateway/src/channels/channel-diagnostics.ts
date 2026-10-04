import { channelEventSchema, type ChannelEvent } from "@artemis/protocol";

/** Never log provider payloads, schema input values, URLs, or credentials. */
export function reportChannelDrop(
  channel: "feishu" | "wecom" | "slack",
  messageType: unknown,
  reason:
    "invalid-content" | "empty-message" | "missing-resource" | "invalid-event",
  issues: { code: string; path: PropertyKey[] }[] = [],
): void {
  const knownTypes = [
    "text",
    "post",
    "image",
    "file",
    "mixed",
    "event",
    "message",
    "app_mention",
  ];
  console.warn(
    JSON.stringify({
      event: "channel-message-rejected",
      channel,
      messageType:
        typeof messageType === "string" && knownTypes.includes(messageType)
          ? messageType
          : "unknown",
      reason,
      ...(issues.length
        ? {
            issues: issues.map(({ code, path }) => ({
              code,
              path: path.join("."),
            })),
          }
        : {}),
    }),
  );
}

export function validateChannelEvent(
  channel: "feishu" | "wecom" | "slack",
  messageType: unknown,
  input: unknown,
): ChannelEvent | undefined {
  const result = channelEventSchema.safeParse(input);
  if (result.success) return result.data;
  reportChannelDrop(channel, messageType, "invalid-event", result.error.issues);
  return undefined;
}
