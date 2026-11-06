import {
  usedContextTokens,
  contextTokenBreakdown,
  contextFootprint,
  lastProviderInput,
} from "./context-metrics.js";

import type {
  AgentSession,
  AgentSessionEvent,
  HostedThread,
} from "./runtime-types.js";

import { installCompactionBudget } from "../context/compaction-budget.js";

import type { AgentPayload, ModelSelection } from "@artemis/protocol";

import { compactionSettingsForContextWindow } from "../context/context-window.js";

import type { ConnectionRecoveryUpdate } from "./connection-recovery.js";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createSessionObservation(
  services: Pick<
    AgentRuntimeDependencies,
    "threads" | "sink" | "promptCache" | "configuration" | "emitContextUsage"
  >,
) {
  function handleConnectionRecovery(
    sessionId: string | undefined,
    update: ConnectionRecoveryUpdate,
  ): void {
    if (!sessionId) return;
    const hosted = [...services.threads.values()].find(
      (candidate) => candidate.session.sessionId === sessionId,
    );
    if (!hosted) {
      for (const thread of services.threads.values()) {
        const child = [...thread.childAgents.values()].find(
          (candidate) => candidate.session?.sessionId === sessionId,
        );
        if (!child) continue;
        if (update.phase === "stream-finished")
          child.modelStreamWatchdog?.resume();
        else if (
          update.phase === "stream-started" ||
          update.phase === "reconnecting"
        )
          child.modelStreamWatchdog?.pause();
        return;
      }
    }
    if (!hosted?.currentTurnId) return;
    if (update.phase === "stream-started") {
      // The request watchdog owns stream retries; the turn guard covers gaps outside it.
      hosted.modelStreamWatchdog?.pause();
      return;
    }
    if (update.phase === "stream-finished") {
      hosted.modelStreamWatchdog?.resume();
      return;
    }
    if (update.phase === "reconnecting") {
      hosted.modelStreamWatchdog?.pause();
      services.sink.emit(hosted.threadId, hosted.currentTurnId, {
        type: "turn.activity",
        phase: "reconnecting",
        kind: update.kind ?? "connection",
        ...(update.maxAttempts === undefined
          ? {}
          : { maxAttempts: update.maxAttempts }),
        attempt: update.attempt,
        delayMs: update.delayMs,
        attemptId: update.attemptId,
      });
      return;
    }
    services.sink.emit(hosted.threadId, hosted.currentTurnId, {
      type: "turn.activity",
      phase: update.phase,
      kind: "connection",
      attemptId: update.attemptId,
    });
  }

  function promptCacheUsage(
    sessionId: string,
    payload: Extract<AgentPayload, { type: "assistant.usage" }>,
    selection?: ModelSelection,
  ): Extract<AgentPayload, { type: "assistant.usage" }> {
    services.promptCache.observeUsage(sessionId, payload);
    const cache = services.promptCache.latestResolution(sessionId);
    return {
      ...payload,
      ...(selection
        ? {
            providerId: selection.providerId,
            modelId: selection.modelId,
          }
        : {}),
      ...(cache
        ? {
            cacheReadReported:
              payload.cacheReadReported ?? cache.cacheReadReported,
            cacheWriteReported:
              payload.cacheWriteReported ?? cache.cacheWriteReported,
            cachePolicy: cache.policy,
            cachePolicyReason: cache.reason,
            ...(cache.cacheKeyFingerprint
              ? { cacheKeyFingerprint: cache.cacheKeyFingerprint }
              : {}),
            systemPromptFingerprint: cache.systemPromptFingerprint,
            toolSchemaFingerprint: cache.toolSchemaFingerprint,
            stablePrefixTokens: cache.stablePrefixTokens,
            cacheKeyRequestsPerMinute: cache.cacheKeyRequestsPerMinute,
            cacheKeyRateWarning: cache.cacheKeyRateWarning,
          }
        : {}),
    };
  }

  function configureSessionCompaction(session: AgentSession): void {
    installCompactionBudget(session);
    const contextWindow = session.model?.contextWindow;
    if (!contextWindow) {
      return;
    }
    const configured = services.configuration.providers
      ?.find((p) => p.id === session.model?.provider)
      ?.models.find((m) => m.id === session.model?.id);
    const defaults = compactionSettingsForContextWindow(contextWindow);
    session.settingsManager.applyOverrides({
      compaction: {
        enabled: configured?.compaction?.enabled ?? defaults.enabled,
        reserveTokens:
          configured?.compaction?.reserveTokens ?? defaults.reserveTokens,
        keepRecentTokens:
          configured?.compaction?.keepRecentTokens ?? defaults.keepRecentTokens,
      },
      cacheWarming: configured?.cacheWarming ?? "off",
    });
  }

  function emitContextUsage(
    hosted: HostedThread,
    compacting: boolean,
    estimatedTokens?: number,
    compactionResult?: Extract<
      AgentPayload,
      { type: "context.usage" }
    >["compactionResult"],
  ): void {
    const usage = hosted.session.getContextUsage();
    const contextWindow =
      usage?.contextWindow ?? hosted.session.model?.contextWindow;
    if (!contextWindow) {
      return;
    }
    const messages = hosted.session.messages ?? [];
    const providerInput = lastProviderInput(messages);
    const reportedTokens =
      estimatedTokens === undefined ? (usage?.tokens ?? null) : null;
    const estimatedMessageTokens =
      estimatedTokens === undefined
        ? undefined
        : Math.max(0, Math.round(estimatedTokens));
    const breakdown = contextTokenBreakdown(
      hosted,
      reportedTokens,
      contextWindow,
      estimatedMessageTokens,
    );
    const tokens =
      estimatedMessageTokens === undefined
        ? reportedTokens
        : breakdown
          ? usedContextTokens(breakdown)
          : estimatedMessageTokens;
    const source =
      estimatedTokens !== undefined
        ? "compaction-estimate"
        : tokens !== null && providerInput?.index === messages.length - 1
          ? "provider"
          : "local-estimate";
    services.sink.emit(hosted.threadId, hosted.currentTurnId, {
      type: "context.usage",
      tokens,
      contextWindow,
      compacting,
      ...(compactionResult ? { compactionResult } : {}),
      source,
      ...(source === "provider" ? {} : { estimated: true }),
      ...(providerInput ? { providerInputTokens: providerInput.tokens } : {}),
      ...(breakdown ? { breakdown } : {}),
      footprint: contextFootprint(
        messages,
        hosted.session.agent?.state?.tools ?? [],
      ),
    });
  }

  function handleContextUsageEvent(
    hosted: HostedThread,
    event: AgentSessionEvent,
  ): void {
    if (event.type === "turn_end") {
      services.emitContextUsage(hosted, false);
    } else if (
      event.type === "message_end" &&
      event.message.role === "toolResult"
    ) {
      services.emitContextUsage(hosted, false);
    } else if (event.type === "compaction_start") {
      services.emitContextUsage(hosted, true);
    } else if (event.type === "compaction_end") {
      services.emitContextUsage(
        hosted,
        false,
        event.result?.estimatedTokensAfter,
        {
          status: event.aborted
            ? "cancelled"
            : event.result
              ? "completed"
              : "failed",
          ...(event.errorMessage ? { error: event.errorMessage } : {}),
        },
      );
    }
  }
  const handlers = {
    handleConnectionRecovery,
    promptCacheUsage,
    configureSessionCompaction,
    emitContextUsage,
    handleContextUsageEvent,
  };
  return handlers;
}
