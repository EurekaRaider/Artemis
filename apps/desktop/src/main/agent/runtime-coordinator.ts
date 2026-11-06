import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import type {
  AgentRuntimeCatalog,
  AgentRuntimeConfiguration,
} from "@artemis/protocol";
import { AGENT_CONCURRENCY_FALLBACK } from "@artemis/protocol";
import {
  AgentProcess,
  type AgentProcessHandlers,
} from "../agent/agent-process.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "shuttingDown"
  | "emitPayload"
  | "emitPayloadBatch"
  | "turnLatencyTraces"
  | "store"
  | "settingsStore"
  | "handleBrokerRequest"
  | "diagnosticBundleService"
  | "codexPrimaryRuntimePath"
  | "agentCapacityController"
  | "pendingApprovals"
  | "pendingUserInputs"
  | "pendingMultiUserInputs"
  | "activeTurnDispatches"
  | "recoverableTurnQueues"
  | "activeTurns"
  | "agentHostRestart"
  | "openedThreads"
  | "openingThreads"
  | "agentProcess"
  | "resolveThreadWorkspace"
  | "openAgentThread"
  | "resumeInterruptedTurns"
  | "agentRuntimeReady"
  | "globalInstructionsStore"
  | "getOfficeWorkbench"
  | "artemisPluginService"
  | "mcpClientManager"
  | "computerUseServerId"
  | "trustedExtensionManager"
  | "AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS"
  | "activeRuntimeSelection"
  | "cachedAgentCatalog"
  | "runtimeMcpToolCount"
  | "runtimeToolCount"
  | "enabledMcpServerCount"
  | "mcpConfigStore"
