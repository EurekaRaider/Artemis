import {
  ROOT_AGENT_ID,
  requestsInterruptedTeamContinuation,
} from "./agent-team-policy.js";
import {
  PROVIDER_BACKOFF_DEFAULT_MILLISECONDS,
  ModelStreamIdleTimeoutError,
  createModelStreamIdleWatchdog,
} from "./stream-health.js";
import { toSessionImages } from "./broker-tool-parameters.js";
import {
  steerPiQueuedFollowUp,
  replacePiQueuedFollowUp,
} from "./session-queue.js";

import type { QueuedFollowUpReplacement } from "./runtime-types.js";

import { composerPredictionInstruction } from "@artemis/protocol";

import { isExecutionMode } from "@artemis/protocol";

import type { CustomAgentTaskInvocation } from "@artemis/protocol";

import { isAttachmentReference } from "@artemis/protocol";

import { randomUUID } from "node:crypto";
import {
  processRecoveryPrompt,
  reconcileInterruptedTools,
} from "../sessions/turn-recovery.js";
import type { TurnRecovery } from "@artemis/protocol";

import { resolve } from "node:path";

import {
  type CustomAgentDefinition,
  PiAdapter,
  type PromptAttachment,
  type RunMode,
  type ThreadGoal,
} from "@artemis/protocol";

import { appendPromptFiles, buildTurnPrompt } from "../context/turn-prompt.js";

