import { TimelineSurface } from "@artemis/ui/conversation";
import { HistoryTurn } from "./HistoryTurn.js";
import { TimelineTurn } from "@artemis/ui/conversation";
import { TurnChangeSetCard } from "./turn-change-set-card.js";
import { WorkRecord } from "./WorkRecord.js";
import { AgentActivity } from "@artemis/ui/patterns";
import { RunningArc } from "@artemis/ui/icons";
import { AgentActivityStatus } from "./WorkRecord.js";
import { ApprovalDecisionCard } from "./ApprovalDecisionCard.js";
import { UserInputCard } from "./UserInputCard.js";
import { MultiQuestionUserInputCard } from "./MultiQuestionUserInputCard.js";
import { ArtemisIcon } from "@artemis/ui/icons";
import { MarkdownContent } from "../components/MarkdownContent.js";
import { ArtemisLogo } from "@artemis/ui/icons";
import { ContextCompactionStatus } from "./context-compaction-status.js";
import { Fragment } from "react";
import { ResourceAvatar } from "../plugins/resource-icons.js";
import { EditIcon } from "../app/app-icons.js";
import { Tooltip } from "@artemis/ui/feedback";
import { CopyIcon } from "../app/app-icons.js";
import { ConversationMessage } from "@artemis/ui/conversation";
import { FileAttachment } from "../components/FileAttachment.js";
import { MessageImageAttachment } from "./MessageImageAttachment.js";
import { PlanConfirmationCard } from "./PlanConfirmationCard.js";
import { ToolActivityGroupCard } from "./tool-activity-group-card.js";

import { imUserMessageText } from "../im/im-user-message.js";
import { memberAvatarStyle } from "../im/member-avatar.js";

import { firstPendingComposerDecision } from "./DecisionComposer.js";
import { type ResolveApprovalDecision } from "./ApprovalDecisionCard.js";

import { createToolPluginResolver } from "./tool-plugin-source.js";

import { uiText } from "../../shared/i18n/ui-text.js";
import { UI_COPY } from "../../shared/i18n/ui-copy.js";

import { stripDesignAnnotationBlock } from "../design/design-annotations.js";
import { useMemo, type ReactNode } from "react";

import {
  type AgentEvent,
  type ChildAgentState,
  type ImGroupContext,
  type ThreadViewState,
  type ToolState,
  type UserInputResolution,
} from "@artemis/protocol";
import type {
  InstalledArtemisPlugin,
  InstalledSkill,
  McpServerStatus,
} from "../../shared/api.js";
import { isMultiQuestionUserInput } from "./MultiQuestionUserInputCard.js";

import { turnChangedFileCount, turnUsageLabel } from "./WorkRecord.js";
import { userMessageAttachments } from "./turn-timeline.js";
import {
  groupTimelineActivities,
  latestVisibleToolGroupKey,
} from "./tool-activity-groups.js";
import {
  promptWithoutSelectedSkills,
  selectedSkillNamesForPrompt,
} from "../plugins/skill-commands.js";
import { appCopy } from "../app/app-copy.js";

import { imChannelDisplayName } from "../app/thread-presentation.js";

