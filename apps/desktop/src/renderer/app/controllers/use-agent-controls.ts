import { appCopy } from "../app-copy.js";
import { type ToastContent } from "../app-types.js";

import { useCallback, type SetStateAction } from "react";

import { type AgentTeamState, type ChildAgentState } from "@artemis/protocol";

import { I18N_RESOURCES } from "../../../shared/i18n/i18n-resources.js";

import {
  agentTeamWorkspaceTab,
  childAgentWorkspaceTab,
  type WorkspaceTabAction,
} from "../../workspace/workspace-tabs.js";

interface UseAgentControlsContext {
  readonly setWorkspaceDockOpen: (update: SetStateAction<boolean>) => void;
  readonly setWorkspaceTabMenuOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly dispatchWorkspaceTab: (action: WorkspaceTabAction) => void;
  readonly t: ReturnType<typeof appCopy>;
  readonly activeThreadId: string | undefined;
  readonly setChildAgentControlPending: import("react").Dispatch<
    import("react").SetStateAction<string | undefined | undefined>
  >;
  readonly localeRef: import("react").RefObject<
    | "ar"
    | "de"
    | "en"
    | "es"
    | "fr"
    | "hi"
    | "id"
    | "it"
    | "ja"
    | "ko"
    | "pt-BR"
    | "ru"
    | "zh-CN"
    | "zh-TW"
  >;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly setAgentTeamControlPending: import("react").Dispatch<
    SetStateAction<boolean>
  >;
}
export function useAgentControls(context: UseAgentControlsContext) {
  const {
    setWorkspaceDockOpen,
    setWorkspaceTabMenuOpen,
    dispatchWorkspaceTab,
    t,
    activeThreadId,
    setChildAgentControlPending,
    localeRef,
    setToast,
    setAgentTeamControlPending,
  } = context;
  const openChildAgentPanel = useCallback(
    (child: ChildAgentState) => {
      setWorkspaceDockOpen(true);
      setWorkspaceTabMenuOpen(false);
      dispatchWorkspaceTab({
        type: "open",
        tab: childAgentWorkspaceTab(child.agentId, child.label, child.teamId),
      });
    },
    [dispatchWorkspaceTab],
  );

  const openAgentTeamPanel = useCallback(
    (team: AgentTeamState) => {
      setWorkspaceDockOpen(true);
      setWorkspaceTabMenuOpen(false);
      dispatchWorkspaceTab({
        type: "open",
        tab: agentTeamWorkspaceTab(team.teamId, t.agentTeam),
      });
    },
    [dispatchWorkspaceTab, t.agentTeam],
  );

  const controlChildAgent = useCallback(
    async (child: ChildAgentState, action: "steer" | "cancel" | "retry") => {
      if (!activeThreadId) return;
      const pendingKey = `${child.agentId}:${action}`;
      setChildAgentControlPending(pendingKey);
      try {
        const result = await window.artemis.controlChildAgent({
          threadId: activeThreadId,
          agentId: child.agentId,
          action,
          ...(action === "steer"
            ? {
                message: I18N_RESOURCES[localeRef.current].app.childNudgePrompt,
              }
            : {}),
        });
        if (action === "retry") {
          setWorkspaceDockOpen(true);
          dispatchWorkspaceTab({
            type: "open",
            tab: childAgentWorkspaceTab(
              result.agentId,
              child.label,
              child.teamId,
            ),
          });
        }
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setChildAgentControlPending(undefined);
      }
    },
    [activeThreadId, dispatchWorkspaceTab],
  );

  const stopAgentTeam = useCallback(
    async (team: AgentTeamState) => {
      if (!activeThreadId) return;
      setAgentTeamControlPending(true);
      try {
        await window.artemis.controlAgentTeam({
          threadId: activeThreadId,
          teamId: team.teamId,
          action: "cancel",
        });
      } catch (error) {
        setToast({
          error: true,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setAgentTeamControlPending(false);
      }
    },
    [activeThreadId],
  );
  return {
    openChildAgentPanel,
    openAgentTeamPanel,
    controlChildAgent,
    stopAgentTeam,
  };
}
