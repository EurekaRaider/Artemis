import { appCopy } from "../app-copy.js";
import {
  type ConfirmationTone,
  type ToastContent,
  type ConfirmationState,
} from "../app-types.js";

import { isExecutionMode } from "@artemis/protocol";

import { GOAL_RESOURCES } from "../../../shared/i18n/goal-resources.js";
import { uiText } from "../../../shared/i18n/ui-text.js";

import { readOfficeAnnotations } from "../../office/office-annotations.js";
import {
  addDesignDocumentAttachment,
  DesignAnnotationDraft,
  buildDesignBindingHint,
} from "../../design/design-annotations.js";
import { officeAnnotationCopy } from "../../office/office-annotation-copy.js";

import { useCallback, type SetStateAction } from "react";

import {
  type ApprovalPolicy,
  type ModelSelection,
  type PromptAttachment,
  type RunMode,
  type Thread,
} from "@artemis/protocol";
import type { DesktopSnapshot, InstalledSkill } from "../../../shared/api.js";

import { parseRunModeCommand } from "../../conversation/run-mode-controls.js";
import {
  promptWithSelectedSkills,
  replaceActiveSlashCommand,
} from "../../plugins/skill-commands.js";
import {
  addPromptHistoryEntry,
  type PromptHistoryNavigation,
} from "../../conversation/prompt-history.js";

import {
  clearComposerDraft,
  conversationDraftKey,
  PromptAttachmentReadQueues,
  updateComposerDraft,
  type ComposerDraft,
  type ComposerDrafts,
} from "../../conversation/composer-drafts.js";

import { parseGoalCommand } from "../../conversation/goal-command.js";

