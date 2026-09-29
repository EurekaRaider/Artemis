import type {
  AgentModelInfo,
  AppLocale,
  ModelSelection,
  ThinkingLevel,
} from "@artemis/protocol";
import { I18N_RESOURCES } from "../shared/i18n-resources.js";

export function thinkingLevelLabel(
  level: ThinkingLevel,
  locale: AppLocale,
): string {
  const key = {
    off: "thinkingOff",
    minimal: "thinkingMinimal",
    low: "thinkingLow",
    medium: "thinkingMedium",
    high: "thinkingHigh",
    xhigh: "thinkingXHigh",
    max: "thinkingMax",
  } as const;
  return I18N_RESOURCES[locale].settings[key[level]];
}

const selectableThinkingLevels: ModelSelection["thinkingLevel"][] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function highestThinkingLevel(
  model: AgentModelInfo,
): ModelSelection["thinkingLevel"] {
  return (
    model.thinkingLevels?.filter((level) => level !== "off").at(-1) ??
    model.highestThinkingLevel ??
    "high"
  );
}

export function thinkingLevelsForModel(
  model: AgentModelInfo | undefined,
): ModelSelection["thinkingLevel"][] {
  if (!model?.reasoning) return [];
  if (model.thinkingLevels) {
    return model.thinkingLevels.filter((level) => level !== "off");
  }
  const highest = model.highestThinkingLevel ?? "high";
  return selectableThinkingLevels.slice(
    0,
    selectableThinkingLevels.indexOf(highest) + 1,
  );
}

export function selectionForModelSwitch(
  model: AgentModelInfo,
  currentSelection?: ModelSelection,
): ModelSelection {
  if (!model.reasoning) {
    return {
      providerId: model.providerId,
      modelId: model.modelId,
      thinkingLevel: "off",
    };
  }

  const sameModel =
    currentSelection?.providerId === model.providerId &&
    currentSelection.modelId === model.modelId;
  const preserveUltraMode = sameModel && currentSelection.ultraMode === true;
  const preserveThinkingLevel =
    sameModel &&
    currentSelection.thinkingLevel !== "off" &&
    thinkingLevelsForModel(model).includes(currentSelection.thinkingLevel);
  const thinkingLevel = preserveUltraMode
    ? highestThinkingLevel(model)
    : preserveThinkingLevel
      ? currentSelection.thinkingLevel
      : highestThinkingLevel(model);

  return {
    providerId: model.providerId,
    modelId: model.modelId,
    thinkingLevel,
    ...(preserveUltraMode ? { ultraMode: true } : {}),
  };
}
