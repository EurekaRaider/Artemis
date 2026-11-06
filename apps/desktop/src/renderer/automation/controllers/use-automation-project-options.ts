import {
  projectSelectOptions,
  type Locale,
  type AutomationDraft,
} from "../automation-values.js";

import type { SettingsSnapshot } from "../../../shared/api.js";

import { type Project } from "@artemis/protocol";
import { useMemo } from "react";

interface UseAutomationProjectOptionsContext {
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
  readonly draft: AutomationDraft | undefined;
}
export function useAutomationProjectOptions(
  context: UseAutomationProjectOptionsContext,
) {
  const { props, t, draft } = context;
  const filterProjectOptions = useMemo(
    () => projectSelectOptions(props.projects, [t.allProjects]),
    [props.projects, t.allProjects],
  );
  const editorProjectOptions = useMemo(() => {
    const missingProject =
      draft !== undefined &&
      !props.projects.some((project) => project.id === draft.projectId);
    const options = projectSelectOptions(
      props.projects,
      missingProject ? [t.unavailableProject] : [],
    );
    return missingProject
      ? [...options, { label: t.unavailableProject, value: draft.projectId }]
      : options;
  }, [draft?.projectId, props.projects, t.unavailableProject]);
  return { filterProjectOptions, editorProjectOptions };
}
