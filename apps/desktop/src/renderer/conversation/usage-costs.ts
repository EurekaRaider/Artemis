import type { AgentEvent, AppLocale } from "@artemis/protocol";
import { uiText } from "../../shared/i18n/ui-text.js";

export interface UsageCosts {
  providerUsd: number;
  estimatedUsd: number;
  providerResponses: number;
  estimatedResponses: number;
  unrecordedResponses: number;
}

export function buildUsageCosts(events: readonly AgentEvent[]): UsageCosts {
  const costs: UsageCosts = {
    providerUsd: 0,
    estimatedUsd: 0,
    providerResponses: 0,
    estimatedResponses: 0,
    unrecordedResponses: 0,
  };
  const seen = new Set<string>();
  for (const event of events) {
    if (event.payload.type !== "assistant.usage" || seen.has(event.eventId))
      continue;
    seen.add(event.eventId);
    const { costUsd, costSource } = event.payload;
    if (costUsd === undefined || costSource === undefined)
      costs.unrecordedResponses++;
    else if (costSource === "provider") {
      costs.providerUsd += costUsd;
      costs.providerResponses++;
    } else {
      costs.estimatedUsd += costUsd;
      costs.estimatedResponses++;
    }
  }
  return costs;
}

export function formatUsageCost(amount: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount);
}

export function usageCostLabels(
  costs: UsageCosts,
  locale: AppLocale,
): string[] {
  return [
    ...(costs.providerResponses
      ? [
          `${uiText(locale, "Usage.providerCost")} ${formatUsageCost(costs.providerUsd, locale)}`,
        ]
      : []),
    ...(costs.estimatedResponses
      ? [
          `${uiText(locale, "Usage.estimatedCost")} ${formatUsageCost(costs.estimatedUsd, locale)}`,
        ]
      : []),
    ...(costs.unrecordedResponses
      ? [
          uiText(locale, "Usage.unrecordedCost", {
            count: costs.unrecordedResponses,
          }),
        ]
      : []),
  ];
}

export function responseModelLabel(
  models: readonly string[],
  unreported: number,
  locale: AppLocale,
): string {
  return [
    ...(models.length
      ? [uiText(locale, "Usage.responseModels", { models: models.join(", ") })]
      : []),
    ...(unreported
      ? [uiText(locale, "Usage.unreportedModels", { count: unreported })]
      : []),
  ].join(" · ");
}
