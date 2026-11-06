import { type LiveChildActivity, type ActiveView } from "../app-types.js";

import { BoundedStateCache } from "../bounded-state-cache.js";

import {
  restoreArtifactSnapshot,
  type ArtifactSnapshot,
} from "@artemis/protocol";

import { type ThreadHistoryPage } from "../../../shared/thread-history.js";

import { useTaskNotificationRead } from "../../conversation/task-notification-read.js";

import { useEffect, useMemo, useRef, type SetStateAction } from "react";

import {
  reduceAgentEventBatch,
  reduceAgentEvents,
  type ChildAgentState,
  type RunMode,
  type ThreadViewState,
} from "@artemis/protocol";
import type { DesktopSnapshot } from "../../../shared/api.js";

import { sortAgentsByActivity } from "../../conversation/agent-team-tree.js";

import { promptHistoryForConversation } from "../../conversation/prompt-history.js";

import {
  emptyWorkspaceTabs,
  reconcileOfficeWorkspaceTab,
} from "../../workspace/workspace-tabs.js";

interface UseConversationStateContext {
  readonly snapshot: DesktopSnapshot | undefined;
  readonly activeThread: import("@artemis/protocol").Thread | undefined;
  readonly activeThreadId: string | undefined;
  readonly activeView: ActiveView;
  readonly loadedEventThreads: import("react").RefObject<Set<string>>;
  readonly activeHistory: ThreadHistoryPage | undefined;
  readonly workspaceDockOpen: boolean;
  readonly threadStateCache: import("react").RefObject<
    BoundedStateCache<{
      history?: ThreadHistoryPage;
      eventCount: number;
      lastEventId?: string;
      mode: RunMode;
      state: ThreadViewState;
    }>
  >;
  readonly turnWatermarks: import("react").RefObject<Map<string, number>>;
  readonly officeSnapshots: Record<string, ArtifactSnapshot>;
  readonly liveChildActivities: Record<
    string,
    Record<string, LiveChildActivity>
  >;
  readonly setWorkspaceTabsByThread: (
    update: SetStateAction<
      Record<
        string,
        import("../../workspace/workspace-tabs.js").WorkspaceTabsState
      >
    >,
  ) => void;
  readonly promptHistory: string[];
}
export function useConversationState(context: UseConversationStateContext) {
  const {
    snapshot,
    activeThread,
    activeThreadId,
    activeView,
    loadedEventThreads,
    activeHistory,
    workspaceDockOpen,
    threadStateCache,
    turnWatermarks,
    officeSnapshots,
    liveChildActivities,
    setWorkspaceTabsByThread,
    promptHistory,
  } = context;
  const activeEvents = activeThread
    ? (snapshot?.events[activeThread.id] ?? [])
    : [];
  useTaskNotificationRead(
    activeView === "workspace" &&
      activeThreadId &&
      loadedEventThreads.current.has(activeThreadId)
      ? activeThreadId
      : undefined,
    activeThread?.notification?.unread &&
      Math.max(
        activeHistory?.state.lastSeq ?? -1,
        activeEvents.at(-1)?.seq ?? -1,
      ) >= activeThread.notification.seq
      ? activeThread.notification.seq
      : undefined,
    workspaceDockOpen,
  );
  const latestHtmlChange = useMemo(() => {
    for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
      const event = activeEvents[index];
      if (
        event?.payload.type === "file.changed" &&
        /\.html?$/iu.test(event.payload.path)
      ) {
        return { eventId: event.eventId, path: event.payload.path };
      }
    }
    return undefined;
  }, [activeEvents]);
  const latestMarkdownChange = useMemo(() => {
    for (let index = activeEvents.length - 1; index >= 0; index -= 1) {
      const event = activeEvents[index];
      if (
        event?.payload.type === "file.changed" &&
        /\.(?:md|markdown)$/iu.test(event.payload.path)
      ) {
        return { eventId: event.eventId, path: event.payload.path };
      }
    }
    return undefined;
  }, [activeEvents]);
  const threadState = useMemo(() => {
    if (!activeThread) return undefined;
    const cached = threadStateCache.current.get(activeThread.id);
    const prefixMatches =
      cached &&
      cached.history === activeHistory &&
      cached.mode === activeThread.mode &&
      cached.eventCount <= activeEvents.length &&
      (cached.eventCount === 0 ||
        activeEvents[cached.eventCount - 1]?.eventId === cached.lastEventId);
    const state = prefixMatches
      ? reduceAgentEventBatch(
          cached.state,
          activeEvents
            .slice(cached.eventCount)
            .filter(
              (event) =>
                !activeHistory || event.seq > activeHistory.state.lastSeq,
            ),
        )
      : activeHistory
        ? reduceAgentEventBatch(
            activeHistory.state,
            activeEvents.filter(
              (event) => event.seq > activeHistory.state.lastSeq,
            ),
          )
        : reduceAgentEvents(activeThread.id, activeEvents, activeThread.mode);
    // Guard against cross-switch derivation regressions (blank or shrunken
    // timelines): if this thread rendered more turns before, re-derive once
    // from the raw history page + events instead of trusting the incremental
    // or cached path.
    const turnWatermark =
      cached?.history === activeHistory
        ? (turnWatermarks.current.get(activeThread.id) ?? 0)
        : 0;
    let guardedState = state;
    if (state.order.length < turnWatermark) {
      guardedState = activeHistory
        ? reduceAgentEventBatch(
            activeHistory.state,
            activeEvents.filter(
              (event) => event.seq > activeHistory.state.lastSeq,
            ),
          )
        : reduceAgentEvents(activeThread.id, activeEvents, activeThread.mode);
      if (guardedState.order.length < turnWatermark) {
        console.error(
          "[thread-history] derived turns regressed below the session watermark",
          activeThread.id,
          turnWatermark,
          guardedState.order.length,
        );
      }
    }
    turnWatermarks.current.set(
      activeThread.id,
      Math.max(turnWatermark, guardedState.order.length),
    );
    for (const recovered of Object.values(officeSnapshots)) {
      const id = recovered.session.sessionId;
      const current = guardedState.artifacts?.[id];
      if (
        current?.needsSnapshot &&
        recovered.session.sequence >= current.session.sequence
      ) {
        guardedState = {
          ...guardedState,
          artifacts: {
            ...guardedState.artifacts,
            [id]: restoreArtifactSnapshot(current, recovered),
          },
        };
      }
    }
    threadStateCache.current.delete(activeThread.id);
    threadStateCache.current.set(activeThread.id, {
      ...(activeHistory ? { history: activeHistory } : {}),
      eventCount: activeEvents.length,
      ...(activeEvents.at(-1)
        ? { lastEventId: activeEvents.at(-1)!.eventId }
        : {}),
      mode: activeThread.mode,
      state: guardedState,
    });
    const liveActivities = liveChildActivities[activeThread.id];
    if (!liveActivities) return guardedState;
    const childAgents = { ...guardedState.childAgents };
    for (const [agentId, live] of Object.entries(liveActivities)) {
      const current = childAgents[agentId];
      if (!current) continue;
      const merged: ChildAgentState = {
        ...current,
        activity: live.activity,
        ...(live.payload.health ? { health: live.payload.health } : {}),
        ...(live.payload.lastActivityAt
          ? { lastActivityAt: live.payload.lastActivityAt }
          : {}),
      };
      if (
        current.status === "queued" ||
        current.status === "running" ||
        current.status === "cancelling"
      ) {
        if (live.payload.currentTool) {
          merged.currentTool = live.payload.currentTool;
        } else {
          delete merged.currentTool;
        }
        if (live.payload.currentToolStartedAt) {
          merged.currentToolStartedAt = live.payload.currentToolStartedAt;
        } else {
          delete merged.currentToolStartedAt;
        }
      }
      childAgents[agentId] = merged;
    }
    return { ...guardedState, childAgents };
  }, [
    activeEvents,
    activeHistory,
    officeSnapshots,
    activeThread?.id,
    activeThread?.mode,
    liveChildActivities,
  ]);
  const openedOfficeTabs = useRef(new Set<string>());
  const liveOfficeTabs = useRef(new Set<string>());
  useEffect(() => {
    if (!activeThreadId || !threadState) return;
    // History pages retain artifact state but omit raw artifact presentation events.
    const sessions = Object.values(threadState.artifacts ?? {})
      .map((view) => view.session)
      .filter(
        (session) =>
          session.status !== "closed" &&
          !openedOfficeTabs.current.has(session.sessionId),
      );
    if (!sessions.length) return;
    for (const session of sessions)
      openedOfficeTabs.current.add(session.sessionId);
    setWorkspaceTabsByThread((current) => {
      let state = current[activeThreadId] ?? emptyWorkspaceTabs();
      for (const session of sessions) {
        const live = liveOfficeTabs.current.delete(session.sessionId);
        const next = reconcileOfficeWorkspaceTab(state, session, live);
        state = live && next !== state ? { ...next, dockOpen: true } : next;
      }
      return state === current[activeThreadId]
        ? current
        : { ...current, [activeThreadId]: state };
    });
  }, [activeThreadId, threadState]);
  const activePromptHistory = useMemo(() => {
    if (!threadState?.order.length) {
      return promptHistoryForConversation(promptHistory, undefined);
    }
    const conversationMessages = threadState.order.flatMap((entry) => {
      const separator = entry.indexOf(":");
      if (entry.slice(0, separator) !== "user") return [];
      const message = threadState.userMessages[entry.slice(separator + 1)];
      return message ? [message.text] : [];
    });
    return promptHistoryForConversation(promptHistory, conversationMessages);
  }, [promptHistory, threadState]);
  const latestAgentTeam = useMemo(
    () =>
      Object.values(threadState?.agentTeams ?? {})
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .at(-1),
    [threadState?.agentTeams],
  );
  const environmentAgents = useMemo(
    () => sortAgentsByActivity(Object.values(threadState?.childAgents ?? {})),
    [threadState?.childAgents],
  );
  const environmentTeams = useMemo(
    () => Object.values(threadState?.agentTeams ?? {}),
    [threadState?.agentTeams],
  );
  return {
    activeEvents,
    latestHtmlChange,
    latestMarkdownChange,
    threadState,
    liveOfficeTabs,
    activePromptHistory,
    latestAgentTeam,
    environmentAgents,
    environmentTeams,
  };
}
