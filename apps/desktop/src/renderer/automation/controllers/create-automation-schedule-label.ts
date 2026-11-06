import {
  scheduleForDraft,
  type AutomationDraft,
  type Locale,
} from "../automation-values.js";

import { scheduleLabel } from "../schedule-label.js";

import type { SettingsSnapshot } from "../../../shared/api.js";

import { type Project } from "@artemis/protocol";

interface CreateAutomationScheduleLabelContext {
  readonly draft: AutomationDraft | undefined;
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
}
export function createAutomationScheduleLabel(
  context: CreateAutomationScheduleLabelContext,
) {
  const { draft, props } = context;
  let draftScheduleLabel = "";
  if (draft) {
    try {
      draftScheduleLabel = scheduleLabel(
        { schedule: scheduleForDraft(draft) },
        props.locale,
      );
    } catch {
      /* Keep the form editable while a date or time zone is incomplete. */
    }
  }
  return { draftScheduleLabel };
}
