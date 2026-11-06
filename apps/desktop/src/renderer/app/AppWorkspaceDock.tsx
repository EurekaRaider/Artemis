import { WorkspaceDock } from "@artemis/ui/workspace";
import { WorkspaceTabPane } from "@artemis/ui/workspace";
import { WorkspaceFilesPanel } from "../workspace/WorkspaceFilesPanel.js";
import { OfficeFilePanel } from "./feature-panels.js";
import { DesignPluginPanel } from "./feature-panels.js";
import { MarkdownReaderPanel } from "../workspace/WorkspacePreviewPanel.js";
import { WorkspaceBrowserPanel } from "../workspace/WorkspacePreviewPanel.js";
import { TerminalSurface } from "@artemis/ui/professional";
import { TerminalViewport } from "@artemis/ui/professional";
import { TerminalState } from "@artemis/ui/professional";
import { TerminalPanel } from "./feature-panels.js";
import { GoalEditorPanel } from "../conversation/GoalEditorPanel.js";
import { SourcesPanel } from "../conversation/SourcesPanel.js";
import { ReviewSurface } from "@artemis/ui/workflow";
import { ReviewWorkspace } from "@artemis/ui/workflow";
import { ReviewDiffReader } from "@artemis/ui/workflow";
import { ReviewDiff as ReviewDiffSurface } from "@artemis/ui/workflow";
import { ReviewDiffHunk } from "@artemis/ui/workflow";
import { ReviewDiffLines } from "@artemis/ui/workflow";
import { ReviewDiffLine } from "@artemis/ui/workflow";
import { HighlightedCodeLine } from "../workspace/WorkspaceFileEditor.js";
import { ReviewDiffHeader } from "@artemis/ui/workflow";
import { ReviewEmptyIcon } from "./app-icons.js";
import { ReviewState } from "@artemis/ui/workflow";
import { ReviewFileSidebar } from "@artemis/ui/workflow";
import { WorkspaceFileIcon } from "../workspace/WorkspaceFilesPanel.js";
import { ReviewToolbar } from "@artemis/ui/workflow";
import { RefreshIcon } from "./app-icons.js";
import { SegmentedControl } from "@artemis/ui/navigation";
import { WorkspaceLauncher } from "@artemis/ui/workspace";
import { WorkspaceLauncherAction } from "@artemis/ui/workspace";
import { WorkspaceLauncherIcon } from "../workspace/WorkspaceLauncherIcon.js";
import { TabScrollIcon } from "./app-icons.js";
import { WorkspaceTabBar } from "@artemis/ui/workspace";
import { WorkspaceTab as WorkspaceTabSurface } from "@artemis/ui/workspace";

import { Suspense } from "react";

import { RightSidebarIcon } from "./app-icons.js";

import { SearchIcon } from "./app-icons.js";

import { CloseIcon } from "./app-icons.js";
import { ArtemisIcon } from "@artemis/ui/icons";

import { ChildAgentPanel } from "../conversation/child-agent-panel.js";
import { AgentTeamPanel } from "../conversation/agent-team-panel.js";

import { WorkspaceTabIcon } from "./app-icons.js";
import { appCopy } from "./app-copy.js";
import {
  type ToastContent,
  type WorkspaceTabScrollState,
} from "./app-types.js";

import { type ArtifactSnapshot } from "@artemis/protocol";

import { reviewMessage } from "../../shared/i18n/review-copy.js";

import { uiText } from "../../shared/i18n/ui-text.js";

import {
  addOfficeAnnotation,
  type OfficeAnnotationReference,
} from "../office/office-annotations.js";
import {
  addDesignDocumentAttachment,
  DesignAnnotationDraft,
} from "../design/design-annotations.js";

import {
  buildWorkspaceTabMenuHtml,
  type WorkspaceTabMenuEntry,
} from "../workspace/workspace-tab-menu-html.js";

import {
  type CSSProperties,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  type AgentTeamMessageState,
  type AgentTeamState,
  type ChildAgentState,
  type PromptAttachment,
  type Thread,
  type ThreadViewState,
} from "@artemis/protocol";
import type {
  DesktopSnapshot,
  InstalledSkill,
  ReviewAction,
  ReviewComment,
  ReviewDiff,
  ReviewScope,
  SettingsSnapshot,
  WorkspaceFileLink,
} from "../../shared/api.js";
import { localeDirection } from "../../shared/i18n/locales.js";

import { filePresentation } from "../workspace/workspace-file-presentation.js";

import { appendPromptAttachments } from "../conversation/composer-drafts.js";

import { userInitials } from "./user-profile.js";

import {
  type WorkspaceTabAction,
  type WorkspaceTabKind,
  type WorkspaceTabOpenOptions,
  handleWorkspaceTabBarKeyDown,
  workspaceTabDomId,
} from "../workspace/workspace-tabs.js";

import { DEFAULT_WORKSPACE_DOCK_WIDTH } from "../workspace/workspace-dock-layout.js";

