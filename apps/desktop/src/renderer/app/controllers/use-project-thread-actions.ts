import { appCopy } from "../app-copy.js";
import {
  type ActiveView,
  type ConfirmationTone,
  type ToastContent,
  type ConfirmationState,
} from "../app-types.js";

import { preserveLoadedEvents } from "../../conversation/stream-snapshot.js";
import { BoundedStateCache } from "../bounded-state-cache.js";

import { type ThreadHistoryPage } from "../../../shared/thread-history.js";

import { uiText } from "../../../shared/i18n/ui-text.js";

import { useCallback, useRef, type SetStateAction } from "react";

import {
  type Project,
  type RunMode,
  type Thread,
  type ThreadViewState,
} from "@artemis/protocol";
import type { DesktopSnapshot } from "../../../shared/api.js";

import {
  clearComposerDraft,
  conversationDraftKey,
  type ComposerDrafts,
} from "../../conversation/composer-drafts.js";

interface UseProjectThreadActionsContext {
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
  >;
  readonly beginNewConversation: (projectId?: string | undefined) => void;
  readonly t: ReturnType<typeof appCopy>;
  readonly requestConfirmation: (
    message: string,
    tone?: ConfirmationTone,
    options?: Pick<ConfirmationState, "acceptLabel" | "cancelLabel" | "title">,
  ) => Promise<boolean>;
  readonly setProjectMenuId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly activeProjectId: string | undefined;
  readonly setActiveProjectId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setActiveThreadId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly setActiveView: import("react").Dispatch<
    import("react").SetStateAction<ActiveView>
  >;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<RunMode>
  >;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly setThreadRename: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          threadId: string;
          title: string;
        }
      | undefined
    >
  >;
  readonly setThreadMenuId: import("react").Dispatch<
    import("react").SetStateAction<string | undefined>
  >;
  readonly locale: import("@artemis/protocol").AppLocale;
  readonly deletingThreadIds: import("react").RefObject<Set<string>>;
  readonly snapshot: DesktopSnapshot | undefined;
  readonly loadedEventThreads: import("react").RefObject<Set<string>>;
  readonly loadingEventThreads: import("react").RefObject<Set<string>>;
  readonly threadStateCache: import("react").RefObject<
    BoundedStateCache<{
      history?: ThreadHistoryPage;
      eventCount: number;
      lastEventId?: string;
      mode: RunMode;
      state: ThreadViewState;
    }>
  >;
  readonly setComposerDrafts: import("react").Dispatch<
    import("react").SetStateAction<ComposerDrafts>
  >;
  readonly setPromptSubmittedAtByThread: import("react").Dispatch<
    import("react").SetStateAction<Record<string, number>>
  >;
  readonly setWorkspaceTabsByThread: (
    update: SetStateAction<
      Record<
        string,
        import("../../workspace/workspace-tabs.js").WorkspaceTabsState
      >
    >,
  ) => void;
  readonly promptInput: import("react").RefObject<HTMLTextAreaElement | null>;
  readonly activeThreadId: string | undefined;
}
export function useProjectThreadActions(
  context: UseProjectThreadActionsContext,
) {
  const {
    setSnapshot,
    beginNewConversation,
    t,
    requestConfirmation,
    setProjectMenuId,
    activeProjectId,
    setActiveProjectId,
    setActiveThreadId,
    setActiveView,
    setMode,
    setToast,
    setThreadRename,
    setThreadMenuId,
    locale,
    deletingThreadIds,
    snapshot,
    loadedEventThreads,
    loadingEventThreads,
    threadStateCache,
    setComposerDrafts,
    setPromptSubmittedAtByThread,
    setWorkspaceTabsByThread,
    promptInput,
    activeThreadId,
  } = context;
  const openProject = useCallback(async () => {
    const project = await window.artemis.openProject();
    if (!project) return;
    setSnapshot((current) => {
      if (!current) return current;
      const exists = current.projects.some((item) => item.id === project.id);
      return {
        ...current,
        projects: exists ? current.projects : [project, ...current.projects],
      };
    });
    beginNewConversation(project.id);
  }, [beginNewConversation]);

  const removeProject = useCallback(
    async (project: Project) => {
      if (!(await requestConfirmation(t.removeProjectConfirm))) return;
      try {
        await window.artemis.removeProject(project.id);
        const refreshed = await window.artemis.getSnapshot();
        setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        setProjectMenuId(undefined);
        if (activeProjectId !== project.id) return;

        const nextProject = refreshed.projects[0];
        const nextThread = refreshed.threads.find(
          (thread) => thread.projectId === nextProject?.id && !thread.archived,
        );
        setActiveProjectId(nextProject?.id);
        setActiveThreadId(nextThread?.id);
        setActiveView("workspace");
        if (nextThread) {
          setMode(nextThread.mode);
        } else {
          setMode("work");
        }
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [activeProjectId, requestConfirmation, t.removeProjectConfirm, t.taskError],
  );

  const beginRenameThread = useCallback((thread: Thread) => {
    setThreadRename({ threadId: thread.id, title: thread.title });
    setThreadMenuId(undefined);
  }, []);

  const renameThread = useCallback(
    async (thread: Thread, draft: string) => {
      const title = draft.trim();
      setThreadRename(undefined);
      if (!title || title === thread.title) return;
      try {
        const updated = await window.artemis.renameThread(thread.id, title);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((item) =>
                  item.id === updated.id ? updated : item,
                ),
              }
            : current,
        );
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [t.taskError],
  );

  const copyTaskLink = async (id: string) => {
    setThreadMenuId(undefined);
    try {
      await navigator.clipboard.writeText(`artemis://thread/${id}`);
      setToast({
        success: true,
        message: uiText(locale, "Review06.copiedTaskLink"),
      });
    } catch (error) {
      setToast({ error: true, message: String(error) });
    }
  };

  const deleteThread = useCallback(
    async (thread: Thread, confirmed = false) => {
      if (deletingThreadIds.current.has(thread.id)) return false;
      if (
        !confirmed &&
        !(await requestConfirmation(t.deleteTaskConfirm, "danger"))
      )
        return false;
      if (deletingThreadIds.current.has(thread.id)) return;
      deletingThreadIds.current.add(thread.id);
      setThreadMenuId(undefined);
      if (!confirmed) setToast(uiText(locale, "App.inline1"));
      const siblingThreads = (snapshot?.threads ?? []).filter(
        (item) => item.projectId === thread.projectId && !item.archived,
      );
      const deletedIndex = siblingThreads.findIndex(
        (item) => item.id === thread.id,
      );
      try {
        await window.artemis.deleteThread(thread.id);
        const refreshed = await window.artemis.getSnapshot();
        const remainingThreads = refreshed.threads
          .filter((item) => item.id !== thread.id)
          .filter(
            (item) => item.projectId === thread.projectId && !item.archived,
          );
        const nextThread =
          remainingThreads[Math.min(deletedIndex, remainingThreads.length - 1)];
        loadedEventThreads.current.delete(thread.id);
        loadingEventThreads.current.delete(thread.id);
        threadStateCache.current.delete(thread.id);
        setComposerDrafts((current) =>
          clearComposerDraft(
            current,
            conversationDraftKey(thread.projectId, thread.id),
          ),
        );
        setPromptSubmittedAtByThread((current) => {
          if (!(thread.id in current)) return current;
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
        setWorkspaceTabsByThread((current) => {
          const next = { ...current };
          delete next[thread.id];
          return next;
        });
        setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        setToast(undefined);
        if (activeThreadId === thread.id) {
          setActiveThreadId(nextThread?.id);
          setMode(nextThread?.mode ?? "work");
          window.requestAnimationFrame(() => promptInput.current?.focus());
        }
        return true;
      } catch (error) {
        setToast({
          error: true,
          message: `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        });
        return false;
      } finally {
        deletingThreadIds.current.delete(thread.id);
        setThreadMenuId(undefined);
      }
    },
    [
      activeThreadId,
      locale,
      requestConfirmation,
      snapshot?.threads,
      t.deleteTaskConfirm,
      t.taskError,
    ],
  );

  const projectBulkBusy = useRef(false);
  const updateProjectThreads = async (
    project: Project,
    operation: "archive" | "delete",
  ) => {
    if (projectBulkBusy.current) return;
    const threads = (snapshot?.threads ?? []).filter(
      (thread) =>
        thread.projectId === project.id &&
        (operation === "delete" || !thread.archived),
    );
    if (!threads.length) return;
    const deleting = operation === "delete";
    const message = deleting
      ? uiText(locale, "App.inline2", {
          value1: project.name,
          value2: threads.length,
        })
      : uiText(locale, "App.inline3", {
          value1: project.name,
          value2: threads.length,
        });
    projectBulkBusy.current = true;
    try {
      if (
        !(await requestConfirmation(message, deleting ? "danger" : undefined))
      )
        return;
      setProjectMenuId(undefined);
      const failed: string[] = [];
      const completed = new Set<string>();
      for (const thread of threads) {
        try {
          if (deleting) await window.artemis.deleteThread(thread.id);
          else await window.artemis.archiveThread(thread.id, true);
          completed.add(thread.id);
          if (deleting) {
            loadedEventThreads.current.delete(thread.id);
            loadingEventThreads.current.delete(thread.id);
            threadStateCache.current.delete(thread.id);
            setWorkspaceTabsByThread((current) => {
              const next = { ...current };
              delete next[thread.id];
              return next;
            });
            setComposerDrafts((current) =>
              clearComposerDraft(
                current,
                conversationDraftKey(thread.projectId, thread.id),
              ),
            );
          }
        } catch (error) {
          failed.push(
            `${thread.title}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      const refreshed = await window.artemis.getSnapshot();
      setSnapshot((current) => preserveLoadedEvents(refreshed, current));
      if (activeThreadId && completed.has(activeThreadId)) {
        const next = refreshed.threads.find(
          (thread) => thread.projectId === project.id && !thread.archived,
        );
        setActiveThreadId(next?.id);
        setMode(next?.mode ?? "work");
      }
      setToast(
        failed.length
          ? {
              error: true,
              message: `${completed.size}/${threads.length} · ${failed.join("\n")}`,
            }
          : undefined,
      );
    } catch (error) {
      setToast({ error: true, message: String(error) });
    } finally {
      projectBulkBusy.current = false;
    }
  };

  const setThreadArchived = useCallback(
    async (thread: Thread, archived: boolean, bulk = false) => {
      if (archived && !(await requestConfirmation(t.archiveConfirm))) return;
      try {
        const updated = await window.artemis.archiveThread(thread.id, archived);
        const refreshed = await window.artemis.getSnapshot();
        setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        if (archived) {
          if (activeThreadId === thread.id) {
            const nextThread = refreshed.threads.find(
              (candidate) =>
                candidate.projectId === thread.projectId &&
                !candidate.archived &&
                candidate.id !== thread.id,
            );
            setActiveThreadId(nextThread?.id);
            if (nextThread) {
              setMode(nextThread.mode);
            }
          }
          setActiveView("workspace");
        } else if (!bulk) {
          setActiveView("workspace");
          setActiveProjectId(updated.projectId);
          setActiveThreadId(updated.id);
          setMode(updated.mode);
          window.requestAnimationFrame(() => promptInput.current?.focus());
        }
        return true;
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      } finally {
        setThreadMenuId(undefined);
      }
    },
    [activeThreadId, requestConfirmation, t.archiveConfirm, t.taskError],
  );

  const forkThread = useCallback(
    async (thread: Thread) => {
      try {
        const forked = await window.artemis.forkThread(thread.id);
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: [forked.thread, ...current.threads],
                worktrees: forked.worktree
                  ? [forked.worktree, ...current.worktrees]
                  : current.worktrees,
                events: {
                  ...current.events,
                  [forked.thread.id]: forked.events,
                },
              }
            : current,
        );
        setActiveView("workspace");
        setActiveProjectId(forked.thread.projectId);
        setActiveThreadId(forked.thread.id);
        setMode(forked.thread.mode);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setThreadMenuId(undefined);
      }
    },
    [t.taskError],
  );
  return {
    openProject,
    removeProject,
    beginRenameThread,
    renameThread,
    copyTaskLink,
    deleteThread,
    updateProjectThreads,
    setThreadArchived,
    forkThread,
  };
}
