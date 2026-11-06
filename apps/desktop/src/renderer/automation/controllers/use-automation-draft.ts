import {
  defaultDraft,
  draftForAutomation,
  type Locale,
  type AutomationDraft,
} from "../automation-values.js";

import type { SettingsSnapshot } from "../../../shared/api.js";

import { type Automation, type Project } from "@artemis/protocol";
import { useEffect, useRef } from "react";

interface UseAutomationDraftContext {
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly projectFilter: string;
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
  readonly setDraft: import("react").Dispatch<
    import("react").SetStateAction<AutomationDraft | undefined>
  >;
}
export function useAutomationDraft(context: UseAutomationDraftContext) {
  const { setMessage, projectFilter, props, setDraft } = context;
  const openDraft = (automation?: Automation) => {
    setMessage(undefined);
    setDraft(
      automation
        ? {
            ...draftForAutomation(automation),
            modelSelection:
              automation.modelSelection ?? props.settings?.selection,
          }
        : {
            ...defaultDraft(projectFilter || props.projects[0]?.id || ""),
            modelSelection: props.settings?.selection,
          },
    );
  };
  const handledDraftRequest = useRef<number | undefined>(undefined);
  useEffect(() => {
    const request = props.initialDraftRequest;
    if (!request || handledDraftRequest.current === request.token) return;
    handledDraftRequest.current = request.token;
    setMessage(undefined);
    setDraft({
      ...defaultDraft(request.projectId),
      modelSelection: props.settings?.selection,
    });
  }, [props.initialDraftRequest, props.settings?.selection]);
  return { openDraft };
}
