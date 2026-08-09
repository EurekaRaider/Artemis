import type { ContextUsageState } from "@artemis/protocol";

interface ContextUsageIndicatorProps {
  contextWindow?: number | undefined;
  locale: "en" | "zh-CN";
  usage?: ContextUsageState | undefined;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000) {
    return `${Number((tokens / 1_000).toFixed(1))}k`;
  }
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
          breakdown: "按类别估算的用量",
          systemPrompt: "系统提示词",
          systemTools: "系统工具",
          mcpTools: "MCP 工具",
          customAgents: "自定义代理",
          memoryFiles: "记忆文件",
          skills: "Skills",
          messages: "消息",
          freeSpace: "可用空间",
          autocompactBuffer: "自动压缩缓冲区",
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
          breakdown: "Estimated usage by category",
          systemPrompt: "System prompt",
          systemTools: "System tools",
          mcpTools: "MCP tools",
          customAgents: "Custom agents",
          memoryFiles: "Memory files",
          skills: "Skills",
          messages: "Messages",
          freeSpace: "Free space",
          autocompactBuffer: "Autocompact buffer",
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
  const breakdown = usage?.breakdown
    ? [
        {
          id: "system-prompt",
          label: labels.systemPrompt,
          tokens: usage.breakdown.systemPromptTokens,
        },
        {
          id: "system-tools",
          label: labels.systemTools,
          tokens: usage.breakdown.systemToolTokens,
        },
        ...(usage.breakdown.mcpToolTokens > 0
          ? [
              {
                id: "mcp-tools",
                label: labels.mcpTools,
                tokens: usage.breakdown.mcpToolTokens,
              },
            ]
          : []),
        ...(usage.breakdown.customAgentTokens > 0
          ? [
              {
                id: "custom-agents",
                label: labels.customAgents,
                tokens: usage.breakdown.customAgentTokens,
              },
            ]
          : []),
        ...(usage.breakdown.memoryFileTokens > 0
          ? [
              {
                id: "memory-files",
                label: labels.memoryFiles,
                tokens: usage.breakdown.memoryFileTokens,
              },
            ]
          : []),
        ...(usage.breakdown.skillTokens > 0
          ? [
              {
                id: "skills",
                label: labels.skills,
                tokens: usage.breakdown.skillTokens,
              },
            ]
          : []),
        {
          id: "messages",
          label: labels.messages,
          tokens: usage.breakdown.messageTokens,
        },
        {
          id: "free-space",
          label: labels.freeSpace,
          tokens: usage.breakdown.freeSpaceTokens,
        },
        {
          id: "autocompact-buffer",
          label: labels.autocompactBuffer,
          tokens: usage.breakdown.autocompactBufferTokens,
        },
      ]
    : [];
  const breakdownValue = (item: (typeof breakdown)[number]) => {
    const tokenText = `${formatTokens(item.tokens)} ${locale === "en" ? "tokens" : "token"}`;
    const percentage = ((item.tokens / effectiveContextWindow) * 100).toFixed(
      1,
    );
    return locale === "zh-CN"
      ? `${tokenText}（${percentage}%）`
      : `${tokenText} (${percentage}%)`;
  };
  const breakdownDescription = breakdown
    .map((item) => `${item.label}: ${breakdownValue(item)}`)
    .join(". ");

  return (
    <div
      aria-label={`${labels.title} ${summary}. ${detail}${providerDetail ? `. ${providerDetail}` : ""}${breakdownDescription ? `. ${labels.breakdown}. ${breakdownDescription}` : ""}`}
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
        {breakdown.length > 0 && (
          <div className="context-usage-breakdown">
            <span>{labels.breakdown}</span>
            <dl>
              {breakdown.map((item) => (
                <div key={item.id}>
                  <dt>{item.label}</dt>
                  <dd>{breakdownValue(item)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
