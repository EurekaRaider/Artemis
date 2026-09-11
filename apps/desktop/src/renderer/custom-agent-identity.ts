/**
 * Instance-identity labels for custom sub-agent runs (D#152 PR4): every
 * surface that lists a child agent shows which definition/revision/model
 * it runs and how it was routed (user @, model-explicit, automatic).
 */
import type { AppLocale, ChildAgentState } from "@artemis/protocol";

import { legacyLocale } from "../shared/locales.js";

type CustomAgentInstance = NonNullable<ChildAgentState["customAgent"]>;

const sourceLabels = {
  en: {
    "user-explicit": "via @",
    "model-explicit": "model-chosen",
    "model-automatic": "automatic",
  },
  "zh-CN": {
    "user-explicit": "@ 调用",
    "model-explicit": "模型指定",
    "model-automatic": "自动路由",
  },
} as const;

export function customAgentSourceLabel(
  source: CustomAgentInstance["invocationSource"],
  locale: AppLocale,
): string {
  return sourceLabels[legacyLocale(locale)][source];
}

/** Compact one-line identity: @name · r3 · provider/model · via @ */
export function customAgentInstanceIdentity(
  customAgent: CustomAgentInstance,
  locale: AppLocale,
): string {
  return [
    `@${customAgent.name}`,
    `r${customAgent.definitionRevision}`,
    `${customAgent.providerId}/${customAgent.modelId}`,
    customAgentSourceLabel(customAgent.invocationSource, locale),
  ].join(" · ");
}
