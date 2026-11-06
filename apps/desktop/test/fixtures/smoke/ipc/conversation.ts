import { resolve } from "node:path";
import {
  IPC,
  type ReplaceQueuedTurnInput,
} from "../../../../src/shared/api.js";
import { store, emitPayload } from "../../../../src/main/main.js";
import { smokeMode } from "../environment.js";

export function decorateConversationIpc(
  channel: string,
  next: Parameters<import("electron").IpcMain["handle"]>[1],
) {
  const view = process.env.ARTEMIS_SMOKE_VIEW ?? "";
  if (
    channel === IPC.threadGoalObjectiveGet &&
    smokeMode &&
    view === "goal-editor-load-error"
  )
    return async (_event: Electron.IpcMainInvokeEvent, threadId: string) => {
      if (!store) throw new Error("Application store is not ready.");
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW === "goal-editor-load-error"
      ) {
        throw new Error("Simulated Goal load failure.");
      }
      return next(_event, threadId);
    };
  if (
    channel === IPC.threadGoalObjectiveUpdate &&
    smokeMode &&
    ["goal-editor-save-error", "goal-editor-saving"].includes(view)
  )
    return async (
      _event: Electron.IpcMainInvokeEvent,
      threadId: string,
      objective: string,
      expectedGoalId: string,
      expectedRevision: number,
    ) => {
      if (!store) throw new Error("Application store is not ready.");
      const smokeView = smokeMode ? process.env.ARTEMIS_SMOKE_VIEW : undefined;
      if (smokeView === "goal-editor-save-error") {
        throw new Error("Simulated Goal save failure.");
      }
      if (smokeView === "goal-editor-saving") {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      return next(
        _event,
        threadId,
        objective,
        expectedGoalId,
        expectedRevision,
      );
    };
  if (
    channel === IPC.turnQueueReplace &&
    smokeMode &&
    view.startsWith("queued-steer")
  )
    return async (
      _event: Electron.IpcMainInvokeEvent,
      input: ReplaceQueuedTurnInput,
    ) => {
      if (
        smokeMode &&
        process.env.ARTEMIS_SMOKE_VIEW?.startsWith("queued-steer")
      ) {
        if (process.env.ARTEMIS_SMOKE_VIEW === "queued-steer-save-error") {
          throw new Error("Simulated queued message save failure.");
        }
        emitPayload(input.threadId, undefined, {
          type: "queue.updated",
          steering: [],
          followUp: input.expectedFollowUp.map(
            (text, index) =>
              input.followUp.find((item) => item.sourceIndex === index)?.text ??
              text,
          ),
        });
        // The runtime applies the queue change, emits queue.updated, and only
        // then acknowledges the request. Mirror that order and give the
        // renderer's rAF-batched event flush time to commit the new queue
        // before the acknowledgment closes the editor, so the focus-return
        // target is the final row rather than one that remounts.
        await new Promise((resolve) => setTimeout(resolve, 150));
        return;
      }
      return next(_event, input);
    };
  return next;
}