interface UseComposerSubmissionContext {
  readonly approvalChangeLocked: boolean;
  readonly setApprovalMenuOpen: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly setApprovalPolicy: import("react").Dispatch<
    import("react").SetStateAction<ApprovalPolicy>
  >;
  readonly t: ReturnType<typeof appCopy>;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly setSnapshot: import("react").Dispatch<
    import("react").SetStateAction<DesktopSnapshot | undefined>
  >;
  readonly promptHistoryNavigation: import("react").RefObject<PromptHistoryNavigation>;
  readonly setPrompt: (action: SetStateAction<string>) => void;
  readonly setSkillMenuDismissed: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly promptInput: import("react").RefObject<HTMLTextAreaElement | null>;
  readonly setSelectedComposerSkillNames: (
    action: SetStateAction<string[]>,
  ) => void;
  readonly activeComposerDraftKey: string;
  readonly designPanelCredentials: import("react").RefObject<
    Map<
      string,
      {
        text: string;
        credential: string;
      }
    >
  >;
  readonly setPromptHistory: import("react").Dispatch<
    import("react").SetStateAction<string[]>
  >;
  readonly setCustomAgentTasks: (
    tasks: NonNullable<ComposerDraft["customAgentTasks"]>,
  ) => void;
  readonly setPromptSubmittedAtByThread: import("react").Dispatch<
    import("react").SetStateAction<Record<string, number>>
  >;
  readonly activeThread: import("@artemis/protocol").Thread | undefined;
  readonly mode: RunMode;
  readonly setMode: import("react").Dispatch<
    import("react").SetStateAction<RunMode>
  >;
  readonly turnActive: boolean;
  readonly busy: boolean;
  readonly pendingModelSelection: ModelSelection | undefined;
  readonly retiredGroup: "archived" | "dissolved" | undefined;
  readonly pendingAttachmentReads: import("react").RefObject<PromptAttachmentReadQueues>;
  readonly draftAttachments: import("react").RefObject<
    Map<string, import("@artemis/protocol").PromptAttachment[]>
  >;
  readonly designDocBindingRef: import("react").RefObject<{
    documentId: string;
    name: string;
    html: string;
  } | null>;
  readonly setAttachments: (action: SetStateAction<PromptAttachment[]>) => void;
  readonly locale: import("@artemis/protocol").AppLocale;
  readonly customAgentTasks: import("../../conversation/composer-drafts.js").CustomAgentDraftTask[];
  readonly prompt: string;
  readonly selectedSkills: InstalledSkill[];
  readonly openGoalEditor: () => void;
  readonly designAnnotationDrafts: import("react").RefObject<
    Map<string, DesignAnnotationDraft>
  >;
  readonly setCompactingThreadIds: import("react").Dispatch<
    import("react").SetStateAction<ReadonlySet<string>>
  >;
  readonly setBusy: import("react").Dispatch<SetStateAction<boolean>>;
  readonly closeGoalEditor: () => void;
  readonly createThread: (
    projectId?: string,
    preserveDraft?: boolean,
  ) => Promise<import("@artemis/protocol").Thread | undefined>;
  readonly requestConfirmation: (
    message: string,
    tone?: ConfirmationTone,
    options?: Pick<ConfirmationState, "acceptLabel" | "cancelLabel" | "title">,
  ) => Promise<boolean>;
  readonly activeComposerDraft: ComposerDraft;
  readonly setComposerDrafts: import("react").Dispatch<
    import("react").SetStateAction<ComposerDrafts>
  >;
}
export function useComposerSubmission(context: UseComposerSubmissionContext) {
  const {
    approvalChangeLocked,
    setApprovalMenuOpen,
    setApprovalPolicy,
    t,
    setToast,
    setSnapshot,
    promptHistoryNavigation,
    setPrompt,
    setSkillMenuDismissed,
    promptInput,
    setSelectedComposerSkillNames,
    activeComposerDraftKey,
    designPanelCredentials,
    setPromptHistory,
    setCustomAgentTasks,
    setPromptSubmittedAtByThread,
    activeThread,
    mode,
    setMode,
    turnActive,
    busy,
    pendingModelSelection,
    retiredGroup,
    pendingAttachmentReads,
    draftAttachments,
    designDocBindingRef,
    setAttachments,
    locale,
    customAgentTasks,
    prompt,
    selectedSkills,
    openGoalEditor,
    designAnnotationDrafts,
    setCompactingThreadIds,
    setBusy,
    closeGoalEditor,
    createThread,
    requestConfirmation,
    activeComposerDraft,
    setComposerDrafts,
  } = context;
  const changeApprovalPolicy = useCallback(
    async (policy: ApprovalPolicy) => {
      if (approvalChangeLocked) return;
      setApprovalMenuOpen(false);
      try {
        const settings = await window.artemis.setApprovalPolicy(policy);
        setApprovalPolicy(settings.approvalPolicy);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [approvalChangeLocked, t.taskError],
  );

  const updateThreadInSnapshot = useCallback((updated: Thread) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            threads: current.threads.map((thread) =>
              thread.id === updated.id ? updated : thread,
            ),
          }
        : current,
    );
  }, []);

  const selectComposerCommand = useCallback(
    (value: string) => {
      setPrompt((current) => {
        const next = replaceActiveSlashCommand(current, value);
        promptHistoryNavigation.current = { index: -1, draft: next };
        return next;
      });
      setSkillMenuDismissed(true);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [setPrompt],
  );

  const selectSkillCommand = useCallback(
    (skill: InstalledSkill) => {
      setSelectedComposerSkillNames((current) =>
        current.includes(skill.name) ? current : [...current, skill.name],
      );
      setPrompt((current) => {
        const next = replaceActiveSlashCommand(current, "").trimEnd();
        promptHistoryNavigation.current = { index: -1, draft: next };
        return next;
      });
      setSkillMenuDismissed(true);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [setPrompt, setSelectedComposerSkillNames],
  );

  const removeSelectedSkill = useCallback(
    (skillName: string) => {
      setSelectedComposerSkillNames((current) =>
        current.filter((name) => name !== skillName),
      );
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [setSelectedComposerSkillNames],
  );

  const clearSubmittedPrompt = useCallback(
    (submittedPrompt: string) => {
      const pending = designPanelCredentials.current.get(
        activeComposerDraftKey,
      );
      designPanelCredentials.current.delete(activeComposerDraftKey);
      if (pending)
        void window.artemis
          .discardDesignPanelCandidate(pending.credential)
          .catch(() => undefined);
      setPromptHistory((current) =>
        addPromptHistoryEntry(current, submittedPrompt),
      );
      promptHistoryNavigation.current = { index: -1, draft: "" };
      setPrompt("");
      setSelectedComposerSkillNames([]);
      setCustomAgentTasks([]);
    },
    [
      activeComposerDraftKey,
      setPrompt,
      setSelectedComposerSkillNames,
      setCustomAgentTasks,
    ],
  );

  const recordPromptSubmission = useCallback(
    (threadId: string, submittedAt: number) => {
      setPromptSubmittedAtByThread((current) => ({
        ...current,
        [threadId]: submittedAt,
      }));
    },
    [],
  );

  const selectMode = useCallback(
    async (nextMode: RunMode) => {
      try {
        if (isExecutionMode(mode) && !isExecutionMode(nextMode) && activeThread)
          await window.artemis.controlComputer("revoke-task", activeThread.id);
        setMode(nextMode);
        return true;
      } catch (error) {
        setToast({ error: true, message: String(error) });
        return false;
      }
    },
    [mode, activeThread],
  );

  const selectModeCommand = useCallback(
    async (nextMode: RunMode) => {
      if (turnActive || busy || !(await selectMode(nextMode))) return;
      setPrompt((current) => replaceActiveSlashCommand(current, "").trimEnd());
      setSkillMenuDismissed(true);
      window.requestAnimationFrame(() => promptInput.current?.focus());
    },
    [busy, turnActive, selectMode, setPrompt],
  );

  const sendPrompt = useCallback(async () => {
    if (busy || pendingModelSelection || retiredGroup) return;
    await pendingAttachmentReads.current.waitForIdle(activeComposerDraftKey);
    let pendingAttachments =
      draftAttachments.current.get(activeComposerDraftKey) ?? [];
    // 面板文档绑定（OD activeFileContext）：发送自动附上锁定页面，
    // 用户已手动附同名页时以手动为准。
    const activeBinding = designDocBindingRef.current;
    if (
      activeBinding?.html.trim() &&
      !pendingAttachments.some(
        (item) =>
          "type" in item &&
          item.type === "file" &&
          item.mimeType === "text/html" &&
          item.name === activeBinding.name,
      )
    ) {
      const merged = addDesignDocumentAttachment(pendingAttachments, {
        documentId: activeBinding.documentId,
        documentName: activeBinding.name,
        html: activeBinding.html,
      });
      if (merged) {
        pendingAttachments = merged;
        setAttachments(merged);
      }
    }
    if (customAgentTasks.some((task) => !task.text.trim())) {
      setToast({
        error: true,
        message: uiText(locale, "App.inline4"),
      });
      return;
    }
    const rawPrompt = prompt.trim();
    const panelCandidate = designPanelCredentials.current.get(
      activeComposerDraftKey,
    );
    const designPanelCredential =
      panelCandidate?.text === rawPrompt
        ? panelCandidate.credential
        : undefined;
    if (panelCandidate && !designPanelCredential) {
      designPanelCredentials.current.delete(activeComposerDraftKey);
      void window.artemis
        .discardDesignPanelCandidate(panelCandidate.credential)
        .catch(() => undefined);
    }
    const runModeCommand = parseRunModeCommand(rawPrompt);
    if (runModeCommand && runModeCommand.kind === "multiple") {
      setToast({ error: true, message: t.multipleModeCommands });
      return;
    }
    if (
      runModeCommand &&
      runModeCommand.kind === "command" &&
      turnActive &&
      runModeCommand.mode !== "plan"
    ) {
      setToast({ error: true, message: t.modeCommandWhileRunning });
      return;
    }
    const submittedMode =
      runModeCommand?.kind === "command" ? runModeCommand.mode : mode;
    const commandPrompt =
      runModeCommand?.kind === "command" ? runModeCommand.prompt : rawPrompt;
    // A @ sub-agent chip binds to a plain dispatch message. Control
    // commands (/plan, /goal, /compact, …) never carry one.
    if (
      customAgentTasks.length > 0 &&
      commandPrompt.trimStart().startsWith("/")
    ) {
      setToast({ error: true, message: t.customAgentControlConflict });
      return;
    }
    if (runModeCommand?.kind === "command") {
      if (turnActive && activeThread && !commandPrompt) {
        await window.artemis.cancelTurn(activeThread.id);
      }
      if ((!turnActive || !commandPrompt) && !(await selectMode(submittedMode)))
        return;
      if (
        !commandPrompt &&
        pendingAttachments.length === 0 &&
        selectedSkills.length === 0
      ) {
        clearSubmittedPrompt(rawPrompt);
        return;
      }
    }

    const compactMatch = commandPrompt.match(/^\/compact(?:\s+([\s\S]*))?$/iu);
    const compactInstructions = compactMatch?.[1]?.trim() || undefined;
    if (compactMatch && !activeThread) {
      setToast(t.compactRequiresTask);
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (compactMatch && turnActive) {
      setToast(t.compactWhileRunning);
      return;
    }
    const goalCommand = parseGoalCommand(commandPrompt, locale);
    if (goalCommand?.kind === "invalid") {
      setToast({ error: true, message: goalCommand.message });
      return;
    }
    if (goalCommand?.kind === "show") {
      setToast(
        activeThread?.goal
          ? `${t.goal}: ${activeThread.goal.objective} · ${GOAL_RESOURCES[locale][activeThread.goal.status]} · ${activeThread.goal.tokensUsed}${activeThread.goal.tokenBudget === undefined ? "" : `/${activeThread.goal.tokenBudget}`} Token`
          : t.noGoal,
      );
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (goalCommand && goalCommand.kind !== "set" && !activeThread) {
      setToast(t.noGoal);
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (goalCommand?.kind === "edit") {
      if (!activeThread?.goal) setToast(t.noGoal);
      else openGoalEditor();
      clearSubmittedPrompt(rawPrompt);
      return;
    }
    if (goalCommand?.kind === "set" && turnActive) {
      setToast({ error: true, message: t.goalSetWhileRunning });
      return;
    }

    const visibleText =
      goalCommand?.kind === "set"
        ? goalCommand.objective
        : commandPrompt ||
          (pendingAttachments.some((item) => readOfficeAnnotations(item))
            ? officeAnnotationCopy(locale).request
            : pendingAttachments.length
              ? t.inspectAttachments
              : "");
    // 设计面板批注：消息体在发送边界拼结构化 hint（OD 的
    // messageContentWithCommentAttachments 等价物），composer 只留用户文字
    const designHint = designAnnotationDrafts.current
      .get(activeComposerDraftKey)
      ?.takeForSend() ?? { hint: "" };
    // 文档绑定说明块（OD 附件信号的设计插件等价物）
    const designBindingHint = designDocBindingRef.current
      ? buildDesignBindingHint(designDocBindingRef.current)
      : "";
    const text = goalCommand
      ? visibleText
      : promptWithSelectedSkills(visibleText, selectedSkills) +
        designHint.hint +
        designBindingHint;
    if ((!text && customAgentTasks.length === 0) || busy) return;
    const submittedAt = Date.now();
    let createdThread: Thread | undefined;
    if (compactMatch && activeThread) {
      const threadId = activeThread.id;
      clearSubmittedPrompt(rawPrompt);
      setCompactingThreadIds((current) => new Set([...current, threadId]));
      try {
        await window.artemis.compactThread(threadId, compactInstructions);
      } catch (error) {
        setToast({
          error: true,
          message: `${t.compactFailed} ${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setCompactingThreadIds((current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
      }
      return;
    }
    setBusy(true);
    try {
      if (goalCommand?.kind === "pause" && activeThread) {
        const updated = await window.artemis.pauseThreadGoal(activeThread.id);
        updateThreadInSnapshot(updated);
        clearSubmittedPrompt(rawPrompt);
        return;
      }
      if (goalCommand?.kind === "resume" && activeThread) {
        const updated = await window.artemis.resumeThreadGoal(activeThread.id);
        updateThreadInSnapshot(updated);
        clearSubmittedPrompt(rawPrompt);
        return;
      }
      if (goalCommand?.kind === "clear" && activeThread) {
        const updated = await window.artemis.clearThreadGoal(activeThread.id);
        updateThreadInSnapshot(updated);
        closeGoalEditor();
        clearSubmittedPrompt(rawPrompt);
        setToast(t.goalCleared);
        return;
      }

      const thread = activeThread ?? (await createThread());
      if (!thread) return;
      if (!activeThread) createdThread = thread;
      let currentThread = thread;
      if (goalCommand?.kind === "set") {
        if (
          activeThread?.goal &&
          !(await requestConfirmation(t.goalReplaceConfirm))
        ) {
          return;
        }
        if (activeThread?.goal) {
          currentThread = await window.artemis.clearThreadGoal(thread.id);
          updateThreadInSnapshot(currentThread);
          closeGoalEditor();
        }
        currentThread = await window.artemis.setThreadGoal(
          thread.id,
          goalCommand.objective,
          goalCommand.tokenBudget,
        );
        updateThreadInSnapshot(currentThread);
        setToast(t.goalSet);
      }

      if (activeThread && turnActive && submittedMode === "plan") {
        const result = await window.artemis.revisePlan({
          threadId: currentThread.id,
          text,
          ...(pendingAttachments.length
            ? { attachments: pendingAttachments }
            : {}),
        });
        updateThreadInSnapshot(result.thread);
        setMode("plan");
        clearSubmittedPrompt(rawPrompt);
        draftAttachments.current.set(activeComposerDraftKey, []);
        setAttachments([]);
        return;
      }
      if (activeThread && turnActive) {
        // Explicit @ dispatch requires an idle thread this phase; the
        // follow-up queue has no invocation-record carriage yet.
        if (customAgentTasks.length > 0) {
          setToast({ error: true, message: t.customAgentWhileRunning });
          return;
        }
        await window.artemis.followUpTurn({
          ...(designPanelCredential ? { designPanelCredential } : {}),
          threadId: currentThread.id,
          text,
          ...(pendingAttachments.length
            ? { attachments: pendingAttachments }
            : {}),
        });
        recordPromptSubmission(currentThread.id, submittedAt);
        clearSubmittedPrompt(rawPrompt);
        draftAttachments.current.set(activeComposerDraftKey, []);
        setAttachments([]);
        return;
      }
      const result = await window.artemis.startTurn({
        ...(designPanelCredential ? { designPanelCredential } : {}),
        threadId: currentThread.id,
        text,
        mode: submittedMode,
        submittedAt,
        ...(pendingAttachments.length
          ? { attachments: pendingAttachments }
          : {}),
        // The renderer mints one invocationId per submission; IPC retries
        // of this call reuse it and the store dedups by (thread, id) +
        // content fingerprint.
        ...(customAgentTasks.length > 0
          ? {
              customAgentTasks: customAgentTasks.map((task) => ({
                definitionId: task.definitionId,
                revision: task.revision,
                invocationId: crypto.randomUUID(),
                text: task.text.trim(),
              })),
            }
          : {}),
      });
      recordPromptSubmission(currentThread.id, submittedAt);
      updateThreadInSnapshot(result.thread);
      clearSubmittedPrompt(rawPrompt);
      draftAttachments.current.set(activeComposerDraftKey, []);
      setAttachments([]);
    } catch (error) {
      if (
        panelCandidate &&
        designPanelCredentials.current.get(activeComposerDraftKey) ===
          panelCandidate
      ) {
        designPanelCredentials.current.delete(activeComposerDraftKey);
        void window.artemis
          .discardDesignPanelCandidate(panelCandidate.credential)
          .catch(() => undefined);
      }
      if (createdThread) {
        const createdDraftKey = conversationDraftKey(
          createdThread.projectId,
          createdThread.id,
        );
        setComposerDrafts((current) =>
          updateComposerDraft(
            clearComposerDraft(current, activeComposerDraftKey),
            createdDraftKey,
            () => activeComposerDraft,
          ),
        );
      }
      setToast(
        `${compactMatch ? t.compactFailed : t.taskError} ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [
    activeThread,
    activeComposerDraft,
    activeComposerDraftKey,
    locale,
    busy,
    pendingModelSelection,
    retiredGroup,
    clearSubmittedPrompt,
    closeGoalEditor,
    selectMode,
    createThread,
    customAgentTasks,
    mode,
    openGoalEditor,
    prompt,
    recordPromptSubmission,
    selectedSkills,
    t.compactFailed,
    t.compactRequiresTask,
    t.compactWhileRunning,
    t.customAgentControlConflict,
    t.customAgentWhileRunning,
    t.goal,
    t.goalCleared,
    t.goalReplaceConfirm,
    t.goalSet,
    t.goalSetWhileRunning,
    t.inspectAttachments,
    t.modeCommandWhileRunning,
    t.multipleModeCommands,
    t.noGoal,
    t.taskError,
    turnActive,
    updateThreadInSnapshot,
    requestConfirmation,
  ]);
  return {
    changeApprovalPolicy,
    updateThreadInSnapshot,
    selectComposerCommand,
    selectSkillCommand,
    removeSelectedSkill,
    selectMode,
    selectModeCommand,
    sendPrompt,
  };
}
