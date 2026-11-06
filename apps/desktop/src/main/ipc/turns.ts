import { randomUUID } from "node:crypto";
import { assertAcceptablePlan, acceptedPlanPrompt } from "@artemis/protocol";
import {
  IPC,
  type AgentTeamControlInput,
  type AgentTeamControlResult,
  type ChildAgentControlInput,
  type ChildAgentControlResult,
  type QueueTurnInput,
  type ReplaceQueuedTurnInput,
  type SteerQueuedTurnInput,
  type StartTurnInput,
  type StartTurnResult,
  type UndoTurnChangesResult,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "mainWindow"
  | "parseThreadCommand"
  | "store"
  | "acceptingPlans"
  | "startTaskTurn"
  | "ipcMain"
  | "cancelLocalTaskTurn"
  | "activeTurns"
  | "turnLatencyTraces"
  | "queueTurn"
  | "controlTurnQueue"
  | "steerQueuedTurn"
  | "replaceTurnQueue"
  | "cancelTaskTurn"
  | "turnChangeSetService"
  | "turnChangeSetCompletionTails"
  | "emitPayload"
  | "agentProcess"
>;

export function registerTurnsIpc(services: Dependencies): void {
  const {
    parseThreadCommand,
    acceptingPlans,
    startTaskTurn,
    ipcMain,
    cancelLocalTaskTurn,
    activeTurns,
    turnLatencyTraces,
    queueTurn,
    controlTurnQueue,
    steerQueuedTurn,
    replaceTurnQueue,
    cancelTaskTurn,
    turnChangeSetCompletionTails,
    emitPayload,
  } = services;

  ipcMain.handle(IPC.planAccept, (event, input) => {
    if (event.sender !== services.mainWindow?.webContents)
      throw new Error("Only the desktop user can accept a plan.");
    const command = parseThreadCommand<"plan.accept">({
      ...input,
      type: "plan.accept",
    });
    if (!services.store) throw new Error("Store is not ready");
    const key = `${command.threadId}:${command.planId}:${command.revision}`;
    const pending = acceptingPlans.get(key);
    if (pending) return pending;
    const plans = services.store.plans(command.threadId);
    const accepted = plans.find(
      (p) =>
        p.planId === command.planId &&
        p.revision === command.revision &&
        p.status === "accepted",
    );
    if (accepted?.executionTurnId)
      return {
        turnId: accepted.executionTurnId,
        thread: services.store.getThread(command.threadId)!,
      };
    const plan = assertAcceptablePlan(plans, command);
    const result = startTaskTurn(
      {
        threadId: command.threadId,
        mode: command.mode,
        text: acceptedPlanPrompt(plan),
      },
      { origin: "desktop", acceptance: command },
    );
    acceptingPlans.set(key, result);
    void result.finally(() => acceptingPlans.delete(key)).catch(() => {});
    return result;
  });
  ipcMain.handle(IPC.planRevise, async (event, input) => {
    if (event.sender !== services.mainWindow?.webContents)
      throw new Error("Only the desktop user can revise a plan.");
    const command = parseThreadCommand<"plan.revise">({
      ...input,
      type: "plan.revise",
    });
    if (activeTurns.has(command.threadId))
      await cancelLocalTaskTurn(command.threadId);
    return startTaskTurn(
      {
        threadId: command.threadId,
        text: command.text,
        mode: "plan",
        ...(command.attachments ? { attachments: command.attachments } : {}),
      },
      { origin: "desktop" },
    );
  });

  ipcMain.handle(
    IPC.turnStart,
    (_event, input: StartTurnInput): Promise<StartTurnResult> =>
      startTaskTurn(input, { origin: "desktop" }),
  );

  ipcMain.on(IPC.turnRendered, (_event, turnId: string, renderedAt: number) => {
    const trace = turnLatencyTraces.get(String(turnId ?? ""));
    if (
      !trace ||
      trace.rendererPaintAt !== undefined ||
      typeof renderedAt !== "number" ||
      !Number.isFinite(renderedAt) ||
      Math.abs(Date.now() - renderedAt) >= 5 * 60_000
    ) {
      return;
    }
    trace.rendererPaintAt = renderedAt;
  });

  ipcMain.handle(IPC.turnSteer, (_event, input: QueueTurnInput) =>
    queueTurn("turn.steer", input),
  );

  ipcMain.handle(IPC.turnFollowUp, (_event, input: QueueTurnInput) =>
    queueTurn("turn.follow-up", input),
  );

  ipcMain.handle(IPC.turnQueueClear, (_event, threadId: string) =>
    controlTurnQueue("turn.queue.clear", threadId),
  );

  ipcMain.handle(IPC.turnQueueSteer, (_event, threadId: string) =>
    controlTurnQueue("turn.queue.steer", threadId),
  );

  ipcMain.handle(
    IPC.turnQueueSteerItem,
    (_event, input: SteerQueuedTurnInput) => steerQueuedTurn(input),
  );

  ipcMain.handle(
    IPC.turnQueueReplace,
    async (_event, input: ReplaceQueuedTurnInput) => {
      return replaceTurnQueue(input);
    },
  );

  ipcMain.handle(IPC.turnCancel, (_event, threadId: string) =>
    cancelTaskTurn(threadId),
  );

  ipcMain.handle(
    IPC.turnChangesUndo,
    async (
      _event,
      threadId: string,
      turnId: string,
    ): Promise<UndoTurnChangesResult> => {
      if (!services.store || !services.turnChangeSetService) {
        throw new Error("Application is not ready.");
      }
      const thread = services.store.getThread(threadId);
      if (!thread) throw new Error("Task was not found.");
      if (
        thread.status === "running" ||
        thread.status === "waiting-approval" ||
        activeTurns.has(threadId) ||
        turnChangeSetCompletionTails.has(threadId)
      ) {
        throw new Error(
          "Wait for the active turn to finish before undoing files.",
        );
      }
      const { result, payload } = await services.turnChangeSetService.undo(
        threadId,
        turnId,
      );
      emitPayload(threadId, turnId, payload);
      return result;
    },
  );

  ipcMain.handle(
    IPC.childAgentControl,
    async (
      _event,
      input: ChildAgentControlInput,
    ): Promise<ChildAgentControlResult> => {
      if (!services.agentProcess || !services.store) {
        throw new Error("Application is not ready.");
      }
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.threadId !== "string" ||
        !input.threadId.trim() ||
        typeof input.agentId !== "string" ||
        !input.agentId.trim() ||
        !["status", "steer", "cancel", "retry"].includes(input.action)
      ) {
        throw new Error("Sub-agent control request is invalid.");
      }
      const thread = services.store.getThread(input.threadId);
      if (!thread) throw new Error("Task was not found.");
      if (
        input.action === "steer" &&
        (typeof input.message !== "string" || !input.message.trim())
      ) {
        throw new Error("Sub-agent steering message is required.");
      }
      const requestId = randomUUID();
      const command =
        input.action === "steer"
          ? {
              type: "child.steer" as const,
              requestId,
              threadId: input.threadId,
              agentId: input.agentId,
              text: input.message!.trim(),
            }
          : {
              type: `child.${input.action}` as
                "child.status" | "child.cancel" | "child.retry",
              requestId,
              threadId: input.threadId,
              agentId: input.agentId,
            };
      return services.agentProcess.request<ChildAgentControlResult>(
        command,
        10_000,
      );
    },
  );

  ipcMain.handle(
    IPC.agentTeamControl,
    async (
      _event,
      input: AgentTeamControlInput,
    ): Promise<AgentTeamControlResult> => {
      if (!services.agentProcess || !services.store) {
        throw new Error("Application is not ready.");
      }
      if (
        !input ||
        typeof input !== "object" ||
        typeof input.threadId !== "string" ||
        !input.threadId.trim() ||
        typeof input.teamId !== "string" ||
        !input.teamId.trim() ||
        input.action !== "cancel"
      ) {
        throw new Error("Agent-team control request is invalid.");
      }
      if (!services.store.getThread(input.threadId)) {
        throw new Error("Task was not found.");
      }
      return services.agentProcess.request<AgentTeamControlResult>(
        {
          type: "team.cancel",
          requestId: randomUUID(),
          threadId: input.threadId,
          teamId: input.teamId,
        },
        10_000,
      );
    },
  );
}
