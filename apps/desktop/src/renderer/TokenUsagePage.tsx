import { useEffect, useMemo, useState } from "react";
import type { AgentEvent } from "@artemis/protocol";

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
import { legacyLocale } from "../shared/locales.js";
import { localizedCopy } from "../shared/i18n-resources.js";
import { userInitials } from "./user-profile.js";
import { StatCard } from "./StatCard.js";
import { TokenUsageHeatmap } from "./TokenUsageHeatmap.js";

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
  profileAvatar,
  username,
}: {
  locale: TokenUsageLocale;
  profileAvatar?: string;
  username: string;
}) {
  const t = localizedCopy(
    locale,
    "usage",
    TOKEN_USAGE_COPY[legacyLocale(locale)],
  );
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
      label: t.longestStreak,
      value: `${exactNumber.format(longestStreak(allCells))} ${t.days}`,
    },
  ];
  const observations = [
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
      label: t.cacheReadTokens,
      tone: "cache-read",
      value: usageTotals.cacheRead,
    },
    {
      label: t.cacheWriteTokens,
      tone: "cache-write",
      value: usageTotals.cacheWrite,
    },
  ];
  const modelLabel = (model: (typeof usageByModel)[number]) =>
    model.key === UNATTRIBUTED_USAGE_MODEL
      ? t.unattributedModel
      : `${model.providerId} · ${model.modelId}`;

  return (
    <section
      aria-busy={loading}
      className={`token-usage-page${loading ? " is-loading" : ""}`}
    >
      <header className="token-usage-profile">
        <div aria-hidden="true" className="token-usage-avatar">
          {profileAvatar ? (
            <img
              alt=""
              className="token-usage-avatar-image"
              src={profileAvatar}
            />
          ) : (
            userInitials(username)
          )}
        </div>
        <h1>{username}</h1>
        <p title={t.subtitle}>
          <span className="token-usage-handle">@{username}</span>
          <span aria-hidden="true" className="token-usage-profile-separator">
            ·
          </span>
          <span className="token-usage-profile-badge">Artemis</span>
        </p>
      </header>

      <section className="token-usage-summary" aria-label={t.title}>
        {summary.map((item) => (
          <StatCard key={item.label} label={item.label} value={item.value} />
        ))}
      </section>

      <section className="token-usage-activity">
        <div className="token-usage-activity-header">
          <h2>{t.activity}</h2>
          <div className="token-usage-activity-controls">
            <label className="token-usage-model-filter">
              <span>{t.modelFilter}</span>
              <select
                aria-label={t.modelFilter}
                onChange={(event) => {
                  setSelectedModel(event.target.value);
                  setHovered(undefined);
                }}
                value={selectedModel}
              >
                <option value={ALL_USAGE_MODELS}>{t.allModels}</option>
                {usageByModel.map((model) => (
                  <option key={model.key} value={model.key}>
                    {modelLabel(model)}
                  </option>
                ))}
              </select>
            </label>
            <div className="token-usage-tabs" role="tablist">
              {(["daily", "weekly", "cumulative"] as const).map((candidate) => (
                <button
                  aria-selected={view === candidate}
                  key={candidate}
                  onClick={() => {
                    setView(candidate);
                    setHovered(undefined);
                  }}
                  role="tab"
                  type="button"
                >
                  {t[`${candidate}Tab`]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="token-usage-chart-scroll">
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
          <p className="token-usage-empty error" role="alert">
            {t.error}
          </p>
        ) : loading ? (
          <p aria-live="polite" className="token-usage-empty" role="status">
            {t.loading}
          </p>
        ) : events.length === 0 ? (
          <p className="token-usage-empty" role="status">
            {t.empty}
          </p>
        ) : null}
      </section>

      {usageModelsForTable.length > 0 && (
        <section className="token-usage-models" aria-label={t.usageByModel}>
          <h2>{t.usageByModel}</h2>
          <div className="token-usage-models-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.modelColumn}</th>
                  <th>{t.inputTokens}</th>
                  <th>{t.outputTokens}</th>
                  <th>{t.cacheHitTokens}</th>
                  <th title={t.cacheHitRateDescription}>{t.cacheHitRate}</th>
                  <th>{t.totalTokens}</th>
                </tr>
              </thead>
              <tbody>
                {usageModelsForTable.map((model) => (
                  <tr
                    className={selectedModel === model.key ? "selected" : ""}
                    key={model.key}
                  >
                    <td>
                      <button
                        aria-pressed={selectedModel === model.key}
                        onClick={() => {
                          setSelectedModel(model.key);
                          setHovered(undefined);
                        }}
                        type="button"
                      >
                        {modelLabel(model)}
                      </button>
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
          <h2>{t.tokenComposition}</h2>
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
                <dd>{number.format(item.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </section>
  );
}
