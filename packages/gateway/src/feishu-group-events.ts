import type { ChannelConnection } from "./channels.js";

export const feishuGroupEvents = [
  "im.chat.member.user.added_v1",
  "im.chat.member.user.deleted_v1",
  "im.chat.member.user.withdrawn_v1",
  "im.chat.member.bot.added_v1",
  "im.chat.member.bot.deleted_v1",
  "im.chat.disbanded_v1",
] as const;

export function normalizeFeishuGroupEvent(
  config: Extract<ChannelConnection, { channel: "feishu" }>,
  value: unknown,
):
  | { chatId: string; unavailable?: "removed" | "dissolved"; timestamp: number }
  | undefined {
  const raw = value as {
    header?: Record<string, unknown>;
    event?: Record<string, unknown>;
  } | null;
  const header = raw?.header,
    event = raw?.event;
  if (
    !header ||
    !event ||
    header.app_id !== config.appId ||
    header.tenant_key !== config.tenantId ||
    !feishuGroupEvents.includes(
      header.event_type as (typeof feishuGroupEvents)[number],
    ) ||
    typeof event.chat_id !== "string" ||
    !event.chat_id
  )
    return;
  const timestamp = Number(header.create_time);
  // Lifecycle events cannot disable a newer authorization using a replay.
  if (
    !Number.isFinite(timestamp) ||
    timestamp <= 0 ||
    timestamp > Date.now() + 60000
  )
    return;
  return {
    chatId: event.chat_id,
    timestamp,
    ...(header.event_type === "im.chat.member.bot.deleted_v1"
      ? { unavailable: "removed" as const }
      : header.event_type === "im.chat.disbanded_v1"
        ? { unavailable: "dissolved" as const }
        : {}),
  };
}
