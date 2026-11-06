import { type ToastContent } from "../app-types.js";

import { mergeThreadEvents } from "../../conversation/stream-snapshot.js";

import {
  mergeHistoryPage,
  type ThreadHistoryPage,
} from "../../../shared/thread-history.js";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  type SetStateAction,
} from "react";

import type { DesktopSnapshot } from "../../../shared/api.js";

interface UseConversationHistoryContext {
  readonly activeThreadId: string | undefined;
  readonly linkOpenedThread: import("react").RefObject<string | undefined>;
  readonly loadedEventThreads: import("react").RefObject<Set<string>>;
  readonly loadingEventThreads: import("react").RefObject<Set<string>>;
  readonly historyLoadErrors: Record<string, true>;
  readonly setHistoryLoadErrors: import("react").Dispatch<
    import("react").SetStateAction<Record<string, true>>
  >;
  readonly setHistoryPages: import("react").Dispatch<
    import("react").SetStateAction<Record<string, ThreadHistoryPage>>
  >;
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
  >;
  readonly historyRetry: number;
  readonly historyPages: Record<string, ThreadHistoryPage>;
  readonly loadingHistoryPages: import("react").RefObject<Set<string>>;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly timelineScroll: import("react").RefObject<HTMLDivElement | null>;
  readonly historyPrependAnchor: import("react").RefObject<
    { threadId: string; element: Element; top: number } | undefined
  >;
  readonly activeThreadIdRef: import("react").RefObject<string | undefined>;
}
export function useConversationHistory(context: UseConversationHistoryContext) {
  const {
    activeThreadId,
    linkOpenedThread,
    loadedEventThreads,
    loadingEventThreads,
    historyLoadErrors,
    setHistoryLoadErrors,
    setHistoryPages,
    setSnapshot,
    historyRetry,
    historyPages,
    loadingHistoryPages,
    setToast,
    timelineScroll,
    historyPrependAnchor,
    activeThreadIdRef,
  } = context;
  useEffect(() => {
    if (!activeThreadId) return;
    if (linkOpenedThread.current === activeThreadId) {
      linkOpenedThread.current = undefined;
      return;
    }
    void window.artemis.prepareThread(activeThreadId).catch(() => {
      // Starting the turn reports an actionable error if background warming failed.
    });
  }, [activeThreadId]);
  useEffect(() => {
    if (
      !activeThreadId ||
      loadedEventThreads.current.has(activeThreadId) ||
      loadingEventThreads.current.has(activeThreadId) ||
      historyLoadErrors[activeThreadId] !== undefined
    ) {
      return;
    }
    const threadId = activeThreadId;
    loadingEventThreads.current.add(threadId);
    if (window.artemis.getThreadHistory) {
      void window.artemis
        .getThreadHistory(threadId)
        .then((page) => {
          loadedEventThreads.current.add(threadId);
          setHistoryPages((current) => ({ ...current, [threadId]: page }));
          setSnapshot((current) =>
            current
              ? {
                  ...current,
                  events: {
                    ...current.events,
                    [threadId]: mergeThreadEvents(
                      page.events,
                      (current.events[threadId] ?? []).filter(
                        (event) => event.seq > page.state.lastSeq,
                      ),
                    ),
                  },
                }
              : current,
          );
        })
        .catch((error) => {
          console.error(
            "[thread-history] history page load failed",
            threadId,
            error instanceof Error ? error.message : String(error),
          );
          setHistoryLoadErrors((current) => ({
            ...current,
            [threadId]: true,
          }));
        })
        .finally(() => loadingEventThreads.current.delete(threadId));
      return;
    }
    void window.artemis
      .getThreadEvents(threadId)
      .then((history) => {
        loadedEventThreads.current.add(threadId);
        setSnapshot((current) => {
          if (!current) return current;
          return {
            ...current,
            events: {
              ...current.events,
              [threadId]: mergeThreadEvents(
                history,
                current.events[threadId] ?? [],
              ),
            },
          };
        });
      })
      .catch((error) => {
        console.error(
          "[thread-history] thread events load failed",
          threadId,
          error instanceof Error ? error.message : String(error),
        );
        setHistoryLoadErrors((current) => ({
          ...current,
          [threadId]: true,
        }));
      })
      .finally(() => {
        loadingEventThreads.current.delete(threadId);
      });
  }, [activeThreadId, historyRetry]);
  const activeHistoryPending = Boolean(
    activeThreadId && !loadedEventThreads.current.has(activeThreadId),
  );
  const activeHistoryError = activeThreadId
    ? historyLoadErrors[activeThreadId]
    : undefined;
  const activeHistory = activeThreadId
    ? historyPages[activeThreadId]
    : undefined;
  const loadEarlierHistory = useCallback(() => {
    const threadId = activeThreadId;
    const page = threadId ? historyPages[threadId] : undefined;
    if (!threadId || !page?.cursor || loadingHistoryPages.current.has(threadId))
      return;
    loadingHistoryPages.current.add(threadId);
    void window.artemis
      .getThreadHistory(threadId, page.cursor)
      .then((earlier) => {
        if (activeThreadIdRef.current === threadId) {
          const element = timelineScroll.current?.querySelector(
            "[data-history-turn]",
          );
          if (element)
            historyPrependAnchor.current = {
              threadId,
              element,
              top: element.getBoundingClientRect().top,
            };
        }
        setHistoryPages((current) =>
          current[threadId] === page
            ? { ...current, [threadId]: mergeHistoryPage(page, earlier) }
            : current,
        );
      })
      .catch((error) =>
        setToast(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => loadingHistoryPages.current.delete(threadId));
  }, [activeThreadId, historyPages]);
  useLayoutEffect(() => {
    const anchor = historyPrependAnchor.current;
    if (
      anchor &&
      anchor.threadId === activeThreadId &&
      timelineScroll.current
    ) {
      timelineScroll.current.scrollTop +=
        anchor.element.getBoundingClientRect().top - anchor.top;
      historyPrependAnchor.current = undefined;
    }
  }, [activeHistory, activeThreadId]);
  return {
    activeHistoryPending,
    activeHistoryError,
    activeHistory,
    loadEarlierHistory,
  };
}
