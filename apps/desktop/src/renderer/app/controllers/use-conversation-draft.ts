import { appCopy } from "../app-copy.js";
import { type ToastContent } from "../app-types.js";

import { useComposerPrediction } from "../../conversation/useComposerPrediction.js";

import { AGENT_TEAM_LOGICAL_MAXIMUM } from "@artemis/protocol";
import { readOfficeAnnotations } from "../../office/office-annotations.js";
import { DesignAnnotationDraft } from "../../design/design-annotations.js";

import { useImMemberMentions } from "../../im/ImMemberMentions";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";

import { type PromptAttachment } from "@artemis/protocol";
import type {
  DesktopSnapshot,
  InstalledArtemisPlugin,
  InstalledSkill,
  SettingsSnapshot,
} from "../../../shared/api.js";

import { useImThreadStatus } from "../../im/ImThreadConnection.js";

import {
  promptWithoutSelectedSkills,
  selectedSkillNamesForPrompt,
} from "../../plugins/skill-commands.js";

import {
  composerDraftFor,
  conversationDraftKey,
  PromptAttachmentReadQueues,
  updateComposerDraft,
  type ComposerDraft,
  type ComposerDrafts,
  type CustomAgentDraftReference,
} from "../../conversation/composer-drafts.js";
import { useCustomAgentMention } from "../../settings/CustomAgentMention.js";

import { reduceWorkspaceTabs } from "../../workspace/workspace-tabs.js";

