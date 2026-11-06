import { appCopy } from "../app-copy.js";
import { type ToastContent } from "../app-types.js";

import { useCallback, type SetStateAction } from "react";

import { type ModelSelection, type ThinkingLevel } from "@artemis/protocol";
import type { DesktopSnapshot, SettingsSnapshot } from "../../../shared/api.js";

import { selectionForModelSwitch } from "../../settings/model-selection.js";

interface UseComposerModelSelectionContext {
  readonly runtimeSettings: SettingsSnapshot | undefined;
  readonly turnActive: boolean;
  readonly busy: boolean;
  readonly pendingModelSelection: ModelSelection | undefined;
  readonly activeSelection:
    | {
        providerId: string;
        modelId: string;
        thinkingLevel:
          "high" | "low" | "max" | "medium" | "minimal" | "off" | "xhigh";
        ultraMode?: boolean | undefined;
      }
    | undefined;
  readonly setPendingModelSelection: import("react").Dispatch<
    import("react").SetStateAction<ModelSelection | undefined>
  >;
  readonly activeThread: import("@artemis/protocol").Thread | undefined;
  readonly activeProjectId: string | undefined;
  readonly createThread: (
    projectId?: string,
    preserveDraft?: boolean,
  ) => Promise<import("@artemis/protocol").Thread | undefined>;
  readonly setRuntimeSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
  >;
  readonly t: ReturnType<typeof appCopy>;
  readonly setToast: (content: ToastContent | undefined) => void;
}
export function useComposerModelSelection(
  context: UseComposerModelSelectionContext,
) {
  const {
    runtimeSettings,
    turnActive,
    busy,
    pendingModelSelection,
    activeSelection,
    setPendingModelSelection,
    activeThread,
    activeProjectId,
    createThread,
    setRuntimeSettings,
    setSnapshot,
    t,
    setToast,
  } = context;
  const switchComposerModel = useCallback(
    async (model: SettingsSnapshot["models"][number]) => {
      if (!runtimeSettings || turnActive || busy || pendingModelSelection)
        return;
      const nextSelection = selectionForModelSwitch(model, activeSelection);
      setPendingModelSelection(nextSelection);
      try {
        const thread =
          activeThread ?? (await createThread(activeProjectId, true));
        if (!thread) return;
        const updated = await window.artemis.setThreadModelSelection(
          thread.id,
          nextSelection,
        );
        setRuntimeSettings((current) =>
          current
            ? {
                ...current,
                selection: updated.modelSelection ?? nextSelection,
                ...(updated.contextWindow !== undefined
                  ? { contextWindow: updated.contextWindow }
                  : {}),
              }
            : current,
        );
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((candidate) =>
                  candidate.id === updated.id ? updated : candidate,
                ),
              }
            : current,
        );
      } catch (error) {
        setToast(
          `${t.modelSwitchFailed} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setPendingModelSelection(undefined);
      }
    },
    [
      activeProjectId,
      activeSelection,
      activeThread,
      busy,
      createThread,
      pendingModelSelection,
      runtimeSettings,
      t.modelSwitchFailed,
      turnActive,
    ],
  );

  const switchComposerThinking = useCallback(
    async (thinkingLevel: ThinkingLevel, ultraMode = false) => {
      if (!activeSelection || turnActive || busy || pendingModelSelection)
        return;
      const nextSelection = {
        ...activeSelection,
        thinkingLevel,
        ultraMode,
      };
      setPendingModelSelection(nextSelection);
      try {
        const thread =
          activeThread ?? (await createThread(activeProjectId, true));
        if (!thread) return;
        const updated = await window.artemis.setThreadModelSelection(
          thread.id,
          nextSelection,
        );
        setRuntimeSettings((current) =>
          current
            ? {
                ...current,
                selection: updated.modelSelection ?? nextSelection,
                ...(updated.contextWindow !== undefined
                  ? { contextWindow: updated.contextWindow }
                  : {}),
              }
            : current,
        );
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((candidate) =>
                  candidate.id === updated.id ? updated : candidate,
                ),
              }
            : current,
        );
      } catch (error) {
        setToast(
          `${t.modelSwitchFailed} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setPendingModelSelection(undefined);
      }
    },
    [
      activeProjectId,
      activeSelection,
      activeThread,
      busy,
      createThread,
      pendingModelSelection,
      t.modelSwitchFailed,
      turnActive,
    ],
  );
  return { switchComposerModel, switchComposerThinking };
}