>;
export function createRuntimeCoordinator(services: Dependencies) {
  const {
    emitPayload,
    emitPayloadBatch,
    turnLatencyTraces,
    handleBrokerRequest,
    codexPrimaryRuntimePath,
    pendingApprovals,
    pendingUserInputs,
    pendingMultiUserInputs,
    activeTurnDispatches,
    recoverableTurnQueues,
    activeTurns,
    openedThreads,
    openingThreads,
    resolveThreadWorkspace,
    openAgentThread,
    resumeInterruptedTurns,
    getOfficeWorkbench,
    AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS,
  } = services;
  function agentProcessHandlers(): AgentProcessHandlers {
    return {
      onEvent(threadId, turnId, payload) {
        if (services.shuttingDown || payload.type.startsWith("plan.")) return;
        emitPayload(threadId, turnId, payload);
      },
      onEvents(events) {
        if (services.shuttingDown) return;
        emitPayloadBatch(events);
      },
      onTurnTelemetry(event) {
        const trace = turnLatencyTraces.get(event.turnId);
        if (trace && event.stage === "host-received") {
          trace.hostReceivedAt ??= event.timestamp;
        }
      },
      onThreadSession(threadId, sessionFile) {
        if (services.shuttingDown) return;
        if (services.store?.getThread(threadId)) {
          services.store.updateThread(threadId, { sessionFile });
        }
      },
      async onCredentialChanged(message) {
        if (!services.settingsStore || services.shuttingDown)
          throw new Error("Settings are unavailable");
        await services.settingsStore.saveRefreshedCredential(
          message.providerId,
          message.previous,
          message.credential,
        );
      },
      onBrokerRequest: handleBrokerRequest,
      onStderr(data) {
        services.diagnosticBundleService?.record({
          source: "agent-host",
          severity: "error",
          message: data,
        });
      },
      onExit(code, expected) {
        services.diagnosticBundleService?.record({
          source: "agent-host",
          severity: expected ? "info" : "fatal",
          message: `Agent host exited with code ${code ?? "unknown"}${expected ? " during shutdown" : ""}.`,
        });
        if (!expected && !services.shuttingDown) restartAgentHost(code);
      },
    };
  }

  function createAgentHostProcess(): AgentProcess {
    const codexRuntimeRoot = codexPrimaryRuntimePath();
    return new AgentProcess(
      join(import.meta.dirname, "agent-worker.js"),
      agentProcessHandlers(),
      {
        ...(codexRuntimeRoot ? { codexRuntimeRoot } : {}),
        agentConcurrencyLimit:
          services.agentCapacityController?.limit ?? AGENT_CONCURRENCY_FALLBACK,
      },
    );
  }

  function interruptTurnsAfterAgentHostExit(): void {
    if (!services.store) return;
    for (const cancelled of pendingApprovals.cancelWhere(() => true)) {
      emitPayload(
        cancelled.value.request.threadId,
        cancelled.value.request.turnId,
        {
          type: "approval.resolved",
          approvalId: cancelled.approvalId,
          nonce: cancelled.nonce,
          approved: false,
          scope: "once",
        },
      );
    }
    for (const cancelled of pendingUserInputs.cancelWhere(() => true)) {
      if (cancelled.value.timeout !== undefined) {
        clearTimeout(cancelled.value.timeout);
      }
      emitPayload(
        cancelled.value.request.threadId,
        cancelled.value.request.turnId,
        {
          type: "user-input.resolved",
          requestId: cancelled.requestId,
          nonce: cancelled.nonce,
          answer: "",
          source: "cancelled",
        },
      );
    }
    for (const cancelled of pendingMultiUserInputs.cancelWhere(() => true)) {
      for (const timeout of cancelled.value.timeouts.values()) {
        clearTimeout(timeout);
      }
      // One kind-less cancelled resolution per request: the reducer's legacy
      // translation layer closes every still-pending question on the card, so
      // no per-question events are needed here.
      emitPayload(
        cancelled.value.request.threadId,
        cancelled.value.request.turnId,
        {
          type: "user-input.resolved",
          requestId: cancelled.requestId,
          nonce: cancelled.nonce,
          answer: "",
          source: "cancelled",
        },
      );
    }
    for (const [threadId, turnId] of [...activeTurns]) {
      activeTurnDispatches.delete(threadId);
      if (services.store?.getTurnCheckpoint(threadId)?.turnId === turnId) {
        emitPayload(threadId, turnId, {
          type: "turn.activity",
          phase: "reconnecting",
          kind: "process-restart",
          attempt: 1,
          delayMs: 0,
        });
        continue;
      }
      const recoveredItems = recoverableTurnQueues.recover(threadId);
      if (recoveredItems.length > 0) {
        emitPayload(threadId, turnId, {
          type: "queue.recovered",
          messages: recoveredItems.map((item) => item.text),
          items: recoveredItems,
        });
      }
      emitPayload(threadId, turnId, {
        type: "queue.updated",
        steering: [],
        followUp: [],
      });
      emitPayload(threadId, turnId, {
        type: "turn.failed",
        code: "AGENT_HOST_INTERRUPTED",
        message:
          "The Agent Host exited during this turn. Artemis restored the host and session state but did not replay the prompt, because completed writes could not be proven safe to repeat.",
      });
    }
  }

  function restartAgentHost(code: number | null): void {
    if (services.agentHostRestart) return;
    const reopenedThreadIds = [...openedThreads];
    interruptTurnsAfterAgentHostExit();
    openedThreads.clear();
    openingThreads.clear();
    const restart = (async () => {
      services.agentProcess = createAgentHostProcess();
      await applyAgentRuntime();
      for (const threadId of reopenedThreadIds) {
        const thread = services.store?.getThread(threadId);
        if (!thread || thread.archived) continue;
        const context = await resolveThreadWorkspace(thread);
        await openAgentThread(thread, context.workspacePath);
      }
      await resumeInterruptedTurns();
      services.diagnosticBundleService?.record({
        source: "agent-host",
        severity: "info",
        message: `Agent host recovered after unexpected exit ${code ?? "unknown"}; active tasks resumed from persisted checkpoints.`,
      });
    })();
    services.agentHostRestart = restart;
    services.agentRuntimeReady = restart;
    void restart
      .catch((error) => {
        if (services.shuttingDown) return;
        for (const [threadId, turnId] of [...activeTurns]) {
          emitPayload(threadId, turnId, {
            type: "turn.failed",
            code: "HOST_RESTART",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        services.diagnosticBundleService?.record({
          source: "agent-host",
          severity: "fatal",
          message: `Agent host recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      })
      .finally(() => {
        if (services.agentHostRestart === restart)
          services.agentHostRestart = undefined;
      });
  }

  async function applyAgentRuntime(
    configuration?: AgentRuntimeConfiguration,
  ): Promise<void> {
    if (!services.agentProcess || !services.settingsStore) {
      throw new Error("Agent settings are not ready.");
    }
    const resolved =
      configuration ?? (await services.settingsStore.runtimeConfiguration());
    if (services.globalInstructionsStore) {
      resolved.globalAgents = await services.globalInstructionsStore.snapshot();
    }
    resolved.hooksEnabled = true;
    resolved.officeEnabled = await getOfficeWorkbench()
      .then(async (workbench) =>
        Boolean((await workbench.status()).activeVersion),
      )
      .catch(() => false);
    if (!resolved.officeEnabled && services.artemisPluginService) {
      const officeSkills = (await services.artemisPluginService.listInstalled())
        .filter(
          (plugin) =>
            ["bundled", "runtime"].includes(plugin.source.kind) &&
            ["documents", "spreadsheets", "presentations", "pdf"].includes(
              plugin.name,
            ),
        )
        .flatMap((plugin) =>
          plugin.skillNames.map((name) =>
            join(
              app.getPath("home"),
              ".pi",
              "agent",
              "skills",
              name,
              "SKILL.md",
            ),
          ),
        );
      resolved.disabledSkillFiles = [
        ...(resolved.disabledSkillFiles ?? []),
        ...officeSkills,
      ];
    }
    resolved.mcpTools = services.mcpClientManager?.tools() ?? [];
    if (
      services.computerUseServerId &&
      resolved.mcpTools.some(
        (tool) => tool.serverId === services.computerUseServerId,
      )
    )
      resolved.computerUseServerId = services.computerUseServerId;
    else delete resolved.computerUseServerId;
    resolved.extensionTools = services.trustedExtensionManager?.tools() ?? [];
    // Full custom sub-agent definitions (including dedicated instructions)
    // travel only on this trusted main→worker channel; renderers receive
    // catalog metadata without instructions (D#152 plan section 3).
    resolved.customAgents = services.store?.listCustomAgents() ?? [];
    resolved.customAgentProjectIds = Object.fromEntries(
      resolved.customAgents.map((definition) => [
        definition.id,
        services.store?.listCustomAgentProjectIds(definition.id) ?? [],
      ]),
    );
    await services.agentProcess.request(
      {
        type: "runtime.configure",
        requestId: randomUUID(),
        configuration: resolved,
      },
      AGENT_RUNTIME_CONFIGURATION_TIMEOUT_MS,
    );
    services.activeRuntimeSelection = undefined;
    await services.agentProcess
      .request<AgentRuntimeCatalog>(
        {
          type: "runtime.catalog",
          requestId: randomUUID(),
        },
        10_000,
      )
      .then((catalog) => {
        services.cachedAgentCatalog = catalog;
        services.activeRuntimeSelection = catalog.selection
          ? structuredClone(catalog.selection)
          : undefined;
      })
      .catch((error) => {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Agent model catalog refresh failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      });
    services.runtimeMcpToolCount = resolved.mcpTools.length;
    services.runtimeToolCount =
      resolved.mcpTools.length + (resolved.extensionTools?.length ?? 0);
    services.enabledMcpServerCount = services.mcpConfigStore
      ? (await services.mcpConfigStore.listAvailable()).filter(
          (config) => config.enabled,
        ).length
      : 0;
  }

  async function resetAgentThreadsForToolChange(): Promise<void> {
    // Additive installs skip this reset: their tools and skills are refreshed
    // runtime.configure defers Skill refreshes until the current turn ends.
    if (!services.agentProcess) return;
    if (activeTurns.size > 0) {
      throw new Error("Stop active turns before changing Agent tools.");
    }
    await Promise.allSettled(openingThreads.values());
    for (const threadId of [...openedThreads]) {
      await services.agentProcess.request({
        type: "thread.close",
        requestId: randomUUID(),
        threadId,
      });
      openedThreads.delete(threadId);
    }
  }

  async function tightenThreadToRestrictedProfile(
    threadId: string,
  ): Promise<void> {
    if (!services.agentProcess || !openedThreads.has(threadId)) return;
    const pending = openingThreads.get(threadId);
    if (pending) await pending.catch(() => undefined);
    try {
      await services.agentProcess.request({
        type: "thread.close",
        requestId: randomUUID(),
        threadId,
      });
      openedThreads.delete(threadId);
      const thread = services.store?.getThread(threadId);
      if (thread) await openAgentThread(thread);
    } catch (error) {
      console.warn(
        `[design-panel] restricted-profile rebuild deferred for ${threadId.slice(0, 8)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    agentProcessHandlers,
    createAgentHostProcess,
    interruptTurnsAfterAgentHostExit,
    restartAgentHost,
    applyAgentRuntime,
    resetAgentThreadsForToolChange,
    tightenThreadToRestrictedProfile,
  };
}