import { expandSkillInvocations } from "../tools/skill-invocations.js";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createTurnLifecycle(
  services: Pick<
    AgentRuntimeDependencies,
    | "userInputTails"
    | "threads"
    | "configuration"
    | "interruptedTeamSummary"
    | "cancelledTurns"
    | "acceptExplicitCustomAgentInvocation"
    | "acceptExplicitCustomAgentTasks"
    | "turnAutoCatalog"
    | "emitCustomAgentRoute"
    | "composerPredictionTokens"
    | "refreshThreadConfiguration"
    | "promptCache"
    | "concurrency"
    | "sink"
    | "waitForProviderAdmission"
    | "providerAdmissionBlockedUntil"
    | "modelStreamIdleTimeoutMs"
    | "recordProviderBackoff"
    | "bashExecutions"
    | "emitTeam"
    | "requestChildCancellation"
    | "parkedDelegationTurns"
    | "requireActiveThread"
  >,
) {
  async function serializeUserInput<T>(
    threadId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = services.userInputTails.get(threadId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    services.userInputTails.set(threadId, tail);
    await previous.catch(() => undefined);
    try {
      return await action();
    } finally {
      release();
      if (services.userInputTails.get(threadId) === tail) {
        services.userInputTails.delete(threadId);
      }
    }
  }

  async function prompt(
    threadId: string,
    turnId: string,
    text: string,
    mode: RunMode,
    attachments?: PromptAttachment[],
    goal?: ThreadGoal,
    memoryContext?: string,
    collaborationContext?: string,
    recovery?: TurnRecovery,
    customAgents?: CustomAgentDefinition[],
    customAgentInvocation?: {
      invocationId: string;
      definitionId: string;
      revision: number;
    },
    customAgentProjectId?: string | null,
    customAgentTasks?: CustomAgentTaskInvocation[],
    composerPredictions = false,
  ): Promise<void> {
    const hosted = services.threads.get(threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${threadId}`);
    }
    if (hosted.compacting) {
      throw new Error("Cannot start a turn while context is compacting.");
    }
    hosted.currentTurnId = turnId;
    hosted.currentMode = mode;
    hosted.currentMission = (goal?.objective ?? text).trim().slice(0, 2_000);
    hosted.customAgentProjectId = customAgentProjectId ?? null;
    const turnCustomAgents =
      customAgents ?? services.configuration.customAgents;
    if (turnCustomAgents === undefined) {
      delete hosted.turnCustomAgents;
    } else {
      hosted.turnCustomAgents = turnCustomAgents;
    }
    if (hosted.team?.status === "aborted") {
      hosted.interruptedTeamContext = services.interruptedTeamSummary(hosted);
    }
    const interruptedTeamContext = requestsInterruptedTeamContinuation(text)
      ? hosted.interruptedTeamContext
      : undefined;
    hosted.team = undefined;
    hosted.deferredTurnCompletion = undefined;
    const predictionToken =
      composerPredictions && !recovery ? randomUUID() : undefined;
    hosted.adapter = new PiAdapter(
      recovery ? `${turnId}:recovery:${recovery.attemptId}` : turnId,
      predictionToken,
    );
    services.cancelledTurns.delete(`${threadId}\0${turnId}`);
    hosted.session.setActiveToolsByName([
      ...(isExecutionMode(mode) ? hosted.executeTools : hosted.delegatedTools)
        .filter(
          (tool) =>
            tool.name !== "office_document" ||
            services.configuration.officeEnabled,
        )
        .map((tool) => tool.name),
      ...(mode === "plan"
        ? ["submit_plan"]
        : mode === "codemode"
          ? ["codemode"]
          : []),
    ]);

    let explicitDispatchNote: string | undefined;
    if (customAgentTasks?.length) {
      const accepted = services.acceptExplicitCustomAgentTasks(
        hosted,
        customAgentTasks,
      );
      explicitDispatchNote = [
        "[Host dispatch] The user assigned separate task blocks. Each instance receives ONLY its own block, not the other tasks or the main assistant instructions.",
        ...accepted.map(
          (task) =>
            `- ${task.definitionName}: instance ${task.agentId} is already materialized. Do not spawn a duplicate.`,
        ),
        "Follow the main assistant instructions, wait for these required team members, and integrate their results into your reply.",
      ].join("\n");
    } else if (customAgentInvocation) {
      const accepted = services.acceptExplicitCustomAgentInvocation(
        hosted,
        customAgentInvocation,
        text,
      );
      explicitDispatchNote = `[Host dispatch] The explicit invocation of custom sub-agent "${accepted.definitionName}" is already materialized as instance ${accepted.agentId}; do not spawn a duplicate. Wait for its result and integrate it into your reply.`;
    }

    // Automatic routing catalog (D#152 PR5): the model-visible slice is
    // exactly the enabled, automatic-invocation definitions of the frozen
    // turn catalog. Over budget means NO silent truncation — automatic
    // routing is disabled for the turn and the overflow is audited so the
    // user can narrow the automatic set in Settings.
    const autoCatalog = services.turnAutoCatalog(hosted);
    let autoCatalogNote: string | undefined;
    if (autoCatalog.overflow) {
      services.emitCustomAgentRoute(hosted, {
        decision: "catalog-disabled",
        invocationSource: "none",
        selectionBasis: "none",
        parentAgentId: ROOT_AGENT_ID,
        catalogId: autoCatalog.catalogId,
        catalogSize: autoCatalog.entries.length,
        candidates: [],
      });
    } else if (autoCatalog.entries.length > 0) {
      autoCatalogNote = [
        "[Custom sub-agents] These custom sub-agents are available for delegation this turn:",
        ...autoCatalog.entries.map(
          (entry) =>
            `- ${entry.name} (id: ${entry.definitionId}) — ${entry.description}`,
        ),
        "When the user's task matches one, delegate with spawn_agent's agent parameter set to its id instead of a free-text role. Never invent ids. A role that exactly names a listed sub-agent without the id is rejected with CUSTOM_AGENT_REFERENCE_REQUIRED.",
      ].join("\n");
    }

    try {
      if (predictionToken) {
        services.composerPredictionTokens.set(
          hosted.session.sessionId,
          predictionToken,
        );
      } else {
        services.composerPredictionTokens.delete(hosted.session.sessionId);
      }
      if (hosted.configurationPending) {
        await services.refreshThreadConfiguration(hosted);
        if (services.cancelledTurns.has(`${threadId}\0${turnId}`)) return;
      }
      hosted.currentAttachmentIds =
        attachments?.filter(isAttachmentReference).map((item) => item.id) ?? [];
      const preparedAttachments = attachments;
      const basePrompt = buildTurnPrompt(
        mode,
        recovery ? processRecoveryPrompt(text, recovery) : text,
        goal,
        memoryContext,
        interruptedTeamContext,
        collaborationContext,
      );
      const prompt = appendPromptFiles(
        [
          basePrompt,
          autoCatalogNote,
          explicitDispatchNote,
          predictionToken
            ? composerPredictionInstruction(predictionToken)
            : undefined,
        ]
          .filter((note): note is string => note !== undefined)
          .join("\n\n"),
        preparedAttachments,
      );
      const expandedPrompt = await expandSkillInvocations(
        prompt,
        hosted.resourceLoader.getSkills().skills,
      );
      const images = toSessionImages(preparedAttachments);
      if (recovery) reconcileInterruptedTools(hosted.session, recovery);
      services.promptCache.updateParentTurnCount(
        hosted.session.sessionId,
        hosted.topLevelUserTurns,
      );
      if (!recovery) hosted.topLevelUserTurns += 1;
      const concurrency = services.concurrency.snapshot;
      if (
        concurrency &&
        (concurrency.active >= concurrency.limit ||
          concurrency.activeParents >= Math.max(1, concurrency.limit - 1))
      ) {
        services.sink.emit(hosted.threadId, turnId, {
          type: "turn.activity",
          phase: "queued",
          queueDepth: concurrency.queued + 1,
        });
      }
      await services.concurrency.run(
        "parent",
        async (lease) => {
          hosted.activeLeases.set(ROOT_AGENT_ID, lease);
          const providerId = hosted.selection?.providerId;
          services.sink.emit(hosted.threadId, turnId, {
            type: "turn.activity",
            phase: "requesting-model",
            queueDepth: services.concurrency.snapshot?.queued ?? 0,
            toolCount: hosted.session.getActiveToolNames().length,
          });
          try {
            if (
              providerId &&
              (services.providerAdmissionBlockedUntil.get(providerId) ?? 0) >
                Date.now()
            ) {
              await lease.suspend(() =>
                services.waitForProviderAdmission(providerId, undefined, () =>
                  services.cancelledTurns.has(`${threadId}\0${turnId}`),
                ),
              );
            }
            const watchdog = createModelStreamIdleWatchdog(
              services.modelStreamIdleTimeoutMs,
              () => {
                void hosted.session.abort().catch(() => undefined);
              },
            );
            hosted.modelStreamWatchdog = watchdog;
            const stopWatching = hosted.session.subscribe(watchdog.observe);
            try {
              await Promise.race([
                recovery
                  ? hosted.session.sendCustomMessage(
                      {
                        customType: "artemis.process-recovery",
                        content: [
                          { type: "text", text: expandedPrompt.text },
                          ...(images ?? []),
                        ],
                        display: false,
                      },
                      { triggerTurn: true },
                    )
                  : images || expandedPrompt.expanded
                    ? hosted.session.prompt(expandedPrompt.text, {
                        ...(images ? { images } : {}),
                        ...(expandedPrompt.expanded
                          ? { expandPromptTemplates: false }
                          : {}),
                      })
                    : hosted.session.prompt(expandedPrompt.text),
                watchdog.stalled,
              ]);
            } finally {
              stopWatching();
              watchdog.dispose();
              if (hosted.modelStreamWatchdog === watchdog) {
                delete hosted.modelStreamWatchdog;
              }
            }
          } catch (error) {
            if (providerId) {
              services.recordProviderBackoff(
                providerId,
                error,
                error instanceof ModelStreamIdleTimeoutError
                  ? PROVIDER_BACKOFF_DEFAULT_MILLISECONDS
                  : undefined,
              );
            }
            if (error instanceof ModelStreamIdleTimeoutError) {
              if (!services.cancelledTurns.has(`${threadId}\0${turnId}`)) {
                services.sink.emit(hosted.threadId, turnId, {
                  type: "turn.failed",
                  code: error.code,
                  message: error.message,
                });
              }
              return;
            }
            throw error;
          } finally {
            hosted.activeLeases.delete(ROOT_AGENT_ID);
          }
        },
        undefined,
        threadId,
      );
    } finally {
      services.composerPredictionTokens.delete(hosted.session.sessionId);
      const cancellationKey = `${threadId}\0${turnId}`;
      const cancelledByUser = services.cancelledTurns.has(cancellationKey);
      services.bashExecutions.cancelTurn(threadId, turnId);
      const team = services.threads.get(threadId)?.team;
      const incompleteTeam =
        team && team.status !== "completed" && team.status !== "aborted";
      if (incompleteTeam && team) {
        team.status = "aborted";
        team.blockedAgentIds.clear();
        if (cancelledByUser) {
          delete team.error;
        } else {
          team.error = "The parent agent ended before calling finish_team.";
        }
        services.emitTeam(hosted);
        if (!cancelledByUser) {
          services.sink.emit(hosted.threadId, turnId, {
            type: "turn.failed",
            code: "agent-team-incomplete",
            message:
              "The agent team was not integrated before the parent agent ended.",
          });
        }
      } else if (hosted.deferredTurnCompletion) {
        services.sink.emit(
          hosted.threadId,
          turnId,
          hosted.deferredTurnCompletion,
        );
      }
      for (const child of hosted.childAgents.values()) {
        if (child.turnId === turnId) {
          services.requestChildCancellation(hosted, child);
        }
      }
      hosted.currentTurnId = undefined;
      hosted.currentMode = undefined;
      hosted.currentMission = undefined;
      hosted.deferredTurnCompletion = undefined;
      hosted.adapter = undefined;
      services.cancelledTurns.delete(cancellationKey);
      services.parkedDelegationTurns.delete(cancellationKey);
    }
  }

  async function cancel(threadId: string): Promise<void> {
    const hosted = services.threads.get(threadId);
    if (!hosted) {
      return;
    }
    if (hosted.currentTurnId) {
      services.cancelledTurns.add(`${threadId}\0${hosted.currentTurnId}`);
      services.bashExecutions.cancelTurn(threadId, hosted.currentTurnId);
    }
    for (const child of hosted.childAgents.values()) {
      services.requestChildCancellation(hosted, child);
    }
    await hosted.session.abort();
  }

  async function compact(
    threadId: string,
    customInstructions?: string,
    mode: RunMode = "plan",
  ): Promise<void> {
    const hosted = services.threads.get(threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${threadId}`);
    }
    if (hosted.currentTurnId) {
      throw new Error("Cannot compact context during an active turn.");
    }
    if (hosted.compacting) {
      throw new Error("Context compaction is already running.");
    }

    hosted.compacting = true;
    hosted.currentMode = mode;
    try {
      await services.concurrency.run("parent", async () => {
        if (hosted.currentTurnId) {
          throw new Error("Cannot compact context during an active turn.");
        }
        await hosted.session.compact(customInstructions);
        hosted.executeTools = hosted.executeTools.filter(
          (tool) => !hosted.mcpDirectToolNames.has(tool.name),
        );
        hosted.session.setActiveToolsByName(
          hosted.session
            .getActiveToolNames()
            .filter((name) => !hosted.mcpDirectToolNames.has(name)),
        );
      });
    } finally {
      hosted.compacting = false;
      hosted.currentMode = undefined;
    }
  }

  async function steer(
    threadId: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<void> {
    const hosted = services.requireActiveThread(threadId);
    const images = toSessionImages(attachments);
    const prompt = appendPromptFiles(text, attachments);
    await (images
      ? hosted.session.steer(prompt, images)
      : hosted.session.steer(prompt));
  }

  async function followUp(
    threadId: string,
    text: string,
    attachments?: PromptAttachment[],
  ): Promise<void> {
    const hosted = services.requireActiveThread(threadId);
    const images = toSessionImages(attachments);
    const prompt = appendPromptFiles(text, attachments);
    await (images
      ? hosted.session.followUp(prompt, images)
      : hosted.session.followUp(prompt));
  }

  function clearQueue(threadId: string): {
    steering: string[];
    followUp: string[];
  } {
    return services.requireActiveThread(threadId).session.clearQueue();
  }

  async function steerQueue(threadId: string): Promise<void> {
    const hosted = services.requireActiveThread(threadId);
    const queue = hosted.session.clearQueue();
    for (const message of [...queue.steering, ...queue.followUp]) {
      await hosted.session.steer(message);
    }
  }

  async function steerQueuedFollowUp(
    threadId: string,
    followUpIndex: number,
    expectedFollowUp: readonly string[],
  ): Promise<void> {
    const hosted = services.requireActiveThread(threadId);
    steerPiQueuedFollowUp(hosted.session, followUpIndex, expectedFollowUp);
  }

  async function replaceFollowUpQueue(
    threadId: string,
    expectedFollowUp: string[],
    followUp: QueuedFollowUpReplacement[],
  ): Promise<void> {
    const hosted = services.requireActiveThread(threadId);
    replacePiQueuedFollowUp(hosted.session, expectedFollowUp, followUp);
  }
  const handlers = {
    serializeUserInput,
    prompt,
    cancel,
    compact,
    steer,
    followUp,
    clearQueue,
    steerQueue,
    steerQueuedFollowUp,
    replaceFollowUpQueue,
  };
  return handlers;
}
