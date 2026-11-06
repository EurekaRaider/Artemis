import { copy, appCopy } from "../app-copy.js";
import { type LiveChildActivity, type ToastContent } from "../app-types.js";

import { applyStreamBatch } from "../../conversation/stream-snapshot.js";

import type { WindowMaterial } from "../../../shared/window-material.js";

import { localizedTurnFailure } from "../../conversation/turn-failure.js";

import {
  useEffect,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";

import {
  type AgentEvent,
  type AgentHostEvent,
  type ApprovalPolicy,
  type RunMode,
} from "@artemis/protocol";
import type {
  DesktopSnapshot,
  InstalledArtemisPlugin,
  SettingsSnapshot,
} from "../../../shared/api.js";

import {
  conversationDraftKey,
  restoreComposerQueueItems,
  type ComposerDrafts,
} from "../../conversation/composer-drafts.js";

import {
  agentTeamWorkspaceTab,
  emptyWorkspaceTabs,
  reconcileAgentTeamWorkspaceTab,
} from "../../workspace/workspace-tabs.js";

import { type ProjectOrderPersistenceQueue } from "../project-order.js";

import {
  reduceTurnFailureNotices,
  type TurnFailureNotices,
} from "../../conversation/turn-failure-notices.js";

interface UseApplicationSubscriptionsContext {
  readonly setWindowMaterial: import("react").Dispatch<
    import("react").SetStateAction<WindowMaterial | undefined>
  >;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly setInstalledPlugins: import("react").Dispatch<
    import("react").SetStateAction<InstalledArtemisPlugin[]>
  >;
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
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
  readonly projectOrderPersistence: import("react").RefObject<
    ProjectOrderPersistenceQueue | undefined
  >;
  readonly collapsedProjectIdsPersistence: import("react").RefObject<
    ProjectOrderPersistenceQueue | undefined
  >;
  readonly collapsedProjectIdsRef: import("react").RefObject<Set<string>>;
  readonly setCollapsedProjectIds: import("react").Dispatch<
    import("react").SetStateAction<Set<string>>
  >;
  readonly collapsedProjectIdsTouched: import("react").RefObject<boolean>;
  readonly expandedProjectIdsPersistence: import("react").RefObject<
    ProjectOrderPersistenceQueue | undefined
  >;
  readonly expandedProjectIdsRef: import("react").RefObject<Set<string>>;
  readonly setExpandedProjectIds: import("react").Dispatch<
    import("react").SetStateAction<Set<string>>
  >;
  readonly expandedProjectIdsTouched: import("react").RefObject<boolean>;
  readonly setApprovalPolicy: import("react").Dispatch<
    import("react").SetStateAction<ApprovalPolicy>
  >;
  readonly setRuntimeSettings: import("react").Dispatch<
    import("react").SetStateAction<SettingsSnapshot | undefined>
  >;
  readonly setPromptHistory: import("react").Dispatch<
    import("react").SetStateAction<string[]>
  >;
  readonly pendingAgentFrame: import("react").RefObject<number | undefined>;
  readonly pendingAgentEvents: import("react").RefObject<AgentEvent[]>;
  readonly activeThreadIdRef: import("react").RefObject<string | undefined>;
  readonly reportedTurnPaints: import("react").RefObject<Set<string>>;
  readonly composerPrediction: {
    text: string | undefined;
    dismiss: () => void;
    receive: (event: AgentEvent) => void;
    keyDown: (
      event: ReactKeyboardEvent<HTMLTextAreaElement>,
      accept: (text: string) => void,
    ) => boolean;
    compositionStart: () => void;
    compositionEnd: (value: string) => void;
    changed: (value: string) => void;
  };
  readonly liveOfficeTabs: import("react").RefObject<Set<string>>;
  readonly knownAgentTeamTabs: import("react").RefObject<Set<string>>;
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
  readonly setWorkspaceTabsByThread: (
    update: SetStateAction<
      Record<
        string,
        import("../../workspace/workspace-tabs.js").WorkspaceTabsState
      >
    >,
  ) => void;
  readonly setTurnFailureNotices: import("react").Dispatch<
    import("react").SetStateAction<TurnFailureNotices>
  >;
  readonly recoveredQueueEventIds: import("react").RefObject<Set<string>>;
  readonly setComposerDrafts: import("react").Dispatch<
    import("react").SetStateAction<ComposerDrafts>
  >;
  readonly setLiveChildActivities: import("react").Dispatch<
    import("react").SetStateAction<
      Record<string, Record<string, LiveChildActivity>>
    >
  >;
}
export function useApplicationSubscriptions(
  context: UseApplicationSubscriptionsContext,
) {
  const {
    setWindowMaterial,
    setToast,
    setInstalledPlugins,
    setSnapshot,
    setActiveProjectId,
    setActiveThreadId,
    setMode,
    projectOrderPersistence,
    collapsedProjectIdsPersistence,
    collapsedProjectIdsRef,
    setCollapsedProjectIds,
    collapsedProjectIdsTouched,
    expandedProjectIdsPersistence,
    expandedProjectIdsRef,
    setExpandedProjectIds,
    expandedProjectIdsTouched,
    setApprovalPolicy,
    setRuntimeSettings,
    setPromptHistory,
    pendingAgentFrame,
    pendingAgentEvents,
    activeThreadIdRef,
    reportedTurnPaints,
    composerPrediction,
    knownAgentTeamTabs,
    localeRef,
    setWorkspaceTabsByThread,
    setTurnFailureNotices,
    recoveredQueueEventIds,
    setComposerDrafts,
    setLiveChildActivities,
  } = context;
  useEffect(() => {
    let mounted = true;
    // History capability icons need plugin metadata before the skill menu opens.
    let receivedMaterial = false;
    const unsubscribeMaterial = window.artemis.onWindowMaterialChanged?.(
      (material) => {
        receivedMaterial = true;
        setWindowMaterial(material);
      },
    );
    void window.artemis
      .listArtemisPlugins()
      .then((plugins) => {
        if (mounted) setInstalledPlugins(plugins);
      })
      .catch((error) => {
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      });
    performance.mark?.("artemis:snapshot-request");
    void window.artemis.getSnapshot().then((value) => {
      if (!mounted) return;
      performance.mark?.("artemis:snapshot-ready");
      setSnapshot(value);
      if (!receivedMaterial) setWindowMaterial(value.windowMaterial);
      const project = value.projects[0];
      setActiveProjectId(project?.id);
      setActiveThreadId(undefined);
      setMode("work");
    });
    void window.artemis
      .getSettings()
      .then((value) => {
        if (mounted) {
          projectOrderPersistence.current?.initialize(value.projectOrder ?? []);
          const persistedCollapsed = new Set(value.collapsedProjectIds ?? []);
          collapsedProjectIdsPersistence.current?.initialize([
            ...persistedCollapsed,
          ]);
          if (!collapsedProjectIdsTouched.current) {
            collapsedProjectIdsRef.current = persistedCollapsed;
            setCollapsedProjectIds(persistedCollapsed);
          }
          const persistedExpanded = new Set(value.expandedProjectIds ?? []);
          expandedProjectIdsPersistence.current?.initialize([
            ...persistedExpanded,
          ]);
          if (!expandedProjectIdsTouched.current) {
            expandedProjectIdsRef.current = persistedExpanded;
            setExpandedProjectIds(persistedExpanded);
          }
          setApprovalPolicy(value.approvalPolicy);
          setRuntimeSettings(
            collapsedProjectIdsTouched.current
              ? {
                  ...value,
                  collapsedProjectIds: [...collapsedProjectIdsRef.current],
                }
              : value,
          );
        }
      })
      .catch((error) => {
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      });
    void window.artemis
      .getPromptHistory()
      .then((history) => {
        if (mounted) {
          setPromptHistory((current) =>
            [
              ...current,
              ...history.filter((prompt) => !current.includes(prompt)),
            ].slice(0, 100),
          );
        }
      })
      .catch((error) => {
        if (mounted) {
          setToast(error instanceof Error ? error.message : String(error));
        }
      });
    const flushAgentEvents = () => {
      pendingAgentFrame.current = undefined;
      const batch = pendingAgentEvents.current.splice(0);
      if (batch.length === 0) return;
      setSnapshot((current) => {
        if (!current) return current;
        return applyStreamBatch(current, batch);
      });
      const visibleText = batch.find(
        (event) =>
          event.threadId === activeThreadIdRef.current &&
          event.turnId &&
          event.payload.type === "message.part.delta" &&
          event.payload.partType === "text" &&
          event.payload.delta.length > 0 &&
          !reportedTurnPaints.current.has(event.turnId),
      );
      if (visibleText?.turnId) {
        const turnId = visibleText.turnId;
        reportedTurnPaints.current.add(turnId);
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.artemis.reportTurnRendered(turnId, Date.now());
          });
        });
      }
    };
    const receiveAgentEvents = (events: AgentEvent[]) => {
      const finishedThreadIds = new Set<string>();
      for (const event of events) {
        composerPrediction.receive(event);
        if (
          event.payload.type === "artifact.event" &&
          event.payload.event.kind === "opened"
        ) {
          context.liveOfficeTabs.current.add(
            event.payload.event.session.sessionId,
          );
        }
        if (
          event.payload.type === "agent-team.status" &&
          !knownAgentTeamTabs.current.has(event.payload.teamId)
        ) {
          const teamStatus = event.payload;
          knownAgentTeamTabs.current.add(teamStatus.teamId);
          setWorkspaceTabsByThread((current) => ({
            ...current,
            [event.threadId]: reconcileAgentTeamWorkspaceTab(
              current[event.threadId] ?? emptyWorkspaceTabs(),
              agentTeamWorkspaceTab(
                teamStatus.teamId,
                appCopy(localeRef.current).agentTeam,
              ),
            ),
          }));
        }
        if (event.payload.type === "turn.started") {
          setTurnFailureNotices((current) =>
            reduceTurnFailureNotices(current, {
              type: "started",
              threadId: event.threadId,
            }),
          );
        }
        if (event.payload.type === "turn.failed") {
          finishedThreadIds.add(event.threadId);
          const copy = appCopy(localeRef.current);
          const message = `${copy.turnError} ${localizedTurnFailure(
            copy,
            event.payload.message,
            event.payload.code,
          )}`;
          setTurnFailureNotices((current) =>
            reduceTurnFailureNotices(current, {
              type: "failed",
              threadId: event.threadId,
              message,
            }),
          );
        }
        if (event.payload.type === "turn.completed") {
          finishedThreadIds.add(event.threadId);
        }
        if (
          event.payload.type === "queue.recovered" &&
          !recoveredQueueEventIds.current.has(event.eventId)
        ) {
          const recoveredItems =
            event.payload.items ??
            event.payload.messages.map((text) => ({ text }));
          recoveredQueueEventIds.current.add(event.eventId);
          setComposerDrafts((current) =>
            restoreComposerQueueItems(
              current,
              conversationDraftKey(undefined, event.threadId),
              recoveredItems,
            ),
          );
        }
      }
      if (finishedThreadIds.size > 0) {
        setLiveChildActivities((current) => {
          const next = { ...current };
          for (const threadId of finishedThreadIds) delete next[threadId];
          return next;
        });
      }
      pendingAgentEvents.current.push(...events);
      if (pendingAgentFrame.current === undefined) {
        pendingAgentFrame.current =
          window.requestAnimationFrame(flushAgentEvents);
      }
    };
    const unsubscribe = window.artemis.onAgentEvent((event) => {
      receiveAgentEvents([event]);
    });
    const unsubscribeBatch = window.artemis.onAgentEvents(receiveAgentEvents);
    const unsubscribeTitles = window.artemis.onThreadTitleUpdated?.(
      ({ id, title }) => {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                threads: current.threads.map((thread) =>
                  thread.id === id ? { ...thread, title } : thread,
                ),
              }
            : current,
        );
      },
    );
    const unsubscribeImTasks = window.artemis.onImTaskCreated?.((thread) => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              threads: current.threads.some(
                (candidate) => candidate.id === thread.id,
              )
                ? current.threads.map((candidate) =>
                    candidate.id === thread.id ? thread : candidate,
                  )
                : [thread, ...current.threads],
            }
          : current,
      );
    });
    const unsubscribeActivities = window.artemis.onAgentActivities(
      (events: AgentHostEvent[]) => {
        setLiveChildActivities((current) => {
          const next = { ...current };
          for (const event of events) {
            if (
              event.payload.type !== "child-agent.status" ||
              !event.payload.activityDelta
            ) {
              continue;
            }
            const threadActivities = {
              ...(next[event.threadId] ?? {}),
            };
            const previous = threadActivities[event.payload.agentId];
            threadActivities[event.payload.agentId] = {
              activity:
                `${previous?.activity ?? ""}${event.payload.activityDelta}`.slice(
                  -64 * 1024,
                ),
              payload: event.payload,
            };
            next[event.threadId] = threadActivities;
          }
          return next;
        });
      },
    );
    return () => {
      mounted = false;
      unsubscribeMaterial?.();
      unsubscribe();
      unsubscribeBatch();
      unsubscribeImTasks?.();
      unsubscribeTitles?.();
      unsubscribeActivities();
      if (pendingAgentFrame.current !== undefined) {
        window.cancelAnimationFrame(pendingAgentFrame.current);
        pendingAgentFrame.current = undefined;
      }
      pendingAgentEvents.current = [];
    };
  }, []);
  return {};
}
