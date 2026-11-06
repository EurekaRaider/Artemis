import { appCopy } from "../app-copy.js";
import { type ToastContent } from "../app-types.js";

import { useCallback, type SetStateAction } from "react";

interface UseQueuedMessagesContext {
  readonly queuedFollowUps: string[];
  readonly activeThread: import("@artemis/protocol").Thread | undefined;
  readonly busy: boolean;
  readonly setBusy: import("react").Dispatch<SetStateAction<boolean>>;
  readonly setEditingQueuedMessage: import("react").Dispatch<
    import("react").SetStateAction<
      | {
          index: number;
          value: string;
        }
      | undefined
    >
  >;
  readonly t: ReturnType<typeof appCopy>;
  readonly setToast: (content: ToastContent | undefined) => void;
  readonly setQueuedSaveErrorDetail: import("react").Dispatch<
    import("react").SetStateAction<string | null>
  >;
}
export function useQueuedMessages(context: UseQueuedMessagesContext) {
  const {
    queuedFollowUps,
    activeThread,
    busy,
    setBusy,
    setEditingQueuedMessage,
    t,
    setToast,
    setQueuedSaveErrorDetail,
  } = context;
  const steerQueuedMessage = useCallback(
    async (index: number) => {
      const expectedText = queuedFollowUps[index];
      if (!activeThread || busy || !expectedText) return;
      setBusy(true);
      try {
        await window.artemis.steerQueuedTurn({
          threadId: activeThread.id,
          followUpIndex: index,
          expectedFollowUp: [...queuedFollowUps],
        });
        setEditingQueuedMessage(undefined);
      } catch (error) {
        setToast(
          `${t.taskError} ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [activeThread, busy, queuedFollowUps, t.taskError],
  );

  const replaceQueuedMessages = useCallback(
    async (
      followUp: Array<{ sourceIndex: number; text: string }>,
      options?: { silent?: boolean },
    ) => {
      if (!activeThread || busy) {
        setQueuedSaveErrorDetail(null);
        return false;
      }
      setBusy(true);
      try {
        await window.artemis.replaceTurnQueue({
          threadId: activeThread.id,
          expectedFollowUp: [...queuedFollowUps],
          followUp,
        });
        setEditingQueuedMessage(undefined);
        setQueuedSaveErrorDetail(null);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!options?.silent) {
          setToast(`${t.taskError} ${message}`);
        } else {
          setQueuedSaveErrorDetail(message);
        }
        return false;
      } finally {
        setBusy(false);
      }
    },
    [activeThread, busy, queuedFollowUps, t.taskError],
  );

  const deleteQueuedMessage = useCallback(
    (index: number) => {
      if (!queuedFollowUps[index]) return;
      return replaceQueuedMessages(
        queuedFollowUps.flatMap((text, sourceIndex) =>
          sourceIndex === index ? [] : [{ sourceIndex, text }],
        ),
      );
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  const moveQueuedMessageToFront = useCallback(
    (index: number) => {
      const message = queuedFollowUps[index];
      if (!message || index === 0) return;
      return replaceQueuedMessages([
        { sourceIndex: index, text: message },
        ...queuedFollowUps
          .map((text, sourceIndex) => ({ sourceIndex, text }))
          .filter((item) => item.sourceIndex !== index),
      ]);
    },
    [queuedFollowUps, replaceQueuedMessages],
  );

  const saveQueuedMessage = useCallback(
    (index: number, value: string) => {
      const message = value.trim();
      if (!message || !queuedFollowUps[index]) return;
      return replaceQueuedMessages(
        queuedFollowUps.map((text, sourceIndex) => ({
          sourceIndex,
          text: sourceIndex === index ? message : text,
        })),
        { silent: true },
      );
    },
    [queuedFollowUps, replaceQueuedMessages],
  );
  return {
    steerQueuedMessage,
    deleteQueuedMessage,
    moveQueuedMessageToFront,
    saveQueuedMessage,
  };
}
