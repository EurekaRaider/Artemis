import { appCopy } from "../app-copy.js";
import { type ActiveView, type ToastContent } from "../app-types.js";

import { preserveLoadedEvents } from "../../conversation/stream-snapshot.js";

import { useCallback, type SetStateAction } from "react";

import { type RunMode } from "@artemis/protocol";
import type { DesktopSnapshot } from "../../../shared/api.js";

import {
  conversationDraftKey,
  moveComposerDraft,
  type ComposerDrafts,
} from "../../conversation/composer-drafts.js";

import { isWorkspaceDraftThread } from "../thread-list-order.js";

interface UseThreadCreationContext {
  readonly snapshot: DesktopSnapshot | undefined;
  readonly mode: RunMode;
  readonly loadedEventThreads: import("react").RefObject<Set<string>>;
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
  >;
  readonly setComposerDrafts: import("react").Dispatch<
    import("react").SetStateAction<ComposerDrafts>
  >;
  readonly setActiveView: import("react").Dispatch<
    import("react").SetStateAction<ActiveView>
  >;
  readonly setActiveProjectId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setActiveThreadId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly t: ReturnType<typeof appCopy>;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly activeProjectId: string | undefined;
  readonly activeThreadId: string | undefined;
  readonly workspaceThreadCreation: import("react").RefObject<
    Promise<string | undefined> | undefined
  >;
}
export function useThreadCreation(context: UseThreadCreationContext) {
  const {
    snapshot,
    mode,
    loadedEventThreads,
    setSnapshot,
    setComposerDrafts,
    setActiveView,
    setActiveProjectId,
    setActiveThreadId,
    t,
    setToast,
    activeProjectId,
    activeThreadId,
    workspaceThreadCreation,
  } = context;
  const createThread = useCallback(
    async (projectId = activeProjectId, preserveDraft = false) => {
      try {
        const reusableWorkspaceDraft = snapshot?.threads.find(
          (thread) =>
            thread.projectId === projectId && isWorkspaceDraftThread(thread),
        );
        const thread =
          reusableWorkspaceDraft ??
          (await window.artemis.createThread({
            ...(projectId ? { projectId } : {}),
            mode,
            target: "local",
          }));
        if (!thread) return undefined;
        loadedEventThreads.current.add(thread.id);
        if (!reusableWorkspaceDraft) {
          const refreshed = await window.artemis.getSnapshot();
          setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        }
        if (preserveDraft) {
          setComposerDrafts((current) =>
            moveComposerDraft(
              current,
              conversationDraftKey(projectId, undefined),
              conversationDraftKey(projectId, thread.id),
            ),
          );
        }
        setActiveView("workspace");
        setActiveProjectId(projectId);
        setActiveThreadId(thread.id);
        return thread;
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      }
    },
    [activeProjectId, mode, snapshot?.threads, t.taskError],
  );

  const ensureWorkspaceThread = useCallback(() => {
    if (activeThreadId) return Promise.resolve(activeThreadId);
    if (workspaceThreadCreation.current) {
      return workspaceThreadCreation.current;
    }
    const pending = createThread(activeProjectId, true)
      .then((thread) => thread?.id)
      .finally(() => {
        if (workspaceThreadCreation.current === pending) {
          workspaceThreadCreation.current = undefined;
        }
      });
    workspaceThreadCreation.current = pending;
    return pending;
  }, [activeProjectId, activeThreadId, createThread]);
  return { createThread, ensureWorkspaceThread };
}