interface UseConversationDraftContext {
  readonly activeProjectId: string | undefined;
  readonly activeThreadId: string | undefined;
  readonly composerDrafts: ComposerDrafts;
  readonly runtimeSettings: SettingsSnapshot | undefined;
  readonly setWorkspaceTabsByThread: (
    update: SetStateAction<
      Record<
        string,
        import("../../workspace/workspace-tabs.js").WorkspaceTabsState
      >
    >,
  ) => void;
  readonly setComposerDrafts: import("react").Dispatch<
    import("react").SetStateAction<ComposerDrafts>
  >;
  readonly imThreadStatus: ReturnType<typeof useImThreadStatus>;
  readonly promptInput: import("react").RefObject<HTMLTextAreaElement | null>;
  readonly snapshot: DesktopSnapshot | undefined;
  readonly installedPlugins: InstalledArtemisPlugin[];
  readonly installedSkills: InstalledSkill[];
  readonly skillsLoading: boolean;
  readonly t: ReturnType<typeof appCopy>;
  readonly setToast: (content: ToastContent | undefined) => void;
}
export function useConversationDraft(context: UseConversationDraftContext) {
  const {
    activeProjectId,
    activeThreadId,
    composerDrafts,
    runtimeSettings,
    setWorkspaceTabsByThread,
    setComposerDrafts,
    imThreadStatus,
    promptInput,
    snapshot,
    installedPlugins,
    installedSkills,
    skillsLoading,
    t,
    setToast,
  } = context;
  const activeComposerDraftKey = conversationDraftKey(
    activeProjectId,
    activeThreadId,
  );
  const activeComposerDraft = composerDraftFor(
    composerDrafts,
    activeComposerDraftKey,
  );
  const {
    attachments,
    prompt,
    selectedSkillNames: selectedComposerSkillNames,
    customAgentTasks = [],
  } = activeComposerDraft;
  const composerPrediction = useComposerPrediction(
    activeThreadId,
    runtimeSettings?.composerPredictions ?? true,
    attachments.length > 0 ||
      selectedComposerSkillNames.length > 0 ||
      customAgentTasks.length > 0,
    prompt,
  );
  const hasOfficeAnnotations = attachments.some((item) =>
    readOfficeAnnotations(item),
  );
  const hasRegularAttachments = attachments.some(
    (item) => !readOfficeAnnotations(item),
  );
  const draftAttachments = useRef(new Map<string, PromptAttachment[]>());
  draftAttachments.current.set(activeComposerDraftKey, attachments);
  // 设计面板批注（消息体 hint 的 pending 集），随草稿隔离、发送时消费
  const designAnnotationDrafts = useRef(
    new Map<string, DesignAnnotationDraft>(),
  );
  // OD activeProjectFileName 等价物：设计面板的活动文档 tab 锁定 composer，
  // 芯片提示 + 发送自动附页；null=网格视图（解绑）。
  const [designDocBinding, setDesignDocBinding] = useState<{
    documentId: string;
    name: string;
    html: string;
  } | null>(null);
  const designDocBindingRef = useRef(designDocBinding);
  designDocBindingRef.current = designDocBinding;
  // 设计入口可见性跟随能力包：开关关闭（pack 移除）时 + 菜单/launcher 的
  // 设计入口隐藏、已开的设计 tab 关闭。初始乐观 true，首个查询即纠正。
  const [designPluginAvailable, setDesignPluginAvailable] = useState(true);
  useEffect(() => {
    void window.artemis
      .designCapabilityAvailability()
      .then((value) => setDesignPluginAvailable(value.available))
      .catch(() => {});
    return window.artemis.onDesignCapabilityAvailability((event) => {
      setDesignPluginAvailable(event.available);
      if (!event.available) {
        // 关闭插件 = 设计模式全局下线：所有线程的设计 tab 一并关闭
        // （面板视图已由主进程回收）。
        setWorkspaceTabsByThread((current) => {
          let changed = false;
          const next: typeof current = {};
          for (const [threadId, state] of Object.entries(current)) {
            const designTabs = state.tabs.filter(
              (tab) => tab.kind === "design",
            );
            if (designTabs.length === 0) {
              next[threadId] = state;
              continue;
            }
            changed = true;
            let updated = state;
            for (const tab of designTabs) {
              updated = reduceWorkspaceTabs(updated, {
                type: "close",
                tabId: tab.id,
              });
            }
            next[threadId] = updated;
          }
          return changed ? next : current;
        });
      }
    });
  }, []);
  // OD queueOnly 语义的落点：面板批注发送后自动触发发送。effect 在
  // prompt state 落地后消费此标记并调用 sendPrompt（空闲直发、运行中
  // 走 followUpTurn 排队）；置 null 表示没有待自动发送的文本。
  const designPanelAutoSendText = useRef<{
    draftKey: string;
    text: string;
  } | null>(null);
  const reviewCommentAutoSendText = useRef<{
    draftKey: string;
    text: string;
  } | null>(null);
  const designPanelCredentials = useRef(
    new Map<string, { text: string; credential: string }>(),
  );
  const pendingAttachmentReads = useRef(new PromptAttachmentReadQueues());
  const updateActiveComposerDraft = useCallback(
    (update: (current: ComposerDraft) => ComposerDraft) => {
      setComposerDrafts((current) =>
        updateComposerDraft(current, activeComposerDraftKey, update),
      );
    },
    [activeComposerDraftKey],
  );
  const setPrompt = useCallback(
    (action: SetStateAction<string>) => {
      updateActiveComposerDraft((current) => ({
        ...current,
        prompt: typeof action === "function" ? action(current.prompt) : action,
      }));
    },
    [updateActiveComposerDraft],
  );
  const groupMentions = useImMemberMentions({
    group: activeThreadId ? imThreadStatus[activeThreadId]?.group : undefined,
    text: prompt,
    setText: setPrompt,
    input: promptInput,
  });
  const [focusAgentTaskId, setFocusAgentTaskId] = useState<string>();
  const setCustomAgentTasks = useCallback(
    (tasks: NonNullable<ComposerDraft["customAgentTasks"]>) => {
      updateActiveComposerDraft((current) => ({
        ...current,
        customAgentTasks: tasks,
      }));
    },
    [updateActiveComposerDraft],
  );
  const addCustomAgentTask = (reference: CustomAgentDraftReference) => {
    const id = crypto.randomUUID();
    updateActiveComposerDraft((current) => ({
      ...current,
      customAgentTasks: [
        ...(current.customAgentTasks ?? []),
        { ...reference, id, text: "" },
      ],
    }));
    setFocusAgentTaskId(id);
  };
  const customAgentMention = useCustomAgentMention({
    definitions: runtimeSettings?.customAgents ?? [],
    projectId:
      (snapshot?.threads ?? []).find((thread) => thread.id === activeThreadId)
        ?.projectId ?? activeProjectId,
    text: prompt,
    setText: setPrompt,
    input: promptInput,
    enabled: customAgentTasks.length < AGENT_TEAM_LOGICAL_MAXIMUM,
    remaining: AGENT_TEAM_LOGICAL_MAXIMUM - customAgentTasks.length,
    members: groupMentions.open ? groupMentions : undefined,
    onSelect: addCustomAgentTask,
    plugins: {
      installed: installedPlugins,
      skills: skillsLoading ? [] : installedSkills,
      selectedNames: selectedComposerSkillNames,
      onSelect: (skill) =>
        setSelectedComposerSkillNames((current) =>
          current.includes(skill.name) ? current : [...current, skill.name],
        ),
    },
  });
  const copyConversationText = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setToast(t.messageCopied);
      } catch (error) {
        setToast({
          error: true,
          message: `${t.messageCopyFailed} ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    [t.messageCopied, t.messageCopyFailed],
  );
  const editConversationMessage = useCallback(
    (text: string) => {
      updateActiveComposerDraft(() => ({
        attachments: [],
        prompt: promptWithoutSelectedSkills(text),
        selectedSkillNames: selectedSkillNamesForPrompt(text),
      }));
      window.requestAnimationFrame(() => {
        const input = promptInput.current;
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(0, input.value.length);
      });
    },
    [updateActiveComposerDraft],
  );
  const setSelectedComposerSkillNames = useCallback(
    (action: SetStateAction<string[]>) => {
      updateActiveComposerDraft((current) => ({
        ...current,
        selectedSkillNames:
          typeof action === "function"
            ? action(current.selectedSkillNames)
            : action,
      }));
    },
    [updateActiveComposerDraft],
  );
  const setAttachments = useCallback(
    (action: SetStateAction<PromptAttachment[]>) => {
      const current =
        draftAttachments.current.get(activeComposerDraftKey) ?? [];
      const next = typeof action === "function" ? action(current) : action;
      draftAttachments.current.set(activeComposerDraftKey, next);
      updateActiveComposerDraft((current) => ({
        ...current,
        attachments: next,
      }));
    },
    [activeComposerDraftKey, updateActiveComposerDraft],
  );
  return {
    activeComposerDraftKey,
    activeComposerDraft,
    attachments,
    prompt,
    selectedComposerSkillNames,
    customAgentTasks,
    composerPrediction,
    hasOfficeAnnotations,
    hasRegularAttachments,
    draftAttachments,
    designAnnotationDrafts,
    designDocBinding,
    setDesignDocBinding,
    designDocBindingRef,
    designPluginAvailable,
    designPanelAutoSendText,
    reviewCommentAutoSendText,
    designPanelCredentials,
    pendingAttachmentReads,
    setPrompt,
    groupMentions,
    focusAgentTaskId,
    setCustomAgentTasks,
    customAgentMention,
    copyConversationText,
    editConversationMessage,
    setSelectedComposerSkillNames,
    setAttachments,
  };
}
