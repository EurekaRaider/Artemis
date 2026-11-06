import { type ActiveView } from "../app-types.js";

import { useCallback, useEffect, type SetStateAction } from "react";

import { type RunMode } from "@artemis/protocol";

import { type PromptHistoryNavigation } from "../../conversation/prompt-history.js";

import {
  clearComposerDraft,
  conversationDraftKey,
  type ComposerDrafts,
} from "../../conversation/composer-drafts.js";

interface UseConversationNavigationContext {
  readonly promptHistoryNavigation: import("react").RefObject<PromptHistoryNavigation>;
  readonly prompt: string;
  readonly setSkillMenuDismissed: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly setEditingQueuedMessage: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          index: number;
          value: string;
        }
      | undefined
    >
  >;
  readonly activeComposerDraftKey: string;
  readonly renewConversationGreeting: () => void;
  readonly setActiveView: import("react").Dispatch<
    import("react").SetStateAction<ActiveView>
  >;
  readonly setActiveProjectId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setActiveThreadId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<RunMode>
  >;
  readonly setComposerDrafts: import("react").Dispatch<
    import("react").SetStateAction<ComposerDrafts>
  >;
  readonly setProjectMenuId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setThreadMenuId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly promptInput: import("react").RefObject<HTMLTextAreaElement | null>;
  readonly activeProjectId: string | undefined;
  readonly activeThreadId: string | undefined;
  readonly collapsedProjectIdsRef: import("react").RefObject<Set<string>>;
  readonly setProjectCollapsed: (projectId: string, collapsed: boolean) => void;
}
export function useConversationNavigation(
  context: UseConversationNavigationContext,
) {
  const {
    promptHistoryNavigation,
    prompt,
    setSkillMenuDismissed,
    setEditingQueuedMessage,
    activeComposerDraftKey,
    renewConversationGreeting,
    setActiveView,
    setActiveProjectId,
    setActiveThreadId,
    setMode,
    setComposerDrafts,
    setProjectMenuId,
    setThreadMenuId,
    promptInput,
    activeProjectId,
    activeThreadId,
    collapsedProjectIdsRef,
    setProjectCollapsed,
  } = context;
  useEffect(() => {
    promptHistoryNavigation.current = { index: -1, draft: prompt };
    setSkillMenuDismissed(false);
    setEditingQueuedMessage(undefined);
  }, [activeComposerDraftKey]);

  const beginNewConversation = useCallback(
    (projectId = activeProjectId) => {
      renewConversationGreeting();
      setActiveView("workspace");
      setActiveProjectId(projectId);
      setActiveThreadId(undefined);
      setMode("work");
      setComposerDrafts((current) =>
        clearComposerDraft(current, conversationDraftKey(projectId, undefined)),
      );
      promptHistoryNavigation.current = { index: -1, draft: "" };
      setSkillMenuDismissed(false);
      setProjectMenuId(undefined);
      setThreadMenuId(undefined);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [activeProjectId, renewConversationGreeting],
  );

  const beginTemporaryConversation = useCallback(() => {
    renewConversationGreeting();
    setActiveView("workspace");
    setActiveProjectId(undefined);
    setActiveThreadId(undefined);
    setMode("work");
    setComposerDrafts((current) =>
      clearComposerDraft(current, conversationDraftKey(undefined, undefined)),
    );
    promptHistoryNavigation.current = { index: -1, draft: "" };
    setSkillMenuDismissed(false);
    setProjectMenuId(undefined);
    setThreadMenuId(undefined);
    window.requestAnimationFrame(() => promptInput.current?.focus());
  }, [renewConversationGreeting]);

  const discardNewConversationDraft = useCallback(() => {
    if (activeThreadId) return;
    setComposerDrafts((current) =>
      clearComposerDraft(
        current,
        conversationDraftKey(activeProjectId, undefined),
      ),
    );
    promptHistoryNavigation.current = { index: -1, draft: "" };
    setSkillMenuDismissed(false);
  }, [activeProjectId, activeThreadId]);

  const toggleProjectHistory = useCallback(
    (projectId: string) => {
      setProjectCollapsed(
        projectId,
        !collapsedProjectIdsRef.current.has(projectId),
      );
    },
    [setProjectCollapsed],
  );
  return {
    beginNewConversation,
    beginTemporaryConversation,
    discardNewConversationDraft,
    toggleProjectHistory,
  };
}
