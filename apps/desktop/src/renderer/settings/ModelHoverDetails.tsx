import { useMemo } from "react";
import type {
  AgentEvent,
  AppLocale,
  ContextUsageState,
} from "@artemis/protocol";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";

export function ModelHoverDetails({
  context,
  contextWindow,
  events,
  locale,
  model,
  provider,
  thinking,
}: {
  context: ContextUsageState | undefined;
  contextWindow: number | undefined;
  events: readonly AgentEvent[];
  locale: AppLocale;
  model: string;
  provider: string | undefined;
  thinking: string | undefined;
}) {
  const format = (value: number) =>
    new Intl.NumberFormat(locale, {
      notation: value >= 1_000 ? "compact" : "standard",
      maximumFractionDigits: 1,
    }).format(value);
  // This component mounts only while the tooltip is visible. Sum the actual
  // task events, and omit a cache percentage if any sample did not report it.
  const usage = useMemo(() => {
    const samples = events.flatMap((event) =>
      event.payload.type === "assistant.usage" ? [event.payload] : [],
    );
    if (!samples.length) return undefined;
    const input = samples.reduce(
      (sum, sample) =>
        sum +
        sample.inputTokens +
        sample.cacheReadTokens +
        sample.cacheWriteTokens,
      0,
    );
    return {
      total: samples.reduce((sum, sample) => sum + sample.totalTokens, 0),
      cache:
        input > 0 && samples.every((sample) => sample.cacheReadReported)
          ? Math.round(
              (samples.reduce(
                (sum, sample) => sum + sample.cacheReadTokens,
                0,
              ) /
                input) *
                100,
            )
          : undefined,
    };
  }, [events]);
  const limit = context?.contextWindow ?? contextWindow;
  const contextLabel =
    context && limit && typeof context.tokens === "number"
      ? context.estimated
        ? uiText(
            locale,
            "ContextUsageIndicator_CONTEXT_USAGE_COPY.localEstimatedTokens",
            { tokens: format(context.tokens), total: format(limit) },
          )
        : `${format(context.tokens)} / ${format(limit)}`
      : "—";
  return (
    <span className="model-hover-details">
      <span className="model-hover-heading">
        <ArtemisIcon name="model" width={16} height={16} />
        <strong>{model}</strong>
        {provider && <span className="model-hover-provider">{provider}</span>}
      </span>
      <span className="model-hover-grid">
        {thinking !== undefined && (
          <>
            <span>{uiText(locale, "Review06.thinking")}</span>
            <span>{thinking}</span>
          </>
        )}
        <span>{uiText(locale, "Review06.context", { count: "" }).trim()}</span>
        <span>{contextLabel}</span>
        <span>{uiText(locale, "Review06.taskUsage")}</span>
        <span>
          {usage
            ? [
                format(usage.total),
                usage.cache === undefined
                  ? undefined
                  : uiText(locale, "Review06.cacheShort", {
                      percent: usage.cache,
                    }),
              ]
                .filter(Boolean)
                .join(" · ")
            : "—"}
        </span>
      </span>
    </span>
  );
}