import { type Locale } from "../app/app-types.js";
export function Timeline({
  events,
  imChannel,
  imGroup,
  installedPlugins,
  installedSkills,
  mcpServers,
  state,
  locale,
  onExternalLink,
  onFileLink,
  onFileLinkContextMenu,
  onOpenChildAgent,
  onOpenTurnReview,
  onCopyText,
  onFork,
  onShare,
  onEditUserMessage,
  onResolve,
  onResolveUserInput,
  onUndoTurnChanges,
}: {
  events?: readonly AgentEvent[] | undefined;
  imChannel?: string | undefined;
  imGroup?: ImGroupContext | undefined;
  installedPlugins: readonly InstalledArtemisPlugin[];
  installedSkills: readonly InstalledSkill[];
  mcpServers?: readonly McpServerStatus[] | undefined;
  state: ThreadViewState;
  locale: Locale;
  onExternalLink: (href: string) => void;
  onFileLink: (href: string) => void;
  onFileLinkContextMenu: (
    href: string,
    position: { x: number; y: number },
  ) => void;
  onOpenChildAgent: (child: ChildAgentState) => void;
  onOpenTurnReview: (turnId: string, path?: string) => void;
  onCopyText: (text: string) => Promise<void>;
  onFork?: (() => void) | undefined;
  onShare?: (() => void) | undefined;
  onEditUserMessage: ((text: string) => void) | undefined;
  onResolve: ResolveApprovalDecision;
  onResolveUserInput: (resolution: UserInputResolution) => Promise<void>;
  onUndoTurnChanges: (turnId: string) => void;
}) {
  const t = appCopy(locale);
  const messageTimestamps = useMemo(() => {
    const timestamps = new Map<string, string>();
    if (!imGroup) return timestamps;
    for (const event of events ?? []) {
      const payload = event.payload;
      const key =
        payload.type === "user.message"
          ? `user:${payload.messageId}`
          : payload.type === "message.part.delta"
            ? `part:${payload.partId}`
            : undefined;
      if (key && !timestamps.has(key)) timestamps.set(key, event.timestamp);
    }
    return timestamps;
  }, [events, imGroup]);
  const renderMessageTime = (entry: string, savedTimestamp?: string) => {
    const timestamp = savedTimestamp ?? messageTimestamps.get(entry);
    return timestamp ? (
      <time
        dateTime={timestamp}
        title={new Date(timestamp).toLocaleString(locale)}
      >
        {new Date(timestamp).toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
    ) : null;
  };

  const resolvePlugin = useMemo(
    () =>
      createToolPluginResolver(
        installedPlugins,
        mcpServers?.flatMap((server) => server.tools) ?? [],
      ),
    [installedPlugins, mcpServers],
  );
  const pluginForTool = (tool: ToolState) =>
    resolvePlugin(
      tool,
      state.entryTurnIds[`tool:${tool.id}`],
      state.mcpToolUses,
    );
  const mcpForTool = (tool: ToolState) => {
    const turnId = state.entryTurnIds[`tool:${tool.id}`];
    const usage = state.mcpToolUses[`${turnId ?? ""}\0parent\0${tool.id}`];
    const servers = mcpServers?.filter((server) =>
      usage
        ? server.config.id === usage.serverId
        : server.tools.some((registered) => registered.piName === tool.name),
    );
    return servers?.length === 1 ? servers[0]?.config : undefined;
  };
  const groupedTimeline = useMemo(() => {
    const assigned = new Set<string>();
    const turns = state.turnOrder.flatMap((turnId) => {
      const turn = state.turns[turnId];
      if (!turn) return [];
      for (const entry of turn.order) assigned.add(entry);
      return [
        {
          turn,
          entries: groupTimelineActivities(
            turn.order,
            state.tools,
            state.messageParts,
          ),
        },
      ];
    });
    return {
      turns,
      unassigned: groupTimelineActivities(
        state.order.filter((entry) => !assigned.has(entry)),
        state.tools,
        state.messageParts,
      ),
    };
  }, [
    state.order,
    state.tools,
    state.turnOrder,
    state.turns,
    state.messageParts,
  ]);
  const activeTimelineEntries = groupedTimeline.turns.findLast(
    ({ turn }) => turn.status === "running",
  )?.entries;
  const activeToolGroupKey =
    activeTimelineEntries && state.queue.steering.length === 0
      ? latestVisibleToolGroupKey(activeTimelineEntries, state.messageParts)
      : undefined;
  const childStatusLabels = UI_COPY.App_childStatusLabels[locale];
  const latestCompletedTurnId = state.turnOrder.findLast(
    (turnId) => state.turns[turnId]?.status === "completed",
  );
  const renderTimelineEntry = (
    timelineEntry: ReturnType<typeof groupTimelineActivities>[number],
    groupWorkRecord?: ReactNode,
  ): ReactNode => {
    if (timelineEntry.kind === "tool-group") {
      const tools = timelineEntry.toolIds.flatMap((toolId) => {
        const tool = state.tools[toolId];
        return tool ? [tool] : [];
      });
      return tools.length > 0 ? (
        <ToolActivityGroupCard
          active={timelineEntry.key === activeToolGroupKey}
          key={timelineEntry.key}
          locale={locale}
          onFileLink={onFileLink}
          tools={tools}
          pluginForTool={pluginForTool}
          mcpForTool={mcpForTool}
        />
      ) : null;
    }
    const entry = timelineEntry.entry;
    const separator = entry.indexOf(":");
    const kind = entry.slice(0, separator);
    const id = entry.slice(separator + 1);
    if (separator < 0 || !id) return null;
    const turn = state.turns[state.entryTurnIds[entry] ?? ""];
    if (kind === "plan") {
      const plan = state.plans?.find((p) => p.planId === id);
      return plan &&
        firstPendingComposerDecision(state)?.entry !==
          `plan:${plan.planId}:${plan.revision}` ? (
        <PlanConfirmationCard key={entry} plan={plan} locale={locale} />
      ) : null;
    }
    if (kind === "user") {
      const message = state.userMessages[id];
      if (!message) return null;
      const messageAttachments = userMessageAttachments(state, id);
      const images = messageAttachments.filter(
        (source) => source.kind === "image",
      );
      const files = messageAttachments.filter(
        (source) => source.kind === "file",
      );
      const skillNames = selectedSkillNamesForPrompt(message.text);
      // 结构化批注块是发给模型的载荷；气泡只显示用户自己的话
      // （OD 把批注渲染成附件卡片，这里是显示侧等价物）。
      const visibleText = promptWithoutSelectedSkills(
        stripDesignAnnotationBlock(imUserMessageText(message.text, imGroup)),
      );
      const imageAttachments = images.length > 0 && (
        <div className="message-attachments">
          {images.map((source) => (
            <MessageImageAttachment
              key={`${state.threadId}:${source.sourceId}`}
              threadId={state.threadId}
              sourceId={source.sourceId}
              name={source.name}
              thumbnail={source.attachment?.thumbnail}
              locale={locale}
            />
          ))}
        </div>
      );
      const editable =
        onEditUserMessage !== undefined &&
        (turn?.status === "cancelled" || turn?.status === "failed");
      return (
        <Fragment key={entry}>
          {!imGroup && imageAttachments}
          <ConversationMessage
            actions={
              <>
                <Tooltip label={t.copyMessage}>
                  <button
                    aria-label={t.copyMessage}
                    className="message-action"
                    onClick={() => void onCopyText(visibleText || message.text)}
                    type="button"
                  >
                    <CopyIcon />
                  </button>
                </Tooltip>
                {editable && (
                  <button
                    aria-label={t.editAndResend}
                    className="message-action"
                    onClick={() => onEditUserMessage(message.text)}
                    title={t.editAndResend}
                    type="button"
                  >
                    <EditIcon />
                  </button>
                )}
              </>
            }
            capabilities={
              skillNames.length > 0 ? (
                <>
                  {skillNames.map((name) => {
                    const skill = installedSkills.find(
                      (candidate) => candidate.name === name,
                    );
                    const plugin = installedPlugins.find((candidate) =>
                      candidate.skillNames.includes(name),
                    );
                    return (
                      <span className="user-message-capability" key={name}>
                        <span
                          className={`user-message-capability-icon${plugin ? " plugin-icon" : ""}`}
                        >
                          <ResourceAvatar
                            kind="skill"
                            name={name}
                            pluginName={plugin?.name}
                            iconDataUrl={plugin?.iconDataUrl}
                            brandColor={plugin?.brandColor}
                          />
                        </span>
                        <strong>{skill?.name ?? name}</strong>
                      </span>
                    );
                  })}
                </>
              ) : undefined
            }
            className="user-message"
            key={entry}
            kind="user"
          >
            {imGroup && (
              <div className="group-message-heading">
                <span
                  className="group-message-avatar"
                  aria-hidden="true"
                  style={memberAvatarStyle(imGroup.spaceId)}
                >
                  {Array.from(uiText(locale, "ImGroupMembers.message13"))[0]}
                </span>
                <strong>{uiText(locale, "ImGroupMembers.message13")}</strong>
                {imChannel && (
                  <span>{imChannelDisplayName(imChannel, locale)}</span>
                )}
                {renderMessageTime(entry, message.timestamp)}
              </div>
            )}
            {imGroup && imageAttachments}
            {files.length > 0 && (
              <div className="message-attachments">
                {files.map((source) => (
                  <FileAttachment
                    key={source.sourceId}
                    name={source.name}
                    id={source.attachment?.id}
                    threadId={state.threadId}
                    locale={locale}
                    compact
                  />
                ))}
              </div>
            )}
            {visibleText && (
              <div className="user-message-text">{visibleText}</div>
            )}
          </ConversationMessage>
        </Fragment>
      );
    }
    if (kind === "compaction") {
      const compaction = state.contextCompactions[id];
      if (!compaction) return null;
      return (
        <ContextCompactionStatus
          compaction={compaction}
          key={entry}
          locale={locale}
        />
      );
    }
    if (kind === "part") {
      const part = state.messageParts[id];
      if (!part) return null;
      if (part.type === "thinking") return null;
      return (
        <ConversationMessage
          actions={
            turn?.status !== "running" ? (
              <>
                <Tooltip label={t.copyMessage}>
                  <button
                    aria-label={t.copyMessage}
                    className="message-action"
                    onClick={() => void onCopyText(part.text)}
                    type="button"
                  >
                    <CopyIcon />
                  </button>
                </Tooltip>
                {onFork && (
                  <button
                    className="message-action"
                    aria-label={t.forkTask}
                    title={t.forkTask}
                    type="button"
                    onClick={onFork}
                  >
                    <ArtemisIcon name="fork" width={14} height={14} />
                  </button>
                )}
                {onShare && (
                  <button
                    className="message-action"
                    aria-label={uiText(locale, "Share.title")}
                    title={uiText(locale, "Share.title")}
                    type="button"
                    onClick={onShare}
                  >
                    <ArtemisIcon name="share" width={14} height={14} />
                  </button>
                )}
                {turn?.finalPartId === id && (
                  <span className="message-usage-meta">
                    {turnUsageLabel(events ?? [], turn.id, locale)}
                  </span>
                )}
              </>
            ) : undefined
          }
          className="assistant-message"
          key={entry}
          kind="assistant"
          state={turn?.status === "running" ? "streaming" : "ready"}
        >
          {imGroup && (
            <div className="group-message-heading">
              <span className="group-message-avatar">
                <ArtemisLogo size={20} />
              </span>
              <strong>Artemis</strong>
              <span className="group-agent-identity">
                {uiText(locale, "Review01.localArtemis")}
              </span>
              {renderMessageTime(entry, part.timestamp)}
            </div>
          )}
          {groupWorkRecord}
          <MarkdownContent
            fileLinkIcons
            videoThreadId={state.threadId}
            locale={locale}
            onExternalLink={onExternalLink}
            onFileLink={onFileLink}
            onFileLinkContextMenu={onFileLinkContextMenu}
            text={part.text}
          />
        </ConversationMessage>
      );
    }
    if (kind === "input") {
      const input = state.userInputs[id];
      if (!input || input.status === "pending") return null;
      if (isMultiQuestionUserInput(input)) {
        return (
          <MultiQuestionUserInputCard
            active={false}
            input={input}
            key={entry}
            locale={locale}
            onResolve={onResolveUserInput}
          />
        );
      }
      return (
        <UserInputCard
          active={false}
          input={input}
          key={entry}
          locale={locale}
          onResolve={onResolveUserInput}
        />
      );
    }
    if (kind === "approval") {
      const approval = state.approvals[id];
      if (!approval || approval.status === "pending") return null;
      return (
        <ApprovalDecisionCard
          key={entry}
          approval={approval}
          locale={locale}
          onResolve={onResolve}
          {...(approval.actorAgentId
            ? {
                actorLabel: `${t.agentActor}: ${state.childAgents[approval.actorAgentId]?.label ?? approval.actorAgentId}`,
              }
            : {})}
        />
      );
    }
    if (kind === "child") {
      const child = state.childAgents[id];
      if (child?.parentAgentId && child.parentAgentId !== "parent") {
        return null;
      }
      return child ? (
        <AgentActivity
          indicator={
            <AgentActivityStatus
              child={child}
              locale={locale}
              showIcon={false}
            />
          }
          className={`child-agent-card work-record-agent ${child.status} ${child.health ?? "healthy"}`}
          icon={
            child.status === "running" ? (
              <RunningArc size={14} />
            ) : (
              <ArtemisIcon
                width={14}
                height={14}
                name={
                  child.status === "completed"
                    ? "check"
                    : child.status === "failed"
                      ? "x-circle"
                      : child.status === "blocked"
                        ? "alert"
                        : "clock"
                }
              />
            )
          }
          key={entry}
          label={`${child.label}, ${childStatusLabels[child.status]}`}
          onActivate={() => onOpenChildAgent(child)}
          state={child.status}
          statusLabel={childStatusLabels[child.status]}
          title={
            <>
              <ArtemisIcon name="agent" width={14} height={14} />
              <span className="tool-step-verb">
                {uiText(locale, "WorkRecord.agent")}
              </span>
              <span className="tool-step-target">
                {child.label}
                {child.activity ? ` · ${child.activity}` : ""}
              </span>
            </>
          }
        />
      ) : null;
    }
    return null;
  };

  return (
    <TimelineSurface
      className="timeline"
      data-group={imGroup ? "true" : undefined}
    >
      {groupedTimeline.turns.map(({ entries, turn }, turnIndex) => (
        <HistoryTurn
          key={`${state.threadId}:${turn.id}`}
          cacheKey={`${state.threadId}:${turn.id}`}
          active={turn.status === "running"}
          initialVisible={turnIndex >= groupedTimeline.turns.length - 12}
        >
          {() => {
            if (turn.status === "running") {
              const firstExecution = entries.findIndex(
                (entry) =>
                  entry.kind !== "entry" || !entry.entry.startsWith("user:"),
              );
              const leadingUserCount =
                firstExecution < 0 ? entries.length : firstExecution;
              const runningEntries = entries.slice(leadingUserCount);
              const groupAnswer = imGroup
                ? runningEntries.findLast(
                    (entry) =>
                      entry.kind === "entry" &&
                      entry.entry.startsWith("part:") &&
                      state.messageParts[entry.entry.slice(5)]?.type === "text",
                  )
                : undefined;
              const workEntries = runningEntries.filter(
                (entry) => entry !== groupAnswer,
              );
              const workRecord = (
                <WorkRecord
                  turn={turn}
                  changedFileCount={turnChangedFileCount(events ?? [], turn)}
                  locale={locale}
                  entries={workEntries}
                  childAgents={state.childAgents}
                >
                  {workEntries.map((entry) => renderTimelineEntry(entry))}
                </WorkRecord>
              );
              return (
                <TimelineTurn
                  className="timeline-turn"
                  key={turn.id}
                  state={turn.status}
                >
                  {entries
                    .slice(0, leadingUserCount)
                    .map((entry) => renderTimelineEntry(entry))}
                  {groupAnswer
                    ? renderTimelineEntry(groupAnswer, workRecord)
                    : workRecord}
                  <TurnChangeSetCard
                    locale={locale}
                    onReview={onOpenTurnReview}
                    onUndo={onUndoTurnChanges}
                    turn={turn}
                    undoEnabled={
                      turn.id === latestCompletedTurnId &&
                      state.status === "idle" &&
                      turn.changeSet?.undoAvailable === true
                    }
                  />
                </TimelineTurn>
              );
            }
            const finalEntry = turn.finalPartId
              ? entries.find(
                  (entry) =>
                    entry.kind === "entry" &&
                    entry.entry === `part:${turn.finalPartId}`,
                )
              : entries.findLast(
                  (entry) =>
                    entry.kind === "entry" && entry.entry.startsWith("part:"),
                );
            const userEntries = entries.filter(
              (entry) =>
                entry.kind === "entry" && entry.entry.startsWith("user:"),
            );
            const planEntries = entries.filter(
              (entry) =>
                entry.kind === "entry" && entry.entry.startsWith("plan:"),
            );
            const executionEntries = entries.filter(
              (entry) =>
                entry !== finalEntry &&
                !userEntries.includes(entry) &&
                !planEntries.includes(entry),
            );
            const workRecord = (
              <WorkRecord
                turn={turn}
                changedFileCount={turnChangedFileCount(events ?? [], turn)}
                locale={locale}
                entries={executionEntries}
                childAgents={state.childAgents}
              >
                {() =>
                  executionEntries.map((entry) => renderTimelineEntry(entry))
                }
              </WorkRecord>
            );
            return (
              <TimelineTurn
                className={`timeline-turn ${turn.status}`}
                key={turn.id}
                state={turn.status}
              >
                {userEntries.map((entry) => renderTimelineEntry(entry))}
                {imGroup && finalEntry ? (
                  renderTimelineEntry(finalEntry, workRecord)
                ) : (
                  <>
                    {workRecord}
                    {finalEntry ? renderTimelineEntry(finalEntry) : null}
                  </>
                )}
                {planEntries.map((entry) => renderTimelineEntry(entry))}
                <TurnChangeSetCard
                  locale={locale}
                  onReview={onOpenTurnReview}
                  onUndo={onUndoTurnChanges}
                  turn={turn}
                  undoEnabled={
                    turn.id === latestCompletedTurnId &&
                    state.status === "idle" &&
                    turn.changeSet?.undoAvailable === true
                  }
                />
              </TimelineTurn>
            );
          }}
        </HistoryTurn>
      ))}
      {groupedTimeline.unassigned.map((entry) => renderTimelineEntry(entry))}
      {state.queue.steering.map((message, index) => (
        <ConversationMessage
          className="user-message steering-message"
          key={`steering:${index}:${message}`}
          kind="steering"
          state="queued"
        >
          {message}
        </ConversationMessage>
      ))}
    </TimelineSurface>
  );
}
