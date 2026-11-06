import {
  text,
  type AutomationDraft,
  type Locale,
} from "../automation-values.js";

import type { SettingsSnapshot } from "../../../shared/api.js";

import {
  createAutomationViewState,
  type AutomationViewState,
  type Project,
} from "@artemis/protocol";
import { useRef, useState } from "react";

interface UseAutomationStateContext {
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
export function useAutomationState(context: UseAutomationStateContext) {
  const { props } = context;
  const t = text[props.locale];
  const [state, setState] = useState<AutomationViewState>(
    createAutomationViewState,
  );
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "enabled" | "paused"
  >("all");
  const [selectedAutomationId, setSelectedAutomationId] = useState<
    string | undefined
  >(props.initialAutomationId);
  const [draft, setDraft] = useState<AutomationDraft>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [moreAutomation, setMoreAutomation] = useState<string>();
  const moreAnchor = useRef<HTMLElement | null>(null);
  return {
    t,
    state,
    setState,
    projectFilter,
    setProjectFilter,
    statusFilter,
    setStatusFilter,
    selectedAutomationId,
    setSelectedAutomationId,
    draft,
    setDraft,
    busy,
    setBusy,
    message,
    setMessage,
    loading,
    setLoading,
    moreAutomation,
    setMoreAutomation,
    moreAnchor,
  };
}
