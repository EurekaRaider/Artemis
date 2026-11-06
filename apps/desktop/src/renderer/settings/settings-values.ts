import { UI_COPY } from "../../shared/i18n/ui-copy.js";
import type { ProviderConnection } from "@artemis/protocol";
import type { SettingsSnapshot } from "../../shared/api.js";

export const labels = UI_COPY.SettingsPanel_labels;

export type SettingsTab =
  | "general"
  | "providers"
  | "agents"
  | "im"
  | "capabilities"
  | "maintenance"
  | "hooks";

export function modelFormState(settings: SettingsSnapshot | undefined): {
  contextWindow: string;
  selectedModel: string;
} {
  if (!settings) return { contextWindow: "", selectedModel: "" };
  const selected =
    (settings.selection
      ? settings.models.find(
          (model) =>
            model.providerId === settings.selection?.providerId &&
            model.modelId === settings.selection.modelId,
        )
      : undefined) ?? settings.models[0];
  const saved = settings.addedModels.find(
    (model) =>
      model.providerId === selected?.providerId &&
      model.modelId === selected.modelId,
  );
  return {
    contextWindow: String(
      Math.min(
        saved?.contextWindow ??
          selected?.contextWindow ??
          settings.contextWindow,
        selected?.contextWindow ?? settings.contextWindow,
      ),
    ),
    selectedModel: selected
      ? modelKey(selected.providerId, selected.modelId)
      : "",
  };
}

export const DEFAULT_PROVIDER_CONTEXT_WINDOW = 1_000_000;

export const DEFAULT_PROVIDER_MAX_TOKENS = 128_000;

export type ProviderThinkingLevel = NonNullable<
  ProviderConnection["models"][number]["highestThinkingLevel"]
>;

export function modelKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;
}

export function parseModelKey(value: string): [string, string] {
  const separator = value.indexOf(":");
  return [
    decodeURIComponent(value.slice(0, separator)),
    decodeURIComponent(value.slice(separator + 1)),
  ];
}

export function normalizedModelLabel(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/[\p{Default_Ignorable_Code_Point}\p{Cc}]+/gu, "")
    .replace(/\p{White_Space}+/gu, " ")
    .trim()
    .toLowerCase();
}

export const providerIdPattern = /^[a-z0-9][a-z0-9._-]*$/u;
