import {
  scheduleForDraft,
  type AutomationDraft,
} from "../automation-values.js";

import { type FormEvent } from "react";

interface CreateAutomationActionsContext {
  readonly draft: AutomationDraft | undefined;
  readonly normalizedSelection:
    | {
        providerId: string;
        modelId: string;
        thinkingLevel:
          "high" | "low" | "max" | "medium" | "minimal" | "off" | "xhigh";
        ultraMode?: boolean | undefined;
      }
    | undefined;
  readonly busy: boolean;
  readonly setBusy: import("react").Dispatch<
    import("react").SetStateAction<boolean>
  >;
  readonly setMessage: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setDraft: import("react").Dispatch<
    import("react").SetStateAction<AutomationDraft | undefined>
  >;
}
export function createAutomationActions(
  context: CreateAutomationActionsContext,
) {
  const { draft, normalizedSelection, busy, setBusy, setMessage, setDraft } =
    context;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || !normalizedSelection || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const saved = await window.artemis.saveAutomation({
        ...(draft.id ? { id: draft.id } : {}),
        projectId: draft.projectId,
        name: draft.name,
        prompt: draft.prompt,
        mode: draft.mode,
        target: draft.target,
        modelSelection: normalizedSelection,
        schedule: scheduleForDraft(draft),
        enabled: draft.enabled,
      });
      if (saved.authorizationState === "required") {
        await window.artemis.authorizeAutomation(saved.id);
      }
      setDraft(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const invoke = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return { save, invoke };
}
