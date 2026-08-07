import type { ContextUsageState } from "@artemis/protocol";

interface ContextUsageIndicatorProps {
  contextWindow?: number | undefined;
  locale: "en" | "zh-CN";
  usage?: ContextUsageState | undefined;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${Number((tokens / 1_000_000).toFixed(1))}m`;
}

export function ContextUsageIndicator({
  contextWindow,
  locale,
  usage,
}: ContextUsageIndicatorProps) {
  const effectiveContextWindow = usage?.contextWindow ?? contextWindow;
  if (!effectiveContextWindow) {
    return null;
  }

  const reportedTokens = usage?.tokens;
  const hasTokens = typeof reportedTokens === "number";
  const tokens = hasTokens ? reportedTokens : 0;
  const percent = hasTokens
    ? Math.round((tokens / effectiveContextWindow) * 100)
    : null;
  const remaining = percent === null ? null : Math.max(0, 100 - percent);
  const ringPercent = Math.min(100, Math.max(0, percent ?? 0));
  const labels =
    locale === "zh-CN"
      ? {
          title: "上下文窗口：",
          summary: `${percent}% 已用（剩余 ${remaining}%）`,
          estimatedSummary: `约 ${percent}% 已用（约剩余 ${remaining}%）`,
          unknownSummary: "上下文用量暂不可用",
          tokens: `已用 ${formatTokens(tokens)} token，共 ${formatTokens(effectiveContextWindow)}`,
          estimatedTokens: `压缩后估算约 ${formatTokens(tokens)} token，共 ${formatTokens(effectiveContextWindow)}`,
          localEstimatedTokens: `当前估算约 ${formatTokens(tokens)} token，共 ${formatTokens(effectiveContextWindow)}`,
          providerInput: `上次模型实测输入 ${formatTokens(usage?.providerInputTokens ?? 0)} token`,
          compacting: "正在压缩上下文…",
          unknown: "将在下一次模型响应后重新计算",
        }
      : {
          title: "Context window:",
          summary: `${percent}% used (${remaining}% left)`,
          estimatedSummary: `About ${percent}% used (about ${remaining}% left)`,
          unknownSummary: "Context usage is temporarily unavailable",
          tokens: `${formatTokens(tokens)} tokens used, ${formatTokens(effectiveContextWindow)} total`,
          estimatedTokens: `About ${formatTokens(tokens)} tokens after compaction, ${formatTokens(effectiveContextWindow)} total`,
          localEstimatedTokens: `Current estimate: about ${formatTokens(tokens)} tokens, ${formatTokens(effectiveContextWindow)} total`,
          providerInput: `Last provider-measured input: ${formatTokens(usage?.providerInputTokens ?? 0)} tokens`,
          compacting: "Compacting context…",
          unknown: "Usage recalculates after the next model response",
        };
  const summary = !hasTokens
    ? labels.unknownSummary
    : usage?.estimated
      ? labels.estimatedSummary
      : labels.summary;
  const detail = usage?.compacting
    ? labels.compacting
    : !hasTokens
      ? labels.unknown
      : usage?.estimated
        ? usage.source === "local-estimate"
          ? labels.localEstimatedTokens
          : labels.estimatedTokens
        : labels.tokens;
  const providerDetail =
    usage?.estimated && typeof usage.providerInputTokens === "number"
      ? labels.providerInput
      : undefined;

  return (
    <div
      aria-label={`${labels.title} ${summary}. ${detail}${providerDetail ? `. ${providerDetail}` : ""}`}
      className="context-usage-indicator"
      role="img"
      tabIndex={0}
    >
      <svg
        aria-hidden="true"
        className="context-usage-ring"
        viewBox="0 0 24 24"
      >
        <circle className="context-usage-track" cx="12" cy="12" r="8" />
        {hasTokens && (
          <circle
            className="context-usage-progress"
            cx="12"
            cy="12"
            pathLength="100"
            r="8"
            style={{ strokeDashoffset: 100 - ringPercent }}
          />
        )}
      </svg>
      <div className="context-usage-popover" role="tooltip">
        <strong>{labels.title}</strong>
        <span>{summary}</span>
        <span>{detail}</span>
        {providerDetail && <span>{providerDetail}</span>}
      </div>
    </div>
  );
}
