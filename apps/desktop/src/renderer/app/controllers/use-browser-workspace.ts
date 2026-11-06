import { type ToastContent } from "../app-types.js";

import { preserveLoadedEvents } from "../../conversation/stream-snapshot.js";

import { uiText } from "../../../shared/i18n/ui-text.js";

import { useEffect, useState, type SetStateAction } from "react";

import type { DesktopSnapshot } from "../../../shared/api.js";

import {
  emptyWorkspaceTabs,
  reduceWorkspaceTabs,
} from "../../workspace/workspace-tabs.js";

interface UseBrowserWorkspaceContext {
  readonly setWorkspaceTabsByThread: (
    update: SetStateAction<
      Record<
        string,
        import("../../workspace/workspace-tabs.js").WorkspaceTabsState
      >
    >,
  ) => void;
  readonly openAutomationThread: (threadId: string) => Promise<void>;
  readonly activeThreadId: string | undefined;
  readonly openBrowserPanel: () => void;
  readonly locale: import("@artemis/protocol").AppLocale;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly linkOpenedThread: import("react").RefObject<string | undefined>;
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
  >;
}
export function useBrowserWorkspace(context: UseBrowserWorkspaceContext) {
  const {
    setWorkspaceTabsByThread,
    openAutomationThread,
    activeThreadId,
    openBrowserPanel,
    locale,
    setToast,
    linkOpenedThread,
    setSnapshot,
  } = context;
  const [computerBrowserThread, setComputerBrowserThread] = useState<string>();
  useEffect(
    () =>
      window.artemis.onComputerPreviewExpand?.((state) => {
        if (state.target.kind !== "browser" || !state.tabId) return;
        setWorkspaceTabsByThread((current) => {
          const existing = current[state.threadId] ?? emptyWorkspaceTabs();
          const tab = existing.tabs.find(
            (value) => value.id === state.tabId,
          ) ?? {
            id: state.tabId!,
            kind: "browser" as const,
            title: state.target.name,
          };
          return {
            ...current,
            [state.threadId]: {
              ...reduceWorkspaceTabs(existing, { type: "open", tab }),
              dockOpen: true,
            },
          };
        });
        if (state.threadId !== activeThreadId)
          void openAutomationThread(state.threadId);
      }),
    [activeThreadId, openAutomationThread],
  );
  useEffect(
    () =>
      window.artemis.onComputerBrowserOpen?.((threadId) => {
        setComputerBrowserThread(threadId);
        if (threadId !== activeThreadId) void openAutomationThread(threadId);
      }),
    [activeThreadId, openAutomationThread],
  );
  useEffect(() => {
    if (computerBrowserThread && computerBrowserThread === activeThreadId) {
      openBrowserPanel();
      setComputerBrowserThread(undefined);
    }
  }, [computerBrowserThread, activeThreadId, openBrowserPanel]);

  useEffect(
    () =>
      window.artemis.onThreadLinkOpen((id) => {
        if (id) {
          linkOpenedThread.current = id;
          void openAutomationThread(id);
        } else
          setToast({
            error: true,
            message: uiText(locale, "Review06.taskNotFound"),
          });
      }),
    [openAutomationThread, locale],
  );

  useEffect(
    () =>
      window.artemis.onAutomationThreadOpen((threadId) => {
        void openAutomationThread(threadId);
      }),
    [openAutomationThread],
  );

  useEffect(
    () =>
      window.artemis.onAutomationEvent((event) => {
        if (
          event.payload.type !== "automation-run.upserted" ||
          !event.payload.run.threadId
        ) {
          return;
        }
        void window.artemis.getSnapshot().then((refreshed) => {
          setSnapshot((current) => preserveLoadedEvents(refreshed, current));
        });
      }),
    [],
  );
  return {};
}
