import { isExecutionMode } from "@artemis/protocol";
import {
  customAgentRequestFingerprint,
  validateCustomAgentSendReference,
  validateCustomAgentTasks,
} from "../settings/custom-agent-validation.js";
import {
  turnRecoveryContext,
  type TurnCheckpoint,
} from "../conversation/turn-recovery.js";
import type { TurnRecovery } from "@artemis/protocol";
import { reduceAgentEvents } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import {
  promptAttachmentsSchema,
  assertAcceptablePlan,
  type PlanAcceptance,
} from "@artemis/protocol";
import {
  GLOBAL_MEMORY_MAX_BYTES,
  PROJECT_MEMORY_MAX_BYTES,
} from "../memory/memory-store.js";
import { recallMemoryForTurn } from "../memory/memory-recall.js";
import {
  formatImTaskTitle,
  type ImTaskTitleContext,
  deriveTaskTitle,
  shouldGenerateTaskTitle,
} from "../conversation/task-title.js";
import { I18N_RESOURCES } from "../../shared/i18n/i18n-resources.js";
import {
  IPC,
  type StartTurnInput,
  type StartTurnResult,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
import type { TurnLatencyTrace } from "../application/runtime-types.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentHostRestart"
  | "store"
  | "agentProcess"
  | "panelSendEntry"
  | "imService"
  | "compactingThreads"
  | "attachmentScope"
  | "attachmentStore"
  | "currentLocale"
  | "activeRuntimeSelection"
  | "agentRuntimeReady"
  | "mainWindow"
  | "automaticTaskTitles"
  | "openedThreads"
  | "enabledMcpServerCount"
  | "runtimeToolCount"
  | "runtimeMcpToolCount"
  | "turnLatencyTraces"
  | "optionalCapabilitiesReady"
  | "resolveThreadWorkspace"
  | "finalizeTurnLatency"
  | "turnChangeSetCompletionTails"
  | "turnChangeSetService"
  | "diagnosticBundleService"
  | "openAgentThread"
  | "memoryStore"
  | "settingsStore"
  | "emitInitialTurn"
  | "emitPayload"
  | "activeTurns"
  | "goalCreationAuthorizations"
  | "goalTurnContexts"
  | "activeTurnDispatches"
  | "shuttingDown"
  | "recoveringUpdate"
  | "cancellingTurns"
  | "recoverableTurnQueues"
>;
export function createTurnExecution(services: Dependencies) {
  const {
    compactingThreads,
    attachmentScope,
    attachmentStore,
    currentLocale,
    automaticTaskTitles,
    openedThreads,
    turnLatencyTraces,
    resolveThreadWorkspace,
    finalizeTurnLatency,
    turnChangeSetCompletionTails,
    openAgentThread,
    memoryStore,
    emitInitialTurn,
    emitPayload,
    activeTurns,
    goalCreationAuthorizations,
    goalTurnContexts,
    activeTurnDispatches,
    cancellingTurns,
    recoverableTurnQueues,
  } = services;
  async function startTaskTurnUnchecked(
    input: StartTurnInput,
    options: {
      origin?: "desktop" | "im";
      displayText?: string;
      titleContext?: ImTaskTitleContext;
      source?: "user" | "goal-continuation";
      expectedGoalId?: string;
      delegationContinuationId?: string;
      afterCompaction?: boolean;
      acceptance?: PlanAcceptance;
    } = {},
  ): Promise<StartTurnResult> {
    const mainReceivedAt = Date.now();
    const source = options.source ?? "user";
    if (services.agentHostRestart) await services.agentHostRestart;
    if (!services.store || !services.agentProcess) {
      throw new Error("Agent process is not ready.");
    }
    let thread = services.store.getThread(input.threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${input.threadId}`);
    }
    if (input.designPanelCredential) {
      if (!services.panelSendEntry) throw new Error("Send entry unavailable.");
      services.panelSendEntry.validateForThread(
        input.designPanelCredential,
        thread.id,
        thread.typeBinding?.bindingRevision ?? "unbound-preview",
      );
    }
    if (thread.archived) {
      throw new Error("Archived tasks cannot start a turn.");
    }
    const pendingPlan = services.store.plans(thread.id).at(-1);
    if (options.acceptance) {
      assertAcceptablePlan(services.store.plans(thread.id), options.acceptance);
      if (options.origin !== "desktop" || source !== "user")
        throw new Error("Plan acceptance requires a desktop user choice.");
    } else if (pendingPlan?.status === "proposed") {
      if (source !== "user" || options.origin !== "desktop")
        throw new Error("PLAN_REQUIRES_USER_CHOICE");
      input = { ...input, mode: "plan" };
    }
    if (input.mode === "codemode" && services.imService?.profile(thread.id))
      throw new Error(
        "CODEMODE_REMOTE_UNSUPPORTED: this remote profile cannot execute Codemode.",
      );
    if (thread.status === "running" || thread.status === "waiting-approval") {
      throw new Error("Task already has an active turn.");
    }
    if (compactingThreads.has(thread.id) && !options.afterCompaction) {
      throw new Error("Wait for context compaction to finish.");
    }
    if (
      source === "goal-continuation" &&
      (thread.goal?.status !== "active" ||
        thread.goal.goalId !== options.expectedGoalId)
    ) {
      throw new Error("The Goal changed before its continuation could start.");
    }
    if (input.customAgentReference && input.customAgentTasks?.length)
      throw new Error(
        "CUSTOM_AGENT_INVALID: use task blocks or the legacy reference, not both.",
      );
    const taskBlocks =
      input.customAgentTasks === undefined
        ? []
        : validateCustomAgentTasks(input.customAgentTasks);
    const text = input.text.trim();
    const attachments = await attachmentStore().bind(
      attachmentScope(thread.id),
      promptAttachmentsSchema.parse(input.attachments ?? []),
    );
    if (!text && attachments.length === 0 && taskBlocks.length === 0) {
      throw new Error("Prompt cannot be empty.");
    }
    const turnId = options.delegationContinuationId ?? randomUUID();
    if (
      options.origin === "desktop" ||
      (options.origin !== "im" && !services.imService?.profile(thread.id))
    ) {
      await services.imService?.prepareLocalTurn(thread.id, turnId);
    } else if (
      options.origin === "im" ||
      services.imService?.profile(thread.id)
    ) {
      services.imService?.authorizeThread(thread.id, input.mode);
    }
    const taskDefinitions = services.store.listEffectiveCustomAgents(
      thread.projectId ?? null,
    );
    const requestText = taskBlocks.length
      ? [
          text,
          ...taskBlocks.map(
            (task) =>
              `### @${taskDefinitions.find((definition) => definition.id === task.definitionId)?.name ?? task.definitionId}\n${task.text}`,
          ),
        ]
          .filter(Boolean)
          .join("\n\n")
      : text ||
        `Inspect the attached file${attachments.length === 1 ? "" : "s"}.`;
    const collaborationContext = services.imService?.desktopGroupContext(
      thread.id,
      requestText,
      input.mode,
    );
    if (
      shouldGenerateTaskTitle(
        thread.title,
        source,
        services.store.getThreadEvents(thread.id),
        options.titleContext?.initialTitle,
      )
    ) {
      const titleRequest = options.displayText ?? requestText;
      const formatTitle = (title: string) =>
        options.titleContext
          ? formatImTaskTitle(
              options.titleContext.channel,
              title,
              currentLocale(),
            )
          : title;
      thread = services.store.updateThread(thread.id, {
        title: formatTitle(
          deriveTaskTitle(options.displayText ?? text, currentLocale()),
        ),
      });
      const titledThread = thread;
      const process = services.agentProcess;
      const locale = currentLocale();
      const selection =
        thread.modelSelection ?? services.activeRuntimeSelection;
      if (titleRequest.trim() && !/^\s*\/init\s*$/iu.test(titleRequest)) {
        void automaticTaskTitles.generate(
          titledThread,
          async () => {
            await services.agentRuntimeReady;
            return process.request<string>(
              {
                type: "task.generate-summary",
                requestId: randomUUID(),
                title: titleRequest.slice(0, 2_000),
                locale,
                ...(selection ? { selection } : {}),
              },
              25_000,
            );
          },
          () =>
            services.agentProcess === process
              ? services.store?.getThread(titledThread.id)
              : undefined,
          (summary) => {
            const title = formatTitle(summary);
            services.store!.updateThread(titledThread.id, { title });
            services.mainWindow?.webContents.send(IPC.threadTitleUpdated, {
              id: titledThread.id,
              title,
            });
          },
        );
      }
    }
    const now = Date.now();
    const traceSelection =
      thread.modelSelection ?? services.activeRuntimeSelection;
    const trace: TurnLatencyTrace = {
      turnId,
      mainReceivedAt,
      ...(typeof input.submittedAt === "number" &&
      Number.isFinite(input.submittedAt) &&
      Math.abs(mainReceivedAt - input.submittedAt) < 5 * 60_000
        ? { submittedAt: input.submittedAt }
        : {}),
      coldThread: !openedThreads.has(thread.id),
      mode: input.mode,
      ...(traceSelection
        ? {
            providerId: traceSelection.providerId,
            modelId: traceSelection.modelId,
            thinkingLevel: traceSelection.thinkingLevel,
          }
        : {}),
      enabledMcpServers: services.enabledMcpServerCount,
      toolCount: services.runtimeToolCount,
      mcpToolCount: services.runtimeMcpToolCount,
      optionalStartedAt: now,
      workspaceStartedAt: now,
      queueDepth: 0,
      eventCount: 0,
    };
    turnLatencyTraces.set(turnId, trace);
    void services.optionalCapabilitiesReady.then(() => {
      trace.optionalReadyAt ??= Date.now();
    });

    let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
    try {
      context = await resolveThreadWorkspace(thread);
      trace.workspaceEndedAt = Date.now();
    } catch (error) {
      trace.workspaceEndedAt = Date.now();
      trace.completedAt = Date.now();
      trace.outcome = "failed";
      finalizeTurnLatency(trace);
      throw error;
    }
    await turnChangeSetCompletionTails.get(thread.id);
    if (
      isExecutionMode(input.mode) &&
      !context.temporary &&
      services.turnChangeSetService
    ) {
      try {
        await services.turnChangeSetService.begin({
          threadId: thread.id,
          turnId,
          workspacePath: context.workspacePath,
        });
      } catch (error) {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Turn checkpoint was unavailable for ${turnId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
    trace.threadOpenStartedAt = Date.now();
    trace.memoryStartedAt = trace.threadOpenStartedAt;
    const openPromise = openAgentThread(thread, context.workspacePath).then(
      () => {
        trace.threadOpenEndedAt = Date.now();
      },
    );
    const memoryPromise = (async (): Promise<string | undefined> => {
      if (services.imService?.profile(thread.id)) {
        trace.memoryEndedAt = Date.now();
        return undefined;
      }
      try {
        const projectMemoryPromise = context.temporary
          ? Promise.resolve({ content: "" })
          : memoryStore(
              join(context.project.path, ".artemis", "MEMORY.md"),
              PROJECT_MEMORY_MAX_BYTES,
            ).snapshot();
        const globalMemoryPath = join(
          app.getPath("home"),
          ".pi",
          "agent",
          "MEMORY.md",
        );
        const [projectMemory, globalMemory] = await Promise.all([
          projectMemoryPromise,
          memoryStore(globalMemoryPath, GLOBAL_MEMORY_MAX_BYTES).snapshot(),
        ]);
        return (
          recallMemoryForTurn({
            prompt: requestText,
            projectMemory: projectMemory.content,
            globalMemory: globalMemory.content,
            limits: {
              maxEntries: 3,
              maxCharacters: 3_500,
              globalMaxEntries: 1,
              globalMaxCharacters: 900,
            },
          }).context || undefined
        );
      } catch (error) {
        console.warn(
          `Memory recall skipped: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
      } finally {
        trace.memoryEndedAt = Date.now();
      }
    })();
    let memoryContext: string | undefined;
    try {
      [, memoryContext] = await Promise.all([openPromise, memoryPromise]);
    } catch (error) {
      trace.completedAt = Date.now();
      trace.outcome = "failed";
      finalizeTurnLatency(trace);
      throw error;
    }

    const goalCreationAuthorized =
      source === "user" &&
      /(?:\b(?:create|set|start)\b[^\n]{0,80}\bgoal\b|\bgoal\b[^\n]{0,80}\b(?:create|set|start)\b|(?:创建|设置|开始|建立).{0,40}(?:目标|Goal))/iu.test(
        requestText,
      );
    // Per-turn effective custom sub-agent catalog (D#152): resolved once at
    // dispatch time from the trusted projectId and frozen onto the
    // checkpoint; later edits apply to later turns only. The model can never
    // supply a projectId to widen this set.
    const turnCustomAgents = services.store.listEffectiveCustomAgents(
      thread.projectId ?? null,
    );
    const invocations = taskBlocks.length
      ? taskBlocks
      : input.customAgentReference
        ? [
            {
              ...validateCustomAgentSendReference(input.customAgentReference),
              text: requestText,
            },
          ]
        : [];
    const invocationStore = services.store;
    const invocationRecords = invocations.map((reference) => {
      // Resolve against the full catalog so a definition disabled between
      // chip selection and send reports CUSTOM_AGENT_DISABLED, not
      // NOT_FOUND; scope effectiveness is checked separately.
      const definition = invocationStore
        .listCustomAgents()
        .find((candidate) => candidate.id === reference.definitionId);
      if (!definition) {
        throw new Error(
          `CUSTOM_AGENT_NOT_FOUND: the referenced custom sub-agent does not exist.`,
        );
      }
      if (!definition.enabled) {
        throw new Error(
          `CUSTOM_AGENT_DISABLED: custom sub-agent "${definition.name}" is disabled.`,
        );
      }
      if (
        !turnCustomAgents.some((candidate) => candidate.id === definition.id)
      ) {
        throw new Error(
          `CUSTOM_AGENT_OUT_OF_SCOPE: the referenced custom sub-agent is not effective for this project.`,
        );
      }
      if (definition.revision !== reference.revision) {
        throw new Error(
          `CUSTOM_AGENT_REVISION_CONFLICT: custom sub-agent "${definition.name}" was edited; refresh the reference and retry.`,
        );
      }
      return {
        threadId: thread.id,
        invocationId: reference.invocationId,
        requestFingerprint: customAgentRequestFingerprint({
          threadId: thread.id,
          text: taskBlocks.length
            ? JSON.stringify({ text, tasks: taskBlocks })
            : requestText,
          attachmentIds: attachments.map((attachment) => attachment.id),
          definitionId: definition.id,
          revision: definition.revision,
        }),
        definitionId: definition.id,
        definitionRevision: definition.revision,
        definitionName: definition.name,
        turnId,
        instanceId: null,
        status: "pending" as const,
      };
    });
    const checkpoint: TurnCheckpoint = {
      composerPredictions:
        options.origin === "desktop" &&
        source === "user" &&
        !options.afterCompaction &&
        !options.delegationContinuationId &&
        !services.imService?.profile(thread.id) &&
        !collaborationContext &&
        ((await services.settingsStore?.composerPredictionsPreference()) ??
          true),
      threadId: thread.id,
      turnId,
      text: requestText,
      mode: input.mode,
      source,
      remote: !!services.imService?.hasBinding(thread.id),
      ...(goalCreationAuthorized ? { goalCreationAuthorized } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(thread.goal ? { goal: thread.goal } : {}),
      ...(memoryContext ? { memoryContext } : {}),
      ...(collaborationContext ? { collaborationContext } : {}),
      customAgents: turnCustomAgents,
      customAgentProjectId: thread.projectId ?? null,
      ...(taskBlocks.length
        ? { customAgentTasks: taskBlocks }
        : invocations[0]
          ? { customAgentInvocation: invocations[0] }
          : {}),
    };
    if (invocationRecords.length) {
      const previousTurnId =
        services.store.commitCustomAgentInvocations(invocationRecords);
      if (previousTurnId) {
        turnLatencyTraces.delete(turnId);
        return {
          turnId: previousTurnId,
          thread: services.store.getThread(thread.id) ?? thread,
        };
      }
    }
    let panelSubmissionId: string | undefined;
    try {
      if (input.designPanelCredential) {
        panelSubmissionId = services.panelSendEntry!.consumeForTurn(
          input.designPanelCredential,
          thread.id,
          services.store.getThread(thread.id)?.typeBinding?.bindingRevision ??
            "unbound-preview",
          turnId,
        ).submissionId;
      }
      if (
        options.delegationContinuationId &&
        !services.imService?.canResumeDelegation(
          options.delegationContinuationId,
        )
      )
        throw new Error(
          "IM continuation was cancelled or its authorization changed.",
        );
      await emitInitialTurn(
        thread.id,
        turnId,
        options.displayText ?? requestText,
        input.mode,
        attachments,
        source === "user",
        checkpoint,
        options.acceptance,
      );
      // Cancellation may arrive while the initial events are being persisted.
      // Recheck before dispatching any work to the agent process.
      if (
        options.delegationContinuationId &&
        !services.imService?.canResumeDelegation(
          options.delegationContinuationId,
        )
      ) {
        services.store.clearTurnCheckpoint(thread.id, turnId);
        emitPayload(thread.id, turnId, {
          type: "turn.completed",
          reason: "cancelled",
        });
        return {
          turnId,
          thread: services.store.getThread(thread.id) ?? thread,
        };
      }
    } catch (error) {
      if (panelSubmissionId)
        services.panelSendEntry?.markOutcome(panelSubmissionId, "failed");
      for (const invocation of invocations) {
        services.store.transitionCustomAgentInvocation(
          thread.id,
          invocation.invocationId,
          "cancelled",
        );
      }
      trace.completedAt = Date.now();
      trace.outcome = "failed";
      finalizeTurnLatency(trace);
      throw error;
    }
    activeTurns.set(thread.id, turnId);
    if (goalCreationAuthorized) {
      goalCreationAuthorizations.add(turnId);
    }
    if (thread.goal?.status === "active" && isExecutionMode(input.mode)) {
      goalTurnContexts.set(turnId, {
        threadId: thread.id,
        goalId: thread.goal.goalId,
        mode: input.mode,
        source,
      });
    }

    trace.hostDispatchedAt = Date.now();
    dispatchCheckpoint(checkpoint);
    return { turnId, thread: services.store.getThread(thread.id) ?? thread };
  }

  function dispatchCheckpoint(
    checkpoint: TurnCheckpoint,
    recovery?: TurnRecovery,
  ): void {
    if (!services.agentProcess) throw new Error("Agent process is not ready.");
    const {
      threadId,
      turnId,
      source: _source,
      remote: _remote,
      goalCreationAuthorized: _goalCreationAuthorized,
      ...command
    } = checkpoint;
    const process = services.agentProcess;
    const dispatchId = randomUUID();
    activeTurns.set(threadId, turnId);
    activeTurnDispatches.set(threadId, dispatchId);
    void process
      .request({
        ...command,
        threadId,
        turnId,
        type: "turn.prompt",
        requestId: dispatchId,
        ...(recovery ? { recovery } : {}),
      })
      .catch((error) => {
        if (
          services.shuttingDown ||
          activeTurnDispatches.get(threadId) !== dispatchId ||
          services.agentProcess !== process
        )
          return;
        emitPayload(threadId, turnId, {
          type: "turn.failed",
          message: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (activeTurnDispatches.get(threadId) === dispatchId) {
          activeTurnDispatches.delete(threadId);
          if (activeTurns.get(threadId) === turnId)
            activeTurns.delete(threadId);
        }
      });
  }

  async function resumeInterruptedTurns(): Promise<void> {
    if (services.recoveringUpdate) return;
    for (const [threadId, turnId] of [...activeTurns]) {
      const thread = services.store?.getThread(threadId);
      const checkpoint = services.store?.getTurnCheckpoint(threadId);
      if (
        services.shuttingDown ||
        activeTurnDispatches.has(threadId) ||
        !thread ||
        thread.archived ||
        checkpoint?.turnId !== turnId ||
        cancellingTurns.has(threadId)
      )
        continue;
      try {
        if (checkpoint.remote && !services.imService?.hasBinding(threadId))
          throw new Error(
            "Remote execution context is unavailable for recovery.",
          );
        if (services.imService?.hasBinding(threadId))
          services.imService.authorizeThread(threadId, checkpoint.mode);
        const context = await resolveThreadWorkspace(thread);
        await openAgentThread(thread, context.workspacePath);
        // Stop/archive/new input can arrive while the workspace or runtime opens.
        if (
          services.shuttingDown ||
          activeTurnDispatches.has(threadId) ||
          services.store?.getThread(threadId)?.archived ||
          services.store?.getTurnCheckpoint(threadId)?.turnId !== turnId ||
          cancellingTurns.has(threadId)
        )
          continue;
        const events = services.store.getThreadEvents(threadId);
        const recovery = {
          attemptId: randomUUID(),
          ...turnRecoveryContext(events, turnId),
        };
        if (checkpoint.recovery) {
          const previous = JSON.parse(checkpoint.recovery.evidence) as {
            originalEvidence?: unknown;
          };
          recovery.evidence = JSON.stringify({
            originalEvidence: previous.originalEvidence ?? previous,
            latestEvidence: JSON.parse(recovery.evidence),
          });
        }
        const resumed = {
          ...checkpoint,
          ...(thread.goal ? { goal: thread.goal } : {}),
          recovery,
        };
        for (const invocation of checkpoint.customAgentTasks ??
          (checkpoint.customAgentInvocation
            ? [checkpoint.customAgentInvocation]
            : [])) {
          // Crash window: the committed dispatch may or may not have started
          // the child before the process died. Never blindly re-dispatch —
          // mark outcome-unknown and resume the parent turn without the
          // explicit instance; the user re-executes with a new invocation.
          const record = services.store?.getCustomAgentInvocation(
            threadId,
            invocation.invocationId,
          );
          if (record?.status === "dispatch-committed") {
            services.store?.transitionCustomAgentInvocation(
              threadId,
              invocation.invocationId,
              "outcome-unknown",
            );
          }
        }
        delete resumed.customAgentInvocation;
        delete resumed.customAgentTasks;
        services.store.saveTurnCheckpoint(resumed);
        if (checkpoint.goalCreationAuthorized)
          goalCreationAuthorizations.add(turnId);
        const view = reduceAgentEvents(threadId, events, checkpoint.mode);
        for (const tool of Object.values(view.tools)) {
          if (
            tool.status === "running" &&
            view.entryTurnIds[`tool:${tool.id}`] === turnId
          )
            emitPayload(threadId, turnId, {
              type: "tool.completed",
              toolCallId: tool.id,
              isError: true,
              output: I18N_RESOURCES[currentLocale()].app.hostRestart,
            });
        }
        if (
          thread.goal?.status === "active" &&
          isExecutionMode(checkpoint.mode) &&
          !goalTurnContexts.has(turnId)
        ) {
          goalTurnContexts.set(turnId, {
            threadId,
            goalId: thread.goal.goalId,
            mode: checkpoint.mode,
            source: checkpoint.source ?? "user",
          });
        }
        recoverableTurnQueues.discard(threadId);
        emitPayload(threadId, turnId, {
          type: "queue.updated",
          steering: [],
          followUp: [],
        });
        emitPayload(threadId, turnId, {
          type: "turn.activity",
          phase: "recovered",
          kind: "process-restart",
          attemptId: recovery.attemptId,
        });
        dispatchCheckpoint(resumed, recovery);
      } catch (error) {
        if (services.shuttingDown) return;
        emitPayload(threadId, turnId, {
          type: "turn.failed",
          code: "HOST_RESTART",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { startTaskTurnUnchecked, dispatchCheckpoint, resumeInterruptedTurns };
}
