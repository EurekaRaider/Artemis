import { appCopy } from "../app-copy.js";
import {
  type ConfirmationTone,
  type ToastContent,
  type ConfirmationState,
} from "../app-types.js";

import { useCallback, useEffect, type SetStateAction } from "react";

import { type Thread } from "@artemis/protocol";

interface UseGoalControlContext {
  readonly activeThread: import("@artemis/protocol").Thread | undefined;
  readonly goalMutationPending: boolean;
  readonly setGoalMutationPending: import("react").Dispatch<
    SetStateAction<boolean>
  >;
  readonly updateThreadInSnapshot: (updated: Thread) => void;
  readonly closeGoalEditor: () => void;
  readonly t: ReturnType<typeof appCopy>;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly promptedGoalResumes: import("react").RefObject<Set<string>>;
  readonly requestConfirmation: (
    message: string,
    tone?: ConfirmationTone,
    options?: Pick<ConfirmationState, "acceptLabel" | "cancelLabel" | "title">,
  ) => Promise<boolean>;
}
export function useGoalControl(context: UseGoalControlContext) {
  const {
    activeThread,
    goalMutationPending,
    setGoalMutationPending,
    updateThreadInSnapshot,
    closeGoalEditor,
    t,
    setToast,
    promptedGoalResumes,
    requestConfirmation,
  } = context;
  const updateActiveGoal = useCallback(
    async (action: "pause" | "resume" | "clear") => {
      if (!activeThread || goalMutationPending) return;
      setGoalMutationPending(true);
      try {
        const updated = await (action === "pause"
          ? window.artemis.pauseThreadGoal(activeThread.id)
          : action === "resume"
            ? window.artemis.resumeThreadGoal(activeThread.id)
            : window.artemis.clearThreadGoal(activeThread.id));
        updateThreadInSnapshot(updated);
        if (action === "clear") closeGoalEditor();
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setGoalMutationPending(false);
      }
    },
    [
      activeThread,
      closeGoalEditor,
      goalMutationPending,
      t.taskError,
      updateThreadInSnapshot,
    ],
  );

  useEffect(() => {
    const goal = activeThread?.goal;
    if (!goal || !["paused", "blocked", "usageLimited"].includes(goal.status)) {
      return;
    }
    const key = `${goal.threadId}:${goal.goalId}`;
    if (promptedGoalResumes.current.has(key)) return;
    promptedGoalResumes.current.add(key);
    void requestConfirmation(t.goalResumeConfirm, "default", {
      acceptLabel: t.goalResumeAccept,
      cancelLabel: t.goalResumeLater,
      title: t.goalResumeTitle,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      setGoalMutationPending(true);
      try {
        const updated = await window.artemis.resumeThreadGoal(goal.threadId);
        updateThreadInSnapshot(updated);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setGoalMutationPending(false);
      }
    });
  }, [
    activeThread?.goal,
    requestConfirmation,
    t.goalResumeAccept,
    t.goalResumeConfirm,
    t.goalResumeLater,
    t.goalResumeTitle,
    t.taskError,
    updateThreadInSnapshot,
  ]);
  return { updateActiveGoal };
}
