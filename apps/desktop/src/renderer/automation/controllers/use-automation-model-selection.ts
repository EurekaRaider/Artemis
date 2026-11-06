import { type Locale, type AutomationDraft } from "../automation-values.js";

import type { SettingsSnapshot } from "../../../shared/api.js";
import {
  selectionForModelSwitch,
  thinkingLevelsForModel,
} from "../../settings/model-selection.js";

import { type ModelSelection, type Project } from "@artemis/protocol";
import { useMemo } from "react";

interface UseAutomationModelSelectionContext {
  readonly props: {
    locale: Locale;
    headerActionTarget?: HTMLElement | null | undefined;
    initialAutomationId?: string | undefined;
    initialDraftRequest?:
      | {
          projectId: string;
          token: number;
        }
      | undefined;
    projects: Project[];
    settings?:
      | Pick<
          SettingsSnapshot,
          "models" | "addedModels" | "providers" | "selection"
        >
      | undefined;
    onConfirm(message: string, tone?: "default" | "danger"): Promise<boolean>;
    onOpenThread(threadId: string): void;
  };
  readonly draft: AutomationDraft | undefined;
  readonly t: {
    title: string;
    pageSubtitle: string;
    editorSubtitle: string;
    executionSettings: string;
    scheduleSettings: string;
    taskCount: string;
    emptyDescription: string;
    chooseModel: string;
    noModels: string;
    modelUnavailable: string;
    reasoningHint: string;
    pausedUntilEnabled: string;
    moreActions: string;
    model: string;
    thinking: string;
    subtitle: string;
    create: string;
    allProjects: string;
    empty: string;
    enabled: string;
    paused: string;
    pauseTask: string;
    enableTask: string;
    authorizationRequired: string;
    authorize: string;
    runNow: string;
    edit: string;
    delete: string;
    history: string;
    noRuns: string;
    nextRun: string;
    lastRun: string;
    never: string;
    save: string;
    cancel: string;
    name: string;
    prompt: string;
    project: string;
    mode: string;
    target: string;
    schedule: string;
    date: string;
    time: string;
    chooseTime: string;
    hour: string;
    minute: string;
    timeZone: string;
    once: string;
    daily: string;
    weekdays: string;
    weekly: string;
    interval: string;
    windowedInterval: string;
    windowStart: string;
    windowEnd: string;
    intervalUnit: string;
    minutes: string;
    hours: string;
    days: string;
    local: string;
    managed: string;
    unavailableProject: string;
    deleteConfirm: string;
    executeWarning: string;
  };
}
export function useAutomationModelSelection(
  context: UseAutomationModelSelectionContext,
) {
  const { props, draft, t } = context;
  const modelKey = (model: Pick<ModelSelection, "providerId" | "modelId">) =>
    JSON.stringify([model.providerId, model.modelId]);
  const models = useMemo(() => {
    const settings = props.settings;
    if (!settings) return [];
    const added = new Set(settings.addedModels.map(modelKey));
    return settings.models
      .filter(
        (model) =>
          model.configured &&
          (added.has(modelKey(model)) ||
            settings.providers.some(
              (provider) =>
                provider.id === model.providerId &&
                provider.models.some((item) => item.id === model.modelId),
            ) ||
            (settings.selection &&
              modelKey(model) === modelKey(settings.selection)) ||
            (draft?.modelSelection &&
              modelKey(model) === modelKey(draft.modelSelection))),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, props.locale) ||
          a.providerId.localeCompare(b.providerId),
      );
  }, [props.settings, props.locale, draft?.modelSelection]);
  const selection = draft?.modelSelection ?? props.settings?.selection;
  const selectedModel = models.find(
    (model) => selection && modelKey(model) === modelKey(selection),
  );
  const selectedModelKey = selection ? modelKey(selection) : "";
  const thinkingLevels = thinkingLevelsForModel(selectedModel);
  const normalizedSelection = selectedModel
    ? selectionForModelSwitch(selectedModel, selection)
    : undefined;
  const modelOptions = models.map((model) => ({
    value: modelKey(model),
    label:
      models.filter((item) => item.name === model.name).length > 1
        ? `${model.name} · ${model.providerId}`
        : model.name,
  }));
  if (!selectedModel)
    modelOptions.unshift({
      value: selectedModelKey,
      label: selection?.modelId ?? t.chooseModel,
    });
  return {
    modelKey,
    models,
    selection,
    selectedModel,
    selectedModelKey,
    thinkingLevels,
    normalizedSelection,
    modelOptions,
  };
}
