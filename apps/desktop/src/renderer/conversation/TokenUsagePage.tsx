import { useEffect, useMemo, useState } from "react";
import type { AgentEvent } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import { DataStat, DataSurface } from "@artemis/ui/data";
import { EmptyState, ErrorState, LoadingState } from "@artemis/ui/feedback";
import { Select } from "@artemis/ui/forms";
import { SegmentedControl } from "@artemis/ui/navigation";

import {
  ALL_USAGE_MODELS,
  buildCacheUsageMetrics,
  buildTokenUsageByModel,
  buildTokenUsageCells,
  filterTokenUsageEvents,
  TOKEN_USAGE_COPY,
  tokenUsageValue,
  tokenUsageModelsForTable,
  UNATTRIBUTED_USAGE_MODEL,
  type TokenUsageCell,
  type TokenUsageLocale,
  type TokenUsageView,
} from "./token-usage.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { TokenUsageHeatmap } from "./TokenUsageHeatmap.js";

const TOKEN_USAGE_VIEWS = ["daily", "weekly", "cumulative"] as const;

function dateKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function startOfWeek(date: string): string {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function mergeUsageEvents(
  current: readonly AgentEvent[],
  incoming: readonly AgentEvent[],
): AgentEvent[] {
  const events = new Map(current.map((event) => [event.eventId, event]));
  for (const event of incoming) {
    if (event.payload.type === "assistant.usage") {
      events.set(event.eventId, event);
    }
  }
  return [...events.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

function longestStreak(cells: readonly TokenUsageCell[]): number {
  let longest = 0;
  let current = 0;
  for (const cell of cells) {
    current = cell.dailyTokens > 0 ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

function currentStreak(cells: readonly TokenUsageCell[]): number {
  let streak = 0;
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    if (cells[index]!.dailyTokens <= 0) break;
    streak += 1;
  }
  return streak;
}

export function TokenUsagePage({
  locale,
}: {
  locale: TokenUsageLocale;
  profileAvatar?: string;
  username: string;
}) {
  const t = TOKEN_USAGE_COPY[locale];
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<TokenUsageView>("daily");
  const [selectedModel, setSelectedModel] = useState(ALL_USAGE_MODELS);
  const [hovered, setHovered] = useState<TokenUsageCell>();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  useEffect(() => {
    let mounted = true;
    const unsubscribe = window.artemis.onAgentEvent((event) => {
      if (event.payload.type === "assistant.usage") {
        setEvents((current) => mergeUsageEvents(current, [event]));
      }
    });
    void window.artemis
      .getTokenUsageEvents()
      .then((history) => {
        if (mounted) {
          setEvents((current) => mergeUsageEvents(history, current));
        }
      })
      .catch(() => {
        if (mounted) setLoadError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const today = dateKey(new Date(), timeZone);
  const firstVisibleDate = addDays(startOfWeek(today), -52 * 7);
  const usageByModel = useMemo(() => buildTokenUsageByModel(events), [events]);
  const usageModelsForTable = useMemo(
    () => tokenUsageModelsForTable(usageByModel),
    [usageByModel],
  );
  const visibleEvents = useMemo(
    () => filterTokenUsageEvents(events, selectedModel),
    [events, selectedModel],
  );
  const allCells = useMemo(
    () => buildTokenUsageCells(visibleEvents, { timeZone }),
    [timeZone, visibleEvents],
  );
  const cells = useMemo(
    () =>
      buildTokenUsageCells(visibleEvents, {
        timeZone,
        startDate: firstVisibleDate,
        endDate: today,
      }),
    [firstVisibleDate, timeZone, today, visibleEvents],
  );
  const maximum = Math.max(
    0,
    ...cells.map((cell) => tokenUsageValue(cell, view)),
  );
  const totalTokens = allCells.at(-1)?.cumulativeTokens ?? 0;
  const peakDay = Math.max(0, ...allCells.map((cell) => cell.dailyTokens));
  const peakWeek = Math.max(0, ...allCells.map((cell) => cell.weeklyTokens));
  const activeDays = allCells.filter((cell) => cell.dailyTokens > 0).length;
  const mostActiveCell = allCells.reduce<TokenUsageCell | undefined>(
    (peak, cell) =>
      !peak || cell.dailyTokens > peak.dailyTokens ? cell : peak,
    undefined,
  );
  const { usageTotals, cacheMetrics } = useMemo(
    () => ({
      usageTotals: visibleEvents.reduce(
        (totals, event) => {
          if (event.payload.type !== "assistant.usage") return totals;
          totals.input += event.payload.inputTokens;
          totals.output += event.payload.outputTokens;
          totals.cacheRead += event.payload.cacheReadTokens;
          totals.cacheWrite += event.payload.cacheWriteTokens;
          return totals;
        },
        { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      ),
      cacheMetrics: buildCacheUsageMetrics(visibleEvents),
    }),
    [visibleEvents],
  );
  const number = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const exactNumber = new Intl.NumberFormat(locale);
  const detailDateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const percent = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const cachePolicyDistribution = [
    [t.policyExplicit30m, cacheMetrics.policies["explicit-30m"]],
    [t.policyLong, cacheMetrics.policies.long],
    [t.policyShort, cacheMetrics.policies.short],
    [t.policyDisabled, cacheMetrics.policies.disabled],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => `${label} ${exactNumber.format(Number(count))}`)
    .join(" · ");
  const summary = [
    { label: t.totalTokens, value: number.format(totalTokens) },
    { label: t.peakDay, value: number.format(peakDay) },
    { label: t.peakWeek, value: number.format(peakWeek) },
    { label: t.activeDays, value: exactNumber.format(activeDays) },
    {
      label: t.cacheHitRate,
      value:
        cacheMetrics.hitRate === undefined
          ? "—"
          : percent.format(cacheMetrics.hitRate),
    },
  ];
  const observations = [
    {
      label: t.longestStreak,
      value: `${exactNumber.format(longestStreak(allCells))} ${t.days}`,
    },
    {
      label: t.averageActiveDay,
      value: number.format(activeDays === 0 ? 0 : totalTokens / activeDays),
    },
    {
      label: t.mostActiveDay,
      value:
        mostActiveCell && mostActiveCell.dailyTokens > 0
          ? detailDateFormatter.format(
              new Date(`${mostActiveCell.date}T12:00:00.000Z`),
            )
          : "—",
    },
    {
      label: t.currentStreak,
      value: `${exactNumber.format(currentStreak(cells))} ${t.days}`,
    },
    {
      label: t.recordedSpan,
      value: `${exactNumber.format(activeDays)} ${t.ofDays.replace(
        "{total}",
        exactNumber.format(allCells.length),
      )}`,
    },
    {
      label: t.recordedResponses,
      value: exactNumber.format(visibleEvents.length),
    },
    {
      label: t.cacheHitRate,
      value:
        cacheMetrics.hitRate === undefined
          ? "—"
          : percent.format(cacheMetrics.hitRate),
    },
    {
      label: t.cacheDataCoverage,
      value: `${percent.format(cacheMetrics.coverage)} (${exactNumber.format(cacheMetrics.reportedEvents)}/${exactNumber.format(cacheMetrics.usageEvents)})`,
    },
    {
      label: t.automaticPolicyDistribution,
      value: cachePolicyDistribution || "—",
    },
  ];
  const composition = [
    { label: t.inputTokens, tone: "input", value: usageTotals.input },
    { label: t.outputTokens, tone: "output", value: usageTotals.output },
    {
      label: t.cacheHitTokens,
      tone: "cache-read",
      value: usageTotals.cacheRead + usageTotals.cacheWrite,
    },
  ] as const;
  const modelLabel = (model: (typeof usageByModel)[number]) =>
    model.key === UNATTRIBUTED_USAGE_MODEL
      ? t.unattributedModel
      : `${model.providerId} · ${model.modelId}`;

  const usageState = loadError
    ? "error"
    : loading
      ? "loading"
      : events.length === 0
        ? "empty"
        : "ready";

  return (
    <DataSurface
      busy={loading}
      className={`token-usage-page${loading ? " is-loading" : ""}`}
      label={t.title}
      state={usageState}
    >
      <header className="token-usage-profile">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="token-usage-activity-controls">
          <Select
            className="token-usage-model-filter"
            label={t.modelFilter}
            labelVisibility="hidden"
            onValueChange={(model) => {
              setSelectedModel(model);
              setHovered(undefined);
            }}
            options={[
              { label: t.allModels, value: ALL_USAGE_MODELS },
              ...usageByModel.map((model) => ({
                label: modelLabel(model),
                value: model.key,
              })),
            ]}
            size="compact"
            value={selectedModel}
          />
          <SegmentedControl
            className="token-usage-tabs"
            size="compact"
            label={t.activity}
            onValueChange={(candidate) => {
              setView(candidate);
              setHovered(undefined);
            }}
            options={TOKEN_USAGE_VIEWS.map((candidate) => ({
              label: t[`${candidate}Tab`],
              value: candidate,
            }))}
            value={view}
          />
        </div>
      </header>

      <section className="token-usage-summary" aria-label={t.title}>
        {summary.map((item) => (
          <DataStat key={item.label} label={item.label} value={item.value} />
        ))}
      </section>

      <section className="token-usage-activity">
        <div className="token-usage-activity-header">
          <h2>{t.activity}</h2>
        </div>

        <div
          className="token-usage-chart-scroll"
          role="region"
          aria-label={`${t.activity}: ${t[`${view}Tab`]}`}
        >
          <TokenUsageHeatmap
            cells={cells}
            hovered={hovered}
            label={t.activity}
            locale={locale}
            maximum={maximum}
            onHoveredChange={setHovered}
            view={view}
          />
        </div>
        {loadError ? (
          <ErrorState className="token-usage-empty">{t.error}</ErrorState>
        ) : loading ? (
          <LoadingState className="token-usage-empty" label={t.loading} />
        ) : events.length === 0 ? (
          <EmptyState className="token-usage-empty" title={t.empty} />
        ) : null}
      </section>

      {usageModelsForTable.length > 0 && (
        <section className="token-usage-models" aria-label={t.usageByModel}>
          <h2>{t.usageByModel}</h2>
          <div className="token-usage-model-bars">
            {usageModelsForTable.map((model) => (
              <div key={model.key}>
                <div>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setSelectedModel(model.key);
                      setHovered(undefined);
                    }}
                  >
                    <ArtemisIcon name="model" width={14} height={14} />
                    {modelLabel(model)}
                  </Button>
                  <span>{number.format(model.totalTokens)}</span>
                </div>
                <div className="token-usage-model-bar" aria-hidden="true">
                  <span
                    style={{
                      inlineSize: `${Math.max(0, Math.min(100, (model.totalTokens / Math.max(1, ...usageModelsForTable.map((item) => item.totalTokens))) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <details className="token-usage-model-breakdown">
            <summary>{t.usageByModel}</summary>
            <div className="token-usage-models-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t.modelColumn}</th>
                    <th>{t.inputTokens}</th>
                    <th>{t.outputTokens}</th>
                    <th>{t.cacheHitTokens}</th>
                    <th title={t.cacheHitRateDescription}>{t.cacheHitRate}</th>
                    <th>{t.modelTotalTokens}</th>
                  </tr>
                </thead>
                <tbody>
                  {usageModelsForTable.map((model) => (
                    <tr
                      className={selectedModel === model.key ? "selected" : ""}
                      key={model.key}
                    >
                      <td>
                        <Button
                          className="token-usage-model-action"
                          selected={selectedModel === model.key}
                          onClick={() => {
                            setSelectedModel(model.key);
                            setHovered(undefined);
                          }}
                          variant="quiet"
                        >
                          <ArtemisIcon name="model" width={14} height={14} />
                          {modelLabel(model)}
                        </Button>
                      </td>
                      <td>{number.format(model.inputTokens)}</td>
                      <td>{number.format(model.outputTokens)}</td>
                      <td>{number.format(model.cacheHitTokens)}</td>
                      <td title={t.cacheHitRateDescription}>
                        {model.cacheHitRate === undefined
                          ? "—"
                          : percent.format(model.cacheHitRate)}
                      </td>
                      <td>{number.format(model.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      <section className="token-usage-details" aria-label={t.insights}>
        <div className="token-usage-detail-block">
          <h2>{t.insights}</h2>
          <dl className="token-usage-detail-list">
            {observations.map((item) => (
              <div className="token-usage-detail-row" key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="token-usage-detail-block">
          <h2>
            {t.tokenComposition}
            <span>{number.format(totalTokens)}</span>
          </h2>
          <div className="token-usage-composition-bar" aria-hidden="true">
            {composition.map((item) => (
              <span
                key={item.tone}
                className={item.tone}
                style={{ flex: item.value }}
              />
            ))}
          </div>
          <dl className="token-usage-detail-list">
            {composition.map((item) => (
              <div className="token-usage-detail-row" key={item.label}>
                <dt className="token-usage-composition-label">
                  <span
                    aria-hidden="true"
                    className={`token-usage-composition-marker ${item.tone}`}
                  />
                  {item.label}
                </dt>
                <dd>
                  <span className="token-usage-composition-share">
                    {percent.format(
                      item.value /
                        Math.max(
                          1,
                          composition.reduce(
                            (sum, entry) => sum + entry.value,
                            0,
                          ),
                        ),
                    )}
                  </span>
                  {number.format(item.value)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </DataSurface>
  );
}
