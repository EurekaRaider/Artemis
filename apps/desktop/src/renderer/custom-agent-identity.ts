import { UI_COPY } from "../shared/ui-copy.js";
/**
 * Instance-identity labels for custom sub-agent runs (D#152 PR4): every
 * surface that lists a child agent shows which definition/revision/model
 * it runs and how it was routed (user @, model-explicit, automatic).
 */
import type { AppLocale, ChildAgentState } from "@artemis/protocol";

type CustomAgentInstance = NonNullable<ChildAgentState["customAgent"]>;

const sourceLabels = UI_COPY.custom_agent_identity_sourceLabels;

export function customAgentSourceLabel(
  source: CustomAgentInstance["invocationSource"],
  locale: AppLocale,
): string {
  return sourceLabels[locale][source];
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
