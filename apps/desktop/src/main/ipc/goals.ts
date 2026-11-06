import type { Thread, ThreadGoal } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "parseThreadCommand"
  | "materializeGoalObjective"
  | "cleanupGoalObjective"
  | "activeTurns"
  | "emitGoalUpdated"
  | "ipcMain"
  | "readGoalObjective"
  | "steerGoalObjectiveUpdate"
  | "diagnosticBundleService"
  | "cancelTaskTurn"
  | "scheduleGoalContinuation"
  | "emitGoalCleared"
  | "cancelRunningGoalContinuation"
>;

export function registerGoalsIpc(services: Dependencies): void {
  const {
    parseThreadCommand,
    materializeGoalObjective,
    cleanupGoalObjective,
    activeTurns,
    emitGoalUpdated,
    ipcMain,
    readGoalObjective,
    steerGoalObjectiveUpdate,
    cancelTaskTurn,
    scheduleGoalContinuation,
    emitGoalCleared,
    cancelRunningGoalContinuation,
  } = services;

  ipcMain.handle(
    IPC.threadGoalSet,
    async (
      _event,
      threadId: string,
      objective: string,
      tokenBudget?: number,
    ): Promise<Thread> => {
      if (!services.store) throw new Error("Application store is not ready.");
      const command = parseThreadCommand({
        type: "thread.goal.set",
        threadId,
        objective,
        ...(tokenBudget === undefined ? {} : { tokenBudget }),
      });
      if (command.objective === undefined) {
        throw new Error("A new Goal requires an objective.");
      }
      if (services.store.getThreadGoal(command.threadId)) {
        throw new Error("Clear the current Goal before creating a new one.");
      }
      const persistedObjective = await materializeGoalObjective(
        command.objective,
      );
      let goal: ThreadGoal;
      try {
        goal = services.store.setThreadGoal(
          command.threadId,
          persistedObjective,
          command.tokenBudget ?? undefined,
        );
      } catch (error) {
        await cleanupGoalObjective(persistedObjective);
        throw error;
      }
      emitGoalUpdated(goal, activeTurns.get(command.threadId));
      return services.store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(
    IPC.threadGoalObjectiveGet,
    async (_event, threadId: string) => {
      if (!services.store) throw new Error("Application store is not ready.");

      const goal = services.store.getThreadGoal(String(threadId ?? ""));
      if (!goal) throw new Error("This task has no Goal.");
      return {
        goalId: goal.goalId,
        objective: await readGoalObjective(goal.objective),
        revision: goal.revision,
        updatedAt: goal.updatedAt,
      };
    },
  );

  ipcMain.handle(
    IPC.threadGoalObjectiveUpdate,
    async (
      _event,
      threadId: string,
      objective: string,
      expectedGoalId: string,
      expectedRevision: number,
    ): Promise<Thread> => {
      if (!services.store) throw new Error("Application store is not ready.");

      const command = parseThreadCommand({
        type: "thread.goal.set",
        threadId,
        objective,
        expectedGoalId,
        expectedRevision,
      });
      if (command.objective === undefined) {
        throw new Error("A Goal edit requires an objective.");
      }
      const previous = services.store.getThreadGoal(command.threadId);
      if (!previous) throw new Error("This task has no Goal.");
      const persistedObjective = await materializeGoalObjective(
        command.objective,
      );
      let goal: ThreadGoal;
      try {
        goal = services.store.updateThreadGoalObjective(
          command.threadId,
          persistedObjective,
          command.expectedGoalId!,
          command.expectedRevision!,
        );
      } catch (error) {
        await cleanupGoalObjective(persistedObjective);
        throw error;
      }
      if (previous.objective !== persistedObjective) {
        await cleanupGoalObjective(previous.objective);
      }
      emitGoalUpdated(goal, activeTurns.get(command.threadId));
      try {
        await steerGoalObjectiveUpdate(goal);
      } catch (error) {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Saved Goal objective could not steer the active turn: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      return services.store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(
    IPC.threadGoalPause,
    async (_event, threadId: string): Promise<Thread> => {
      if (!services.store) throw new Error("Application store is not ready.");
      const command = parseThreadCommand({
        type: "thread.goal.pause",
        threadId,
      });
      const goal = services.store.pauseThreadGoal(command.threadId);
      emitGoalUpdated(goal, activeTurns.get(command.threadId));
      await cancelTaskTurn(command.threadId);
      return services.store.getThread(command.threadId)!;
    },
  );

  ipcMain.handle(IPC.threadGoalResume, (_event, threadId: string): Thread => {
    if (!services.store) throw new Error("Application store is not ready.");
    const command = parseThreadCommand({
      type: "thread.goal.resume",
      threadId,
    });
    const goal = services.store.resumeThreadGoal(command.threadId);
    emitGoalUpdated(goal, activeTurns.get(command.threadId));
    scheduleGoalContinuation(command.threadId, goal.goalId);
    return services.store.getThread(command.threadId)!;
  });

  ipcMain.handle(
    IPC.threadGoalClear,
    async (_event, threadId: string): Promise<Thread> => {
      if (!services.store) throw new Error("Application store is not ready.");
      const command = parseThreadCommand({
        type: "thread.goal.clear",
        threadId,
      });
      const previousObjective = services.store.getThreadGoal(
        command.threadId,
      )?.objective;
      const cleared = services.store.clearThreadGoal(command.threadId);
      if (cleared) {
        emitGoalCleared(
          command.threadId,
          cleared,
          activeTurns.get(command.threadId),
        );
        await cancelRunningGoalContinuation(command.threadId);
        await cleanupGoalObjective(previousObjective);
      }
      return services.store.getThread(command.threadId)!;
    },
  );
}
