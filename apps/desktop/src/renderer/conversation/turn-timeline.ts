import type { AppLocale, ThreadViewState } from "@artemis/protocol";

// Initial attachments are persisted as sources alongside the first user message
// in a turn. Later steering messages must not repeat those attachments.
export function userMessageAttachments(
  state: ThreadViewState,
  messageId: string,
) {
  const entry = `user:${messageId}`;
  const turnId = state.entryTurnIds[entry];
  const firstUser = state.turns[turnId ?? ""]?.order.find((key) =>
    key.startsWith("user:"),
  );
  if (!turnId || firstUser !== entry) return [];
  return state.taskSourceOrder.flatMap((id) => {
    const source = state.taskSources[id];
    return source?.turnId === turnId &&
      (source.kind === "file" || source.kind === "image")
      ? [source]
      : [];
  });
}

export function formatWorkedDuration(
  durationMs: number | undefined,
  locale: AppLocale = "en",
): string {
  const totalSeconds = Math.max(0, Math.floor((durationMs ?? 0) / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const unit = (value: number, name: "hour" | "minute" | "second") => {
    if (locale === "zh-CN" || locale === "zh-TW")
      return `${value} ${{ hour: locale === "zh-CN" ? "小时" : "小時", minute: "分", second: "秒" }[name]}`;
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
    }).format(value);
  };
  return [
    hours > 0 ? unit(hours, "hour") : undefined,
    totalSeconds >= 60 ? unit(minutes, "minute") : undefined,
    unit(seconds, "second"),
  ]
    .filter(Boolean)
    .join(" ");
}
