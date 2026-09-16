import { UI_COPY } from "../shared/ui-copy.js";
import type { AppLocale, ContextUsageState } from "@artemis/protocol";

interface ContextUsageIndicatorProps {
  contextWindow?: number | undefined;
  locale: AppLocale;
  usage?: ContextUsageState | undefined;
}

function formatTokens(tokens: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, {
    notation: tokens >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(tokens);
}

const CONTEXT_USAGE_COPY = UI_COPY.ContextUsageIndicator_CONTEXT_USAGE_COPY;

function fill(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
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
  const exactPercent = hasTokens
    ? (tokens / effectiveContextWindow) * 100
    : null;
  const percent = exactPercent === null ? null : Math.round(exactPercent);
  const remaining = percent === null ? null : Math.max(0, 100 - percent);
  const ringPercent = Math.min(100, Math.max(0, exactPercent ?? 0));
  const templates = CONTEXT_USAGE_COPY[locale];
  const formattedTokens = formatTokens(tokens, locale);
  const totalTokens = formatTokens(effectiveContextWindow, locale);
  const labels = {
    ...templates,
    summary: fill(templates.summary, {
      percent: percent ?? 0,
      remaining: remaining ?? 0,
    }),
    estimatedSummary: fill(templates.estimatedSummary, {
      percent: percent ?? 0,
      remaining: remaining ?? 0,
    }),
    tokens: fill(templates.tokens, {
      tokens: formattedTokens,
      total: totalTokens,
    }),
    estimatedTokens: fill(templates.estimatedTokens, {
      tokens: formattedTokens,
      total: totalTokens,
    }),
    localEstimatedTokens: fill(templates.localEstimatedTokens, {
      tokens: formattedTokens,
      total: totalTokens,
    }),
    providerInput: fill(templates.providerInput, {
      tokens: formatTokens(usage?.providerInputTokens ?? 0, locale),
    }),
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
    const tokenText = `${formatTokens(item.tokens, locale)} Token`;
    const percentage = ((item.tokens / effectiveContextWindow) * 100).toFixed(
      1,
    );
    return `${tokenText} (${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(percentage))}%)`;
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
            <div className="context-usage-breakdown-bar" aria-hidden="true">
              {breakdown.map((item) => (
                <span
                  key={item.id}
                  data-context-category={item.id}
                  style={{ flex: Math.max(0, item.tokens) }}
                />
              ))}
            </div>
            <dl>
              {breakdown.map((item) => (
                <div key={item.id}>
                  <dt>
                    <i
                      aria-hidden="true"
                      className="context-usage-swatch"
                      data-context-category={item.id}
                    />
                    {item.label}
                  </dt>
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