export type AppWorkspaceDockProps = {
  workspaceTabs: import("../workspace/workspace-tabs.js").WorkspaceTabsState;
  t: ReturnType<typeof appCopy>;
  closeWorkspaceTab: (
    tabId: string,
    options?: {
      moveFocus?: boolean;
    },
  ) => Promise<void>;
  dispatchWorkspaceTab: (action: WorkspaceTabAction) => void;
  activeWorkspaceTabElement: import("react").RefObject<HTMLDivElement | null>;
  workspaceTabButtons: import("react").RefObject<
    Map<string, HTMLButtonElement | null>
  >;
  workspaceDockOpen: boolean;
  toggleRightSidebar: () => void;
  workspaceDockToggleElement: import("react").RefObject<HTMLButtonElement | null>;
  workspaceTabMenuOpen: boolean;
  setWorkspaceTabMenuOpen: import("react").Dispatch<SetStateAction<boolean>>;
  activeProject:
    | {
        id: string;
        name: string;
        path: string;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  designPluginAvailable: boolean;
  locale:
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
    | "zh-TW";
  focusWorkspaceTab: (tabId: string | undefined) => void;
  workspaceTabScrollState: WorkspaceTabScrollState;
  scrollWorkspaceTabs: (direction: -1 | 1) => void;
  syncWorkspaceTabScrollState: () => void;
  handleWorkspaceTabWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  workspaceTabScroll: import("react").RefObject<HTMLDivElement | null>;
  workspaceTabTrack: import("react").RefObject<HTMLDivElement | null>;
  openReviewPanel: () => void;
  snapshot: DesktopSnapshot;
  openTerminalPanel: () => void;
  openBrowserPanel: () => void;
  openFilesPanel: () => void;
  openWorkspaceTab: (
    kind: WorkspaceTabKind,
    options?: WorkspaceTabOpenOptions,
  ) => void;
  selectReviewScope: (scope: ReviewScope) => void;
  reviewScope: "branch" | "last-turn" | "staged" | "turn" | "unstaged";
  reviewCount: (scope: ReviewScope) => number | undefined;
  setReviewBaseRef: import("react").Dispatch<SetStateAction<string>>;
  reviewDiff: ReviewDiff | undefined;
  reviewBaseRef: string;
  reviewRefreshing: boolean;
  activeThreadId: string | undefined;
  setReviewRefreshing: import("react").Dispatch<SetStateAction<boolean>>;
  refreshDiff: (force?: boolean) => Promise<ReviewDiff | undefined>;
  setToast: (content: ToastContent | undefined) => void;
  setReviewFileQuery: import("react").Dispatch<SetStateAction<string>>;
  reviewFileQuery: string;
  selectedReviewFile: import("../../shared/api.js").ReviewFile | undefined;
  setSelectedReviewFilePath: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  filteredReviewFiles: import("../../shared/api.js").ReviewFile[];
  reviewBusy: boolean;
  turnActive: boolean;
  mutateReview: (
    action: ReviewAction,
    target: {
      kind: "file" | "hunk";
      id: string;
    },
  ) => Promise<void>;
  reviewComments: ReviewComment[];
  setCommentLineId: import("react").Dispatch<
    SetStateAction<string | undefined>
  >;
  setCommentBody: import("react").Dispatch<SetStateAction<string>>;
  deleteReviewComment: (comment: ReviewComment) => Promise<void>;
  commentLineId: string | undefined;
  username: string;
  commentBody: string;
  saveReviewComment: (lineId: string) => Promise<ReviewComment | undefined>;
  busy: boolean;
  retiredGroup: "archived" | "dissolved" | undefined;
  prompt: string;
  attachments: (
    | {
        type: "attachment";
        id: string;
        kind: "file" | "image";
        name: string;
        mimeType: string;
        size: number;
        status: "error" | "pending" | "ready";
        parseStatus?: "complete" | "error" | "processing" | undefined;
        indexVersion?: number | undefined;
        error?: string | undefined;
        pages?: number | undefined;
        characters?: number | undefined;
        width?: number | undefined;
        height?: number | undefined;
        displayWidth?: number | undefined;
        displayHeight?: number | undefined;
        thumbnail?: string | undefined;
      }
    | {
        attachmentId?: string | undefined;
        name: string;
        mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
        data: string;
      }
    | {
        type: "file";
        name: string;
        mimeType: string;
        content: string;
      }
  )[];
  selectedSkills: InstalledSkill[];
  customAgentTasks: import("../conversation/composer-drafts.js").CustomAgentDraftTask[];
  sendReviewComment: (lineId: string) => Promise<void>;
  reviewUndoAvailable: boolean;
  activeThread:
    | {
        notification?:
          | {
              revision: number;
              seq: number;
              unread: boolean;
              kind?:
                | "approval-required"
                | "assigned"
                | "completed"
                | "failed"
                | "input-required"
                | undefined;
            }
          | undefined;
        id: string;
        projectId?: string | undefined;
        title: string;
        goal?:
          | {
              threadId: string;
              goalId: string;
              objective: string;
              status:
                | "active"
                | "blocked"
                | "budgetLimited"
                | "complete"
                | "paused"
                | "usageLimited";
              tokenBudget?: number | undefined;
              tokensUsed: number;
              timeUsedSeconds: number;
              revision: number;
              createdAt: string;
              updatedAt: string;
            }
          | undefined;
        mode: "codemode" | "plan" | "work";
        target: "local" | "managed-worktree" | "permanent-worktree";
        status: "failed" | "idle" | "running" | "waiting-approval";
        sessionFile?: string | undefined;
        modelSelection?:
          | {
              providerId: string;
              modelId: string;
              thinkingLevel:
                "high" | "low" | "max" | "medium" | "minimal" | "off" | "xhigh";
              ultraMode?: boolean | undefined;
            }
          | undefined;
        contextWindow?: number | undefined;
        pinned: boolean;
        archived: boolean;
        typeBinding?:
          | {
              installationId: string;
              pluginId: string;
              typeId: string;
              pluginVersion: string;
              contentHash: string;
              bindingRevision: string;
            }
          | undefined;
        executionProfile?: string | undefined;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;
  latestReviewUndoTurn: string | undefined;
  undoTurnChanges: (turnId: string) => Promise<void>;
  projectBranchActionsDisabled: boolean;
  setWorkspaceDockOpen: (update: SetStateAction<boolean>) => void;
  setEnvironmentCommitRequest: import("react").Dispatch<SetStateAction<number>>;
  reviewTransitionPending: boolean;
  environmentAgents: ChildAgentState[];
  environmentMcpUsages: import("@artemis/protocol").McpToolUsageState[];
  openConversationExternalLink: (href: string) => void;
  openChildAgentPanel: (child: ChildAgentState) => void;
  openResolvedWorkspaceFile: (file: WorkspaceFileLink) => void;
  environmentSources: import("@artemis/protocol").TaskSourceState[];
  clockMs: number;
  updateThreadInSnapshot: (updated: Thread) => void;
  runtimeSettings: SettingsSnapshot | undefined;
  setPrompt: (action: SetStateAction<string>) => void;
  addPromptAttachments: (
    response: import("../../shared/api.js").AttachmentImportResponse,
  ) => void;
  promptInput: import("react").RefObject<HTMLTextAreaElement | null>;
  latestHtmlChange:
    | {
        eventId: string;
        path: string;
      }
    | undefined;
  latestMarkdownChange:
    | {
        eventId: string;
        path: string;
      }
    | undefined;
  activeThreadIdRef: import("react").RefObject<string | undefined>;
  activeComposerDraftKey: string;
  designPanelCredentials: import("react").RefObject<
    Map<
      string,
      {
        text: string;
        credential: string;
      }
    >
  >;
  draftAttachments: import("react").RefObject<
    Map<
      string,
      (
        | {
            type: "attachment";
            id: string;
            kind: "file" | "image";
            name: string;
            mimeType: string;
            size: number;
            status: "error" | "pending" | "ready";
            parseStatus?: "complete" | "error" | "processing" | undefined;
            indexVersion?: number | undefined;
            error?: string | undefined;
            pages?: number | undefined;
            characters?: number | undefined;
            width?: number | undefined;
            height?: number | undefined;
            displayWidth?: number | undefined;
            displayHeight?: number | undefined;
            thumbnail?: string | undefined;
          }
        | {
            attachmentId?: string | undefined;
            name: string;
            mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
            data: string;
          }
        | {
            type: "file";
            name: string;
            mimeType: string;
            content: string;
          }
      )[]
    >
  >;
  setAttachments: (action: SetStateAction<PromptAttachment[]>) => void;
  designAnnotationDrafts: import("react").RefObject<
    Map<string, DesignAnnotationDraft>
  >;
  designPanelAutoSendText: import("react").RefObject<{
    draftKey: string;
    text: string;
  } | null>;
  setDesignDocBinding: import("react").Dispatch<
    SetStateAction<{
      documentId: string;
      name: string;
      html: string;
    } | null>
  >;
  threadState: ThreadViewState | undefined;
  recoverOfficeSnapshot: (next: ArtifactSnapshot) => void;
  officeAnnotationFocus:
    | (OfficeAnnotationReference & {
        threadId: string;
      })
    | undefined;
  openHtmlFromFiles: (path: string) => void;
  agentTeamControlPending: boolean;
  stopAgentTeam: (team: AgentTeamState) => Promise<void>;
  controlChildAgent: (
    child: ChildAgentState,
    action: "steer" | "cancel" | "retry",
  ) => Promise<void>;
  childAgentControlPending: string | undefined;
  workspaceDock: import("react").RefObject<HTMLElement | null>;
  workspaceDockResizing: boolean;
  workspaceDockWidth: number | undefined;
};
export function AppWorkspaceDock({
  workspaceTabs,
  t,
  closeWorkspaceTab,
  dispatchWorkspaceTab,
  activeWorkspaceTabElement,
  workspaceTabButtons,
  workspaceDockOpen,
  toggleRightSidebar,
  workspaceDockToggleElement,
  workspaceTabMenuOpen,
  setWorkspaceTabMenuOpen,
  activeProject,
  designPluginAvailable,
  locale,
  focusWorkspaceTab,
  workspaceTabScrollState,
  scrollWorkspaceTabs,
  syncWorkspaceTabScrollState,
  handleWorkspaceTabWheel,
  workspaceTabScroll,
  workspaceTabTrack,
  openReviewPanel,
  snapshot,
  openTerminalPanel,
  openBrowserPanel,
  openFilesPanel,
  openWorkspaceTab,
  selectReviewScope,
  reviewScope,
  reviewCount,
  setReviewBaseRef,
  reviewDiff,
  reviewBaseRef,
  reviewRefreshing,
  activeThreadId,
  setReviewRefreshing,
  refreshDiff,
  setToast,
  setReviewFileQuery,
  reviewFileQuery,
  selectedReviewFile,
  setSelectedReviewFilePath,
  filteredReviewFiles,
  reviewBusy,
  turnActive,
  mutateReview,
  reviewComments,
  setCommentLineId,
  setCommentBody,
  deleteReviewComment,
  commentLineId,
  username,
  commentBody,
  saveReviewComment,
  busy,
  retiredGroup,
  prompt,
  attachments,
  selectedSkills,
  customAgentTasks,
  sendReviewComment,
  reviewUndoAvailable,
  activeThread,
  latestReviewUndoTurn,
  undoTurnChanges,
  projectBranchActionsDisabled,
  setWorkspaceDockOpen,
  setEnvironmentCommitRequest,
  reviewTransitionPending,
  environmentAgents,
  environmentMcpUsages,
  openConversationExternalLink,
  openChildAgentPanel,
  openResolvedWorkspaceFile,
  environmentSources,
  clockMs,
  updateThreadInSnapshot,
  runtimeSettings,
  setPrompt,
  addPromptAttachments,
  promptInput,
  latestHtmlChange,
  latestMarkdownChange,
  activeThreadIdRef,
  activeComposerDraftKey,
  designPanelCredentials,
  draftAttachments,
  setAttachments,
  designAnnotationDrafts,
  designPanelAutoSendText,
  setDesignDocBinding,
  threadState,
  recoverOfficeSnapshot,
  officeAnnotationFocus,
  openHtmlFromFiles,
  agentTeamControlPending,
  stopAgentTeam,
  controlChildAgent,
  childAgentControlPending,
  workspaceDock,
  workspaceDockResizing,
  workspaceDockWidth,
}: AppWorkspaceDockProps) {
  return (
    <WorkspaceDock
      id="workspace-tool-dock"
      label={t.rightSidebar}
      open={workspaceDockOpen}
      ref={workspaceDock}
      resizing={workspaceDockResizing}
      style={
        {
          "--workspace-dock-width": `${workspaceDockWidth ?? DEFAULT_WORKSPACE_DOCK_WIDTH}px`,
        } as CSSProperties
      }
    >
      <WorkspaceTabBar
        add={
          <div className="workspace-tab-add-wrap">
            <button
              className="right-sidebar-toggle"
              aria-expanded={workspaceDockOpen}
              aria-label={t.rightSidebar}
              title={t.rightSidebar}
              onClick={toggleRightSidebar}
              ref={workspaceDockOpen ? workspaceDockToggleElement : undefined}
              type="button"
            >
              <RightSidebarIcon />
            </button>
            <button
              aria-expanded={workspaceTabMenuOpen}
              aria-label={t.addTab}
              className="workspace-tab-add"
              onClick={(event) => {
                // 菜单画在透明子窗口里（独立原生层，盖得住
                // 设计面板的 WebContentsView）。开着时再点
                // "+"= 关闭（原生菜单语义）。
                if (workspaceTabMenuOpen) {
                  setWorkspaceTabMenuOpen(false);
                  void window.artemis.closeWorkspaceTabMenu();
                  return;
                }
                setWorkspaceTabMenuOpen(true);
                const rect = event.currentTarget.getBoundingClientRect();
                // 设计任务一项目一份：tab 已开则不再列出，
                // 未开时选择复用既有 tab 而非新建。
                const designOpen = workspaceTabs.tabs.some(
                  (tab) => tab.kind === "design",
                );
                const entries: WorkspaceTabMenuEntry[] = [
                  ...(activeProject
                    ? [
                        {
                          kind: "review" as const,
                          label: t.reviewPanel,
                        },
                      ]
                    : []),
                  { kind: "terminal", label: t.terminal },
                  { kind: "browser", label: t.browser },
                  { kind: "file", label: t.files },
                  ...(designPluginAvailable && !designOpen
                    ? [
                        {
                          kind: "design" as const,
                          label: t.designTab,
                        },
                      ]
                    : []),
                ];
                void window.artemis.showWorkspaceTabMenu({
                  html: buildWorkspaceTabMenuHtml(entries),
                  anchorRight: rect.right,
                  anchorTop: rect.bottom + 4,
                });
              }}
              title={t.addTab}
              type="button"
            >
              <ArtemisIcon
                className="icon"
                height={14}
                name="plus"
                width={14}
              />
            </button>
          </div>
        }
        label={t.rightSidebar}
        onKeyDown={(event) =>
          handleWorkspaceTabBarKeyDown(event, {
            tabs: workspaceTabs.tabs,
            activeTabId: workspaceTabs.activeTabId,
            rtl: localeDirection(locale) === "rtl",
            activate: (tabId) =>
              dispatchWorkspaceTab({
                type: "activate",
                tabId,
              }),
            focusTab: focusWorkspaceTab,
          })
        }
        overflow={workspaceTabScrollState.hasOverflow}
        scrollEnd={
          <button
            aria-label={t.scrollTabsRight}
            disabled={!workspaceTabScrollState.canScrollRight}
            onClick={() => scrollWorkspaceTabs(1)}
            title={t.scrollTabsRight}
            type="button"
          >
            <TabScrollIcon direction="right" />
          </button>
        }
        scrollProps={{
          onScroll: syncWorkspaceTabScrollState,
          onWheel: handleWorkspaceTabWheel,
        }}
        scrollRef={workspaceTabScroll}
        scrollStart={
          <button
            aria-label={t.scrollTabsLeft}
            disabled={!workspaceTabScrollState.canScrollLeft}
            onClick={() => scrollWorkspaceTabs(-1)}
            title={t.scrollTabsLeft}
            type="button"
          >
            <TabScrollIcon direction="left" />
          </button>
        }
        trackRef={workspaceTabTrack}
      >
        {workspaceTabs.tabs.map((tab) => (
          <WorkspaceTabSurface
            active={workspaceTabs.activeTabId === tab.id}
            closeIcon={<CloseIcon />}
            closeLabel={`${t.closeTab}: ${tab.title}`}
            closeTitle={t.closeTab}
            icon={
              <WorkspaceTabIcon
                childAgentId={tab.childAgentId}
                kind={tab.kind}
                path={tab.path}
              />
            }
            id={workspaceTabDomId(tab.id)}
            key={tab.id}
            label={tab.title}
            onClose={() => closeWorkspaceTab(tab.id, { moveFocus: true })}
            onSelect={() =>
              dispatchWorkspaceTab({
                type: "activate",
                tabId: tab.id,
              })
            }
            panelId={`${workspaceTabDomId(tab.id)}-pane`}
            rootRef={
              workspaceTabs.activeTabId === tab.id
                ? activeWorkspaceTabElement
                : undefined
            }
            selectRef={(element) => {
              if (element) {
                workspaceTabButtons.current.set(tab.id, element);
              } else {
                workspaceTabButtons.current.delete(tab.id);
              }
            }}
            tabIndex={
              workspaceTabs.activeTabId === tab.id ||
              (!workspaceTabs.activeTabId &&
                workspaceTabs.tabs[0]?.id === tab.id)
                ? 0
                : -1
            }
            title={tab.path ?? tab.title}
          />
        ))}
      </WorkspaceTabBar>
      <div className="workspace-tab-content">
        {workspaceTabs.tabs.length === 0 && (
          <WorkspaceLauncher label={t.rightSidebar}>
            {activeProject && (
              <WorkspaceLauncherAction
                icon={<WorkspaceLauncherIcon kind="review" />}
                label={t.reviewPanel}
                onActivate={openReviewPanel}
                shortcut={snapshot.platform === "darwin" ? "⌘⌥B" : "Ctrl+Alt+B"}
              />
            )}
            <WorkspaceLauncherAction
              icon={<WorkspaceLauncherIcon kind="terminal" />}
              label={t.terminal}
              onActivate={openTerminalPanel}
              shortcut={snapshot.platform === "darwin" ? "⌘J" : "Ctrl+J"}
            />
            <WorkspaceLauncherAction
              icon={<WorkspaceLauncherIcon kind="browser" />}
              label={t.browser}
              onActivate={openBrowserPanel}
            />
            <WorkspaceLauncherAction
              icon={<WorkspaceLauncherIcon kind="files" />}
              label={t.files}
              onActivate={openFilesPanel}
            />
            {designPluginAvailable && (
              <WorkspaceLauncherAction
                icon={<WorkspaceLauncherIcon kind="design" />}
                label={t.designTab}
                onActivate={() => openWorkspaceTab("design")}
              />
            )}
          </WorkspaceLauncher>
        )}
        {workspaceTabs.tabs.map((tab) => (
          <WorkspaceTabPane
            active={workspaceTabs.activeTabId === tab.id}
            id={`${workspaceTabDomId(tab.id)}-pane`}
            key={tab.id}
            labelledBy={workspaceTabDomId(tab.id)}
          >
            {tab.kind === "review" && (
              <ReviewSurface
                busy={reviewTransitionPending || !reviewDiff}
                label={t.reviewPanel}
              >
                <ReviewToolbar>
                  <div className="review-comparison-primary">
                    <div className="review-scope-select">
                      <SegmentedControl<ReviewScope>
                        label={t.comparison}
                        onValueChange={selectReviewScope}
                        options={[
                          ...(reviewScope === "turn"
                            ? [
                                {
                                  value: "turn" as const,
                                  label: t.thisTurn,
                                },
                              ]
                            : []),
                          {
                            value: "last-turn",
                            label: t.lastTurn,
                            count: reviewCount("last-turn") || undefined,
                          },
                          {
                            value: "unstaged",
                            label: t.unstaged,
                            count: reviewCount("unstaged") || undefined,
                          },
                          {
                            value: "staged",
                            label: t.staged,
                            count: reviewCount("staged") || undefined,
                          },
                          { value: "branch", label: t.branch },
                        ]}
                        size="compact"
                        value={reviewScope}
                      />
                    </div>
                  </div>
                  <div className="review-comparison-route">
                    {reviewScope === "branch" ? (
                      <>
                        <label className="base-ref-field">
                          <span>{t.baseRef}</span>
                          <input
                            aria-label={t.baseRef}
                            onChange={(event) =>
                              setReviewBaseRef(event.target.value)
                            }
                            placeholder={reviewDiff?.baseRef ?? "main"}
                            value={reviewBaseRef}
                          />
                        </label>
                        <span aria-hidden="true">→</span>
                        <strong>HEAD</strong>
                      </>
                    ) : (
                      <>
                        <span>HEAD</span>
                        <span aria-hidden="true">→</span>
                        <strong>
                          {reviewScope === "unstaged"
                            ? t.unstaged
                            : reviewScope === "staged"
                              ? t.staged
                              : reviewScope === "turn"
                                ? t.thisTurn
                                : t.lastTurn}
                        </strong>
                      </>
                    )}{" "}
                    <button
                      aria-label={
                        reviewRefreshing ? t.refreshingDiff : t.refreshDiff
                      }
                      aria-busy={reviewRefreshing}
                      className="review-toolbar-action"
                      disabled={reviewRefreshing || !activeThreadId}
                      onClick={async () => {
                        setReviewRefreshing(true);
                        try {
                          const diff = await refreshDiff(true);
                          if (diff?.available) setToast(t.diffRefreshed);
                        } finally {
                          setReviewRefreshing(false);
                        }
                      }}
                      title={
                        reviewRefreshing ? t.refreshingDiff : t.refreshDiff
                      }
                      type="button"
                    >
                      <RefreshIcon />
                    </button>
                  </div>
                </ReviewToolbar>
                <ReviewWorkspace>
                  <ReviewFileSidebar label={t.changedFiles}>
                    <label className="review-file-filter">
                      <SearchIcon />
                      <input
                        aria-label={t.filterFiles}
                        onChange={(event) =>
                          setReviewFileQuery(event.target.value)
                        }
                        placeholder={t.filterFiles}
                        value={reviewFileQuery}
                      />
                    </label>
                    <div className="file-summary">
                      <span>{t.changedFiles}</span>
                      <strong>{reviewDiff?.files.length ?? 0}</strong>
                    </div>
                    <div className="review-file-list">
                      {filteredReviewFiles.map((file) => (
                        <button
                          aria-pressed={selectedReviewFile?.id === file.id}
                          className={
                            selectedReviewFile?.id === file.id
                              ? "review-file-entry selected"
                              : "review-file-entry"
                          }
                          key={file.id}
                          onClick={() => setSelectedReviewFilePath(file.path)}
                          title={file.path}
                          type="button"
                        >
                          <WorkspaceFileIcon
                            path={file.path}
                            presentation={filePresentation(file.path)}
                            symlink={false}
                          />
                          <span className="review-file-path">
                            {file.path.split(/[\\/]/).at(-1)}
                          </span>
                          <span className="review-file-stats">
                            {file.additions > 0 && (
                              <span className="addition">
                                +{file.additions}
                              </span>
                            )}
                            {file.deletions > 0 && (
                              <span className="deletion">
                                −{file.deletions}
                              </span>
                            )}
                          </span>
                          <span className="file-status">
                            {file.status === "added"
                              ? "A"
                              : file.status === "deleted"
                                ? "D"
                                : "M"}
                          </span>
                        </button>
                      ))}
                      {Boolean(
                        reviewDiff?.files.length && !filteredReviewFiles.length,
                      ) && (
                        <div className="review-file-list-empty">
                          {t.noMatchingFiles}
                        </div>
                      )}
                    </div>
                  </ReviewFileSidebar>
                  <ReviewDiffReader label={t.comparison}>
                    {!reviewDiff && (
                      <ReviewState state="loading">…</ReviewState>
                    )}
                    {reviewDiff?.available && !reviewDiff.files.length && (
                      <ReviewState state="empty">
                        <div className="review-empty-illustration">
                          <ReviewEmptyIcon />
                        </div>
                        <strong>{t.noChanges}</strong>
                        <p>{t.changesAppearHere}</p>
                      </ReviewState>
                    )}
                    {reviewDiff && !reviewDiff.available && (
                      <ReviewState state="error">
                        {reviewMessage(locale, reviewDiff.message ?? "")}
                      </ReviewState>
                    )}
                    {reviewDiff?.available && selectedReviewFile && (
                      <ReviewDiffSurface
                        data-language={
                          filePresentation(selectedReviewFile.path).language
                        }
                        key={selectedReviewFile.id}
                        state={commentLineId ? "dirty" : "selected"}
                      >
                        <ReviewDiffHeader>
                          <WorkspaceFileIcon
                            path={selectedReviewFile.path}
                            presentation={filePresentation(
                              selectedReviewFile.path,
                            )}
                            symlink={false}
                          />
                          <span className="review-file-path">
                            {selectedReviewFile.path}
                          </span>
                          <span className="review-file-stats">
                            <span className="addition">
                              +{selectedReviewFile.additions}
                            </span>
                            <span className="deletion">
                              −{selectedReviewFile.deletions}
                            </span>
                          </span>
                          <span className="file-status">
                            {selectedReviewFile.status === "added"
                              ? "A"
                              : selectedReviewFile.status === "deleted"
                                ? "D"
                                : "M"}
                          </span>
                          <span className="review-actions">
                            {reviewScope === "unstaged" && (
                              <>
                                <button
                                  className="review-action"
                                  disabled={reviewBusy || turnActive}
                                  onClick={() =>
                                    void mutateReview("stage", {
                                      kind: "file",
                                      id: selectedReviewFile.id,
                                    })
                                  }
                                >
                                  {t.stage}
                                </button>
                                <button
                                  className="review-action danger"
                                  disabled={reviewBusy || turnActive}
                                  onClick={() =>
                                    void mutateReview("revert", {
                                      kind: "file",
                                      id: selectedReviewFile.id,
                                    })
                                  }
                                >
                                  {t.revert}
                                </button>
                              </>
                            )}
                            {reviewScope === "staged" && (
                              <button
                                className="review-action"
                                disabled={reviewBusy || turnActive}
                                onClick={() =>
                                  void mutateReview("unstage", {
                                    kind: "file",
                                    id: selectedReviewFile.id,
                                  })
                                }
                              >
                                {t.unstage}
                              </button>
                            )}
                          </span>
                        </ReviewDiffHeader>
                        {selectedReviewFile.hunks.map((hunk) => (
                          <ReviewDiffHunk key={hunk.id}>
                            <div className="review-hunk">
                              <code title={hunk.header}>{hunk.header}</code>
                              <span className="review-file-stats">
                                <span className="addition">
                                  +{hunk.additions}
                                </span>
                                <span className="deletion">
                                  −{hunk.deletions}
                                </span>
                              </span>
                              <span className="review-actions">
                                {reviewScope === "unstaged" && (
                                  <>
                                    <button
                                      className="review-action"
                                      disabled={reviewBusy || turnActive}
                                      onClick={() =>
                                        void mutateReview("stage", {
                                          kind: "hunk",
                                          id: hunk.id,
                                        })
                                      }
                                    >
                                      {t.stage}
                                    </button>
                                    <button
                                      className="review-action danger"
                                      disabled={reviewBusy || turnActive}
                                      onClick={() =>
                                        void mutateReview("revert", {
                                          kind: "hunk",
                                          id: hunk.id,
                                        })
                                      }
                                    >
                                      {t.revert}
                                    </button>
                                  </>
                                )}
                                {reviewScope === "staged" && (
                                  <button
                                    className="review-action"
                                    disabled={reviewBusy || turnActive}
                                    onClick={() =>
                                      void mutateReview("unstage", {
                                        kind: "hunk",
                                        id: hunk.id,
                                      })
                                    }
                                  >
                                    {t.unstage}
                                  </button>
                                )}
                              </span>
                            </div>
                            <ReviewDiffLines>
                              {hunk.lines.map((line) => {
                                const comments = reviewComments.filter(
                                  (comment) =>
                                    comment.scope === reviewScope &&
                                    comment.lineId === line.id,
                                );
                                return (
                                  <div
                                    className="review-line-group"
                                    key={line.id}
                                  >
                                    <ReviewDiffLine
                                      data-line-id={line.id}
                                      kind={line.kind}
                                    >
                                      {reviewScope !== "turn" && (
                                        <button
                                          aria-label={t.addComment}
                                          className="review-comment-trigger"
                                          onClick={() => {
                                            setCommentLineId(line.id);
                                            setCommentBody("");
                                          }}
                                          title={t.addComment}
                                        >
                                          +
                                        </button>
                                      )}
                                      <span
                                        className="review-line-number"
                                        data-side="old"
                                      >
                                        {line.oldLine}
                                      </span>
                                      <span
                                        className="review-line-number"
                                        data-side="new"
                                      >
                                        {line.newLine}
                                      </span>
                                      <code>
                                        <HighlightedCodeLine
                                          content={line.text || " "}
                                          path={selectedReviewFile.path}
                                        />
                                      </code>
                                    </ReviewDiffLine>
                                    {comments.map((comment) => (
                                      <div
                                        className="review-comment"
                                        key={comment.id}
                                      >
                                        <p dir="auto">{comment.body}</p>
                                        <button
                                          aria-label={t.deleteComment}
                                          className="text-button danger"
                                          disabled={reviewBusy}
                                          onClick={() =>
                                            void deleteReviewComment(comment)
                                          }
                                        >
                                          {t.deleteComment}
                                        </button>
                                      </div>
                                    ))}
                                    {commentLineId === line.id && (
                                      <div className="review-comment-editor">
                                        <header className="review-comment-heading">
                                          <span
                                            className="review-comment-avatar"
                                            aria-hidden="true"
                                          >
                                            {userInitials(username)}
                                          </span>
                                          <strong>{username}</strong>
                                          {(line.newLine ?? line.oldLine) !==
                                            undefined && (
                                            <span>
                                              {uiText(
                                                locale,
                                                "Review04.commentLine",
                                                {
                                                  line:
                                                    line.newLine ??
                                                    line.oldLine ??
                                                    "",
                                                },
                                              )}
                                            </span>
                                          )}
                                        </header>
                                        <textarea
                                          aria-label={t.commentPlaceholder}
                                          autoFocus
                                          dir="auto"
                                          onChange={(event) =>
                                            setCommentBody(event.target.value)
                                          }
                                          placeholder={t.commentPlaceholder}
                                          value={commentBody}
                                        />
                                        <span>
                                          <button
                                            className="text-button"
                                            onClick={() => {
                                              setCommentLineId(undefined);
                                              setCommentBody("");
                                            }}
                                          >
                                            {t.cancelComment}
                                          </button>
                                          <button
                                            className="text-button"
                                            disabled={
                                              reviewBusy || !commentBody.trim()
                                            }
                                            onClick={() =>
                                              void saveReviewComment(line.id)
                                            }
                                          >
                                            {t.saveComment}
                                          </button>
                                          <button
                                            className="primary-button compact"
                                            disabled={
                                              reviewBusy ||
                                              busy ||
                                              Boolean(retiredGroup) ||
                                              !commentBody.trim() ||
                                              Boolean(prompt.trim()) ||
                                              attachments.length > 0 ||
                                              selectedSkills.length > 0 ||
                                              customAgentTasks.length > 0
                                            }
                                            onClick={() =>
                                              void sendReviewComment(line.id)
                                            }
                                          >
                                            {uiText(
                                              locale,
                                              "Review.sendToArtemis",
                                            )}
                                          </button>
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </ReviewDiffLines>
                          </ReviewDiffHunk>
                        ))}
                      </ReviewDiffSurface>
                    )}
                  </ReviewDiffReader>
                </ReviewWorkspace>
                <footer className="review-footer">
                  <small className="review-footer-summary">
                    {[
                      reviewCount("staged") !== undefined
                        ? `${t.staged} ${reviewCount("staged")}`
                        : undefined,
                      reviewCount("unstaged") !== undefined
                        ? `${t.unstaged} ${reviewCount("unstaged")}`
                        : undefined,
                      commentBody.trim()
                        ? uiText(locale, "Review01.pendingComments", {
                            count: 1,
                          })
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <button
                    className="secondary-button compact"
                    disabled={
                      !reviewUndoAvailable ||
                      reviewBusy ||
                      Boolean(activeThread?.archived)
                    }
                    onClick={() => {
                      if (latestReviewUndoTurn)
                        void undoTurnChanges(latestReviewUndoTurn);
                    }}
                    type="button"
                  >
                    <ArtemisIcon name="undo" width={14} height={14} />
                    {uiText(locale, "Review06.restoreSnapshot")}
                  </button>
                  <button
                    className="primary-button compact"
                    disabled={
                      !activeProject ||
                      !reviewDiff?.available ||
                      projectBranchActionsDisabled ||
                      Boolean(activeThread?.archived)
                    }
                    onClick={() => {
                      setWorkspaceDockOpen(false);
                      setEnvironmentCommitRequest((value) => value + 1);
                    }}
                    type="button"
                  >
                    <ArtemisIcon name="commit" width={14} height={14} />
                    {uiText(locale, "Review06.commit")}
                  </button>
                </footer>
              </ReviewSurface>
            )}
            {tab.kind === "sources" && activeThread && (
              <SourcesPanel
                agents={environmentAgents}
                attachments={attachments}
                locale={locale}
                mcpUsages={environmentMcpUsages}
                onOpenUrl={openConversationExternalLink}
                onOpenAgent={openChildAgentPanel}
                onOpenFile={openResolvedWorkspaceFile}
                sources={environmentSources}
                threadId={activeThread.id}
              />
            )}
            {tab.kind === "goal" && activeThread?.goal && (
              <GoalEditorPanel
                clockMs={clockMs}
                goal={activeThread.goal}
                key={activeThread.goal.goalId}
                locale={locale}
                onError={(message) => setToast({ error: true, message })}
                onSaved={updateThreadInSnapshot}
              />
            )}
            {tab.kind === "terminal" && (
              <Suspense
                fallback={
                  <TerminalSurface
                    busy
                    className="terminal-panel view-loading"
                    label={tab.title}
                    state="connecting"
                  >
                    <TerminalViewport>
                      <TerminalState state="connecting">…</TerminalState>
                    </TerminalViewport>
                  </TerminalSurface>
                }
              >
                <TerminalPanel
                  projectName={activeProject?.name}
                  onNew={() =>
                    openWorkspaceTab("terminal", {
                      forceNew: true,
                    })
                  }
                  locale={locale}
                  threadId={activeThread?.id}
                  title={tab.title}
                  emptyMessage={t.terminalLocked}
                  theme={runtimeSettings?.theme ?? "system"}
                />
              </Suspense>
            )}
            {tab.kind === "browser" && (
              <WorkspaceBrowserPanel
                tabId={tab.id}
                onEvidence={(text, image) => {
                  if (text)
                    setPrompt(
                      (current) =>
                        `${current}${current.trim() ? "\n\n" : ""}${text}`,
                    );
                  if (image)
                    addPromptAttachments([
                      { name: "browser-evidence.jpg", ...image },
                    ]);
                  window.requestAnimationFrame(() =>
                    promptInput.current?.focus(),
                  );
                }}
                key={`${activeThreadId ?? "project"}:${tab.id}`}
                addressPlaceholder={t.browserAddress}
                backLabel={t.browserBack}
                emptyMessage={t.noHtmlPreview}
                forwardLabel={t.browserForward}
                goLabel={t.browserGo}
                initialUrl={tab.url}
                locale={locale}
                path={
                  tab.url ? undefined : (tab.path ?? latestHtmlChange?.path)
                }
                refreshLabel={t.refreshPreview}
                revision={tab.revision ?? latestHtmlChange?.eventId}
                threadId={activeThreadId}
                title={tab.title}
              />
            )}
            {tab.kind === "markdown" && (
              <MarkdownReaderPanel
                editLabel={t.editFile}
                emptyMessage={t.noMarkdownPreview}
                imageFailureMessage={t.imageFailedToLoad}
                path={tab.path ?? latestMarkdownChange?.path}
                refreshLabel={t.refreshPreview}
                revision={tab.revision ?? latestMarkdownChange?.eventId}
                richLabel={t.richText}
                saveLabel={t.saveFile}
                savedLabel={t.saved}
                savingLabel={t.saving}
                sourceLabel={t.sourceText}
                threadId={activeThreadId}
                title={tab.title}
                unsavedLabel={t.unsaved}
              />
            )}
            {tab.kind === "design" && activeThreadId ? (
              designPluginAvailable ? (
                <Suspense fallback={<span>…</span>}>
                  <DesignPluginPanel
                    key={`${activeThreadId}:${tab.id}`}
                    threadId={activeThreadId}
                    panelId="workspace"
                    active={workspaceTabs.activeTabId === tab.id}
                    onCandidate={(
                      text,
                      annotations,
                      document,
                      autoSend,
                      images,
                    ) => {
                      const trimmed = text.trim();
                      if (!trimmed || !activeThreadId) return;
                      void (async () => {
                        try {
                          // Keep the credential with this draft until the host
                          // accepts the actual startTurn/followUpTurn request.
                          const accepted =
                            await window.artemis.acceptDesignPanelCandidate(
                              activeThreadId,
                              trimmed,
                            );
                          if (activeThreadIdRef.current !== activeThreadId) {
                            await window.artemis.discardDesignPanelCandidate(
                              accepted.credential,
                            );
                            return;
                          }
                          const previous = designPanelCredentials.current.get(
                            activeComposerDraftKey,
                          );
                          designPanelCredentials.current.delete(
                            activeComposerDraftKey,
                          );
                          if (previous)
                            await window.artemis
                              .discardDesignPanelCandidate(previous.credential)
                              .catch(() => undefined);
                          if (autoSend === false) {
                            await window.artemis.stageDesignPanelSend(
                              accepted.credential,
                            );
                          } else {
                            designPanelCredentials.current.set(
                              activeComposerDraftKey,
                              {
                                text: trimmed,
                                credential: accepted.credential,
                              },
                            );
                          }
                          if (document?.html.trim()) {
                            const merged = addDesignDocumentAttachment(
                              draftAttachments.current.get(
                                activeComposerDraftKey,
                              ) ?? [],
                              document,
                            );
                            if (merged) setAttachments(merged);
                          }
                          // 面板附图（OD imageAttachments）：dataURL
                          // → 裸图片附件（PromptImage，与粘贴同形）
                          if (images && images.length > 0) {
                            const imageAttachments = images.flatMap(
                              (dataUrl, index) => {
                                const match =
                                  /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(
                                    dataUrl,
                                  );
                                if (!match) return [];
                                const mime = match[1] as
                                  | "image/png"
                                  | "image/jpeg"
                                  | "image/webp"
                                  | "image/gif";
                                return [
                                  {
                                    name: `panel-image-${index + 1}.${mime === "image/jpeg" ? "jpg" : mime.slice(6)}`,
                                    mimeType: mime,
                                    data: match[2] ?? "",
                                  },
                                ];
                              },
                            );
                            const withImages = appendPromptAttachments(
                              draftAttachments.current.get(
                                activeComposerDraftKey,
                              ) ?? [],
                              imageAttachments,
                            );
                            draftAttachments.current.set(
                              activeComposerDraftKey,
                              withImages.attachments,
                            );
                            setAttachments(withImages.attachments);
                          }
                          designAnnotationDrafts.current.set(
                            activeComposerDraftKey,
                            (() => {
                              const draft =
                                designAnnotationDrafts.current.get(
                                  activeComposerDraftKey,
                                ) ?? new DesignAnnotationDraft();
                              draft.add(annotations, document ?? undefined);
                              return draft;
                            })(),
                          );
                          setPrompt(trimmed);
                          if (autoSend !== false) {
                            designPanelAutoSendText.current = {
                              draftKey: activeComposerDraftKey,
                              text: trimmed,
                            };
                          }
                          window.requestAnimationFrame(() =>
                            promptInput.current?.focus(),
                          );
                        } catch {
                          setToast({
                            error: true,
                            message: uiText(
                              locale,
                              "AppDesign.failedToAcceptTheCandidate",
                            ),
                          });
                        }
                      })();
                    }}
                    onBinding={(binding) => {
                      setDesignDocBinding(binding);
                    }}
                    failureMessage={t.designTab}
                  />
                </Suspense>
              ) : (
                <div
                  className="design-plugin-panel-disabled"
                  style={{
                    display: "flex",
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 24,
                    color: "var(--artemis-color-text-secondary, #9399b2)",
                  }}
                >
                  {uiText(locale, "AppDesign.removed")}
                </div>
              )
            ) : null}
            {tab.kind === "office" && activeThreadId && tab.path ? (
              <Suspense fallback={<span>…</span>}>
                <OfficeFilePanel
                  key={`${activeThreadId}:${tab.id}`}
                  threadId={activeThreadId}
                  path={tab.path}
                  retryLabel={t.refreshPreview}
                  onOpened={(artifactSessionId) =>
                    dispatchWorkspaceTab({
                      type: "update",
                      tabId: tab.id,
                      updates: { artifactSessionId },
                    })
                  }
                  view={
                    tab.artifactSessionId
                      ? threadState?.artifacts?.[tab.artifactSessionId]
                      : undefined
                  }
                  locale={locale}
                  onSnapshot={recoverOfficeSnapshot}
                  annotationFocus={
                    officeAnnotationFocus?.threadId === activeThreadId &&
                    officeAnnotationFocus.path === tab.path
                      ? officeAnnotationFocus.annotation
                      : undefined
                  }
                  onAnnotate={(annotation) => {
                    if (busy) return false;
                    const next = addOfficeAnnotation(
                      draftAttachments.current.get(activeComposerDraftKey) ??
                        [],
                      tab.path!,
                      annotation,
                    );
                    if (!next) {
                      setToast(t.attachmentLimit);
                      return false;
                    }
                    setAttachments(next);
                    window.requestAnimationFrame(() =>
                      promptInput.current?.focus(),
                    );
                    return true;
                  }}
                />
              </Suspense>
            ) : null}
            {tab.kind === "file" && (
              <WorkspaceFilesPanel
                locale={locale}
                onOpenOffice={(path) => openWorkspaceTab("office", { path })}
                previewLabel={t.previewFile}
                binaryMessage={t.binaryFile}
                editFileLabel={t.editFile}
                imageFailureMessage={t.imageFailedToLoad}
                filterPlaceholder={t.filterFiles}
                onFileSelected={(path) =>
                  dispatchWorkspaceTab({
                    type: "update",
                    tabId: tab.id,
                    updates: {
                      path,
                      title:
                        path.replaceAll("\\", "/").split("/").at(-1) ?? t.files,
                    },
                  })
                }
                onOpenHtml={openHtmlFromFiles}
                onOpenReader={(path) => openWorkspaceTab("markdown", { path })}
                readerLabel={t.openLinkedFile}
                openFileMessage={t.openFileFromTree}
                refreshLabel={t.refreshPreview}
                richLabel={t.richText}
                saveLabel={t.saveFile}
                savedLabel={t.saved}
                selectedPath={tab.path}
                savingLabel={t.saving}
                sourceLabel={t.sourceText}
                threadId={activeThreadId}
                title={tab.title}
                unsavedLabel={t.unsaved}
              />
            )}
            {tab.kind === "agent-team" && (
              <AgentTeamPanel
                active={workspaceTabs.activeTabId === tab.id}
                controlPending={agentTeamControlPending}
                locale={locale}
                members={Object.values(threadState?.childAgents ?? {}).filter(
                  (child) => child.teamId === tab.agentTeamId,
                )}
                messages={(threadState?.agentTeamMessageOrder ?? [])
                  .map((messageId) => threadState?.agentTeamMessages[messageId])
                  .filter((message): message is AgentTeamMessageState =>
                    Boolean(message && message.teamId === tab.agentTeamId),
                  )}
                onOpenChildAgent={openChildAgentPanel}
                onStop={(team) => void stopAgentTeam(team)}
                runtimeAvailable={turnActive}
                team={
                  tab.agentTeamId
                    ? threadState?.agentTeams[tab.agentTeamId]
                    : undefined
                }
              />
            )}
            {tab.kind === "child-agent" && (
              <ChildAgentPanel
                active={workspaceTabs.activeTabId === tab.id}
                child={
                  tab.childAgentId
                    ? threadState?.childAgents[tab.childAgentId]
                    : undefined
                }
                clockMs={clockMs}
                locale={locale}
                onControl={(child, action) =>
                  void controlChildAgent(child, action)
                }
                pendingAction={childAgentControlPending}
              />
            )}
          </WorkspaceTabPane>
        ))}
      </div>
    </WorkspaceDock>
  );
}
