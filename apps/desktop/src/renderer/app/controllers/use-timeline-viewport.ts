import { type ActiveView } from "../app-types.js";

import { useEffect, useLayoutEffect } from "react";

import { reduceAgentEvents, type AgentEvent } from "@artemis/protocol";

import {
  prepareTimelineRestore,
  resolveTimelineScrollTarget,
  type TimelineScrollSnapshot,
} from "../../conversation/timeline-scroll.js";

interface UseTimelineViewportContext {
  readonly timelinePinned: import("react").RefObject<boolean>;
  readonly pendingTimelineRestore: import("react").RefObject<
    | {
        threadId: string;
        snapshot?: TimelineScrollSnapshot;
      }
    | undefined
  >;
  readonly activeThreadId: string | undefined;
  readonly activeView: ActiveView;
  readonly timelineScrollSnapshots: import("react").RefObject<
    Map<string, TimelineScrollSnapshot>
  >;
  readonly loadedEventThreads: import("react").RefObject<Set<string>>;
  readonly activeThreadIdRef: import("react").RefObject<string | undefined>;
  readonly timelineScroll: import("react").RefObject<HTMLDivElement | null>;
  readonly activeEvents: AgentEvent[];
  readonly threadState: ReturnType<typeof reduceAgentEvents> | undefined;
  readonly timelineScrollbarPointerActive: import("react").RefObject<boolean>;
}
export function useTimelineViewport(context: UseTimelineViewportContext) {
  const {
    timelinePinned,
    pendingTimelineRestore,
    activeThreadId,
    activeView,
    timelineScrollSnapshots,
    loadedEventThreads,
    activeThreadIdRef,
    timelineScroll,
    activeEvents,
    threadState,
    timelineScrollbarPointerActive,
  } = context;
  useLayoutEffect(() => {
    if (!activeThreadId || activeView !== "workspace") {
      timelinePinned.current = true;
      pendingTimelineRestore.current = undefined;
      return;
    }
    const snapshot = timelineScrollSnapshots.current.get(activeThreadId);
    timelinePinned.current = snapshot?.pinned ?? true;
    pendingTimelineRestore.current = prepareTimelineRestore(
      activeThreadId,
      activeView,
      snapshot,
    );
  }, [activeThreadId, activeView]);

  useLayoutEffect(() => {
    const pending = pendingTimelineRestore.current;
    if (
      !activeThreadId ||
      activeView !== "workspace" ||
      pending?.threadId !== activeThreadId ||
      !loadedEventThreads.current.has(activeThreadId)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (activeThreadIdRef.current !== activeThreadId) return;
      const container = timelineScroll.current;
      if (!container) return;
      timelinePinned.current = pending.snapshot?.pinned ?? true;
      pendingTimelineRestore.current = undefined;
      container.scrollTop = resolveTimelineScrollTarget({
        clientHeight: container.clientHeight,
        scrollHeight: container.scrollHeight,
        ...(pending.snapshot ? { snapshot: pending.snapshot } : {}),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeEvents.length, activeThreadId, activeView, threadState?.lastSeq]);

  useLayoutEffect(() => {
    const container = timelineScroll.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (timelinePinned.current) container.scrollTop = container.scrollHeight;
    });
    observer.observe(container);
    for (const child of container.children) observer.observe(child);
    return () => observer.disconnect();
  }, [activeEvents.length, activeThreadId]);

  useEffect(() => {
    const finishScrollbarInteraction = () => {
      timelineScrollbarPointerActive.current = false;
    };
    window.addEventListener("pointerup", finishScrollbarInteraction);
    window.addEventListener("pointercancel", finishScrollbarInteraction);
    return () => {
      window.removeEventListener("pointerup", finishScrollbarInteraction);
      window.removeEventListener("pointercancel", finishScrollbarInteraction);
    };
  }, []);

  useEffect(() => {
    if (!timelinePinned.current) return;
    const frame = window.requestAnimationFrame(() => {
      const container = timelineScroll.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [threadState?.lastSeq]);
  return {};
}
