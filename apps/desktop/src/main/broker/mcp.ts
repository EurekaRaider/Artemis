import { isExecutionMode } from "@artemis/protocol";
import { resolveComputerTaskApproval } from "../computer-use/approval.js";
import { randomUUID } from "node:crypto";

import { getPlatformContract } from "@artemis/platform";
import type {
  ApprovalResolution,
  BrokerExecutionRequest,
} from "@artemis/protocol";
import {
  effectiveApprovalRisk,
  modelMayAutoApprove,
  shouldAutoApprove,
} from "../security/approval-mode.js";
import { createApprovalFingerprint } from "../security/approval-policy.js";
import { CONNECTOR_AUTH_META } from "../../shared/connectors.js";
import {
  conversationApprovalScopes,
  conversationWorkspaceMatches,
} from "../conversation/temporary-conversation.js";
import { type McpServerConfig } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "store"
  | "mcpClientManager"
  | "rejectBrokerRequest"
  | "currentSandboxEscalationError"
  | "resolveThreadWorkspace"
  | "mcpConfigStore"
  | "connectorService"
  | "createAutomationApproval"
  | "settingsStore"
  | "approvalProjectId"
  | "hookPermission"
  | "pendingApprovals"
  | "emitPayload"
  | "computerUseServerId"
  | "activeTurns"
  | "computerUseHost"
  | "artemisPluginService"
  | "recordSandboxEscalation"
  | "activeMcpCalls"
  | "diagnosticBundleService"
  | "computerUseRuntime"
  | "computerUseCalls"
>;
export function createMcpBroker(services: Dependencies) {
  const {
    rejectBrokerRequest,
    currentSandboxEscalationError,
    resolveThreadWorkspace,
    createAutomationApproval,
    approvalProjectId,
    hookPermission,
    pendingApprovals,
    emitPayload,
    activeTurns,
    recordSandboxEscalation,
    activeMcpCalls,
  } = services;
  async function handleMcpBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
  ): Promise<void> {
    if (!services.agentProcess || !services.store || !services.mcpClientManager)
      return;
    if (!isExecutionMode(request.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        `${request.mode} mode rejects MCP calls because remote side effects cannot be proven read-only.`,
      );
      return;
    }
    const thread = services.store.getThread(request.threadId);
    if (!thread) {
      rejectBrokerRequest(workerRequestId, request, "Task project not found.");
      return;
    }
    if (request.sandboxEscalation !== undefined) {
      const error = currentSandboxEscalationError(request);
      if (error) {
        rejectBrokerRequest(workerRequestId, request, error);
        return;
      }
    }
    let context: Awaited<ReturnType<typeof resolveThreadWorkspace>>;
    try {
      context = await resolveThreadWorkspace(thread);
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (
      !conversationWorkspaceMatches(
        context.workspacePath,
        request.workspacePath,
      )
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "MCP workspace does not match the task project.",
      );
      return;
    }
    const advertised = services.mcpClientManager
      .tools()
      .find(
        (tool) =>
          tool.serverId === request.serverId &&
          tool.toolName === request.toolName,
      );
    if (
      !advertised ||
      advertised.transport !== request.transport ||
      advertised.readOnly !== request.readOnly ||
      advertised.destructive !== request.destructive
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "MCP tool metadata no longer matches the connected server.",
      );
      return;
    }

    const fingerprint = createApprovalFingerprint(
      "mcp.call",
      `${request.serverId}\0${request.toolName}`,
    );
    const mcpConfig = (await services.mcpConfigStore?.list())?.find(
      (config) => config.id === request.serverId,
    );
    if (
      request.sandboxEscalation &&
      (!mcpConfig?.enabled || mcpConfig.transport !== "stdio")
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Sandbox escalation requires an enabled local stdio MCP server.",
      );
      return;
    }
    const connectorAccount = mcpConfig?.connector
      ? (await services.connectorService?.list())?.find(
          (c) => c.id === mcpConfig.id,
        )?.account
      : undefined;
    const stdioFullAccess =
      mcpConfig?.transport === "stdio" &&
      (Boolean(mcpConfig.fullAccess) || Boolean(request.sandboxEscalation));
    const stdioAllowsNetwork =
      stdioFullAccess ||
      (mcpConfig?.transport === "stdio" && mcpConfig.allowNetwork);
    const argumentSummary = JSON.stringify(request.arguments, (key, value) =>
      /token|secret|password|authorization/iu.test(key)
        ? "[REDACTED]"
        : typeof value === "string" && value.length > 160
          ? `${value.slice(0, 160)}…`
          : value,
    ).slice(0, 700);
    const approvalSummary = [
      `Call ${request.serverName}: ${request.toolName}`,
      request.sandboxEscalation
        ? `Run outside the local sandbox for this call only: ${request.sandboxEscalation.justification.trim()}`
        : undefined,
      connectorAccount ? `Connected account: ${connectorAccount}` : undefined,
      request.destructive && argumentSummary
        ? `Target/change: ${argumentSummary}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    const networkTargets = mcpConfig?.connector
      ? [mcpConfig.connector.provider]
      : request.transport === "streamable-http"
        ? [request.serverName]
        : stdioAllowsNetwork
          ? [request.serverName]
          : [];
    const automationResolution = request.sandboxEscalation
      ? undefined
      : createAutomationApproval(request, {
          summary: approvalSummary,
          network: networkTargets,
          risk: request.destructive || stdioFullAccess ? "high" : "medium",
        });
    if (automationResolution && !request.destructive && !stdioFullAccess) {
      await executeApprovedMcp(workerRequestId, request, automationResolution);
      return;
    }
    const approvalPolicy = await services.settingsStore?.approvalPolicy();
    const fullAccessAvailable = getPlatformContract().sandbox.available;
    const rememberedScope =
      !request.destructive &&
      !stdioFullAccess &&
      (approvalPolicy === "agent" || approvalPolicy === "custom")
        ? services.store.findApprovalGrant({
            threadId: thread.id,
            projectId: approvalProjectId(thread),
            operation: "mcp.call",
            fingerprint,
          })
        : undefined;
    const resolution = (scope: "once" | "session" | "project") => ({
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true as const,
      scope,
    });
    if (rememberedScope) {
      await executeApprovedMcp(
        workerRequestId,
        request,
        resolution(rememberedScope),
      );
      return;
    }
    const approvalOperation = {
      kind: "mcp.call" as const,
      readOnly: request.readOnly,
      destructive: request.destructive,
      network: request.transport === "streamable-http" || stdioAllowsNetwork,
      fullAccess: stdioFullAccess,
      toolName: request.toolName,
      modelApproval: request.modelApproval,
      ...(mcpConfig?.connector ? { connectorId: mcpConfig.connector.id } : {}),
    };
    const computerTaskGrant = request.sandboxEscalation
      ? undefined
      : await currentComputerTaskApproval(request, mcpConfig);
    if (computerTaskGrant) {
      await executeApprovedMcp(
        workerRequestId,
        request,
        { ...resolution("once"), source: "policy" },
        computerTaskGrant,
      );
      return;
    }
    if (
      shouldAutoApprove(
        approvalPolicy ?? "ask",
        approvalOperation,
        fullAccessAvailable,
      )
    ) {
      await executeApprovedMcp(workerRequestId, request, {
        ...resolution("once"),
        source: approvalPolicy === "agent" ? "model" : "policy",
      });
      return;
    }

    const hookDecision = await hookPermission(request);
    if (hookDecision === "deny") {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Denied by permission hook",
      );
      return;
    }
    if (hookDecision === "allow" && !request.sandboxEscalation) {
      await executeApprovedMcp(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
        source: "policy",
      });
      return;
    }
    const nonce = randomUUID();
    const allowedScopes = conversationApprovalScopes(
      thread,
      request.destructive || stdioFullAccess
        ? ["once"]
        : ["once", "session", "project"],
    );
    pendingApprovals.register({
      approvalId: request.approvalId,
      nonce,
      allowedScopes: [...allowedScopes],
      value: {
        workerRequestId,
        request,
        projectId: approvalProjectId(thread),
        fingerprint,
      },
    });
    emitPayload(request.threadId, request.turnId, {
      type: "approval.requested",
      approvalId: request.approvalId,
      nonce,
      summary: approvalSummary,
      paths: [],
      network: networkTargets,
      risk: effectiveApprovalRisk(approvalOperation),
      allowedScopes: [...allowedScopes],
      source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
      modelRecommendation: modelMayAutoApprove(approvalOperation)
        ? "approve"
        : "deny",
      modelReason: request.modelApproval.reason,
    });
  }

  function currentComputerTaskApproval(
    request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
    config: McpServerConfig | undefined,
  ): ReturnType<typeof resolveComputerTaskApproval> {
    return resolveComputerTaskApproval(request, {
      serverId: services.computerUseServerId,
      config,
      thread: services.store?.getThread(request.threadId),
      activeTurnId: activeTurns.get(request.threadId),
      host: services.computerUseHost,
      isTrustedServer: async (candidate) =>
        (await services.artemisPluginService?.isComputerUseServer(candidate)) ??
        false,
    });
  }

  async function executeApprovedMcp(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "mcp.call" }>,
    resolution: ApprovalResolution,
    computerTaskGrant?: string,
  ): Promise<void> {
    if (!services.agentProcess || !services.mcpClientManager) return;
    if (request.sandboxEscalation !== undefined) {
      const error = currentSandboxEscalationError(request);
      if (error || resolution.scope !== "once") {
        rejectBrokerRequest(
          workerRequestId,
          request,
          error ?? "Sandbox escalation requires a one-time approval.",
        );
        return;
      }
      recordSandboxEscalation(request, resolution);
    }
    emitPayload(request.threadId, request.turnId, {
      type: "approval.resolved",
      approvalId: resolution.approvalId,
      nonce: resolution.nonce,
      approved: true,
      scope: resolution.scope,
      ...(resolution.source ? { source: resolution.source } : {}),
    });
    const controller = new AbortController();
    activeMcpCalls.set(workerRequestId, {
      threadId: request.threadId,
      serverId: request.serverId,
      controller,
    });
    let releaseComputerGrant: (() => unknown) | undefined;
    let computerCall = false;
    try {
      if (!isExecutionMode(request.mode)) {
        throw new Error(`${request.mode} mode rejects MCP calls.`);
      }
      const config = (await services.mcpConfigStore?.list())?.find(
        (candidate) => candidate.id === request.serverId,
      );
      if (!config?.enabled) throw new Error("This MCP connection is disabled.");
      let privateMetadata: Record<string, unknown> | undefined;
      if (config?.connector) {
        if (!services.connectorService)
          throw new Error("Connector service is not ready.");
        const context = await services.connectorService.context(config);
        if (config.transport === "stdio")
          privateMetadata = { [CONNECTOR_AUTH_META]: context };
      }
      if (request.serverId === services.computerUseServerId) {
        const trusted =
          await services.artemisPluginService?.isComputerUseServer(config);
        const thread = services.store?.getThread(request.threadId);
        if (
          !services.computerUseHost ||
          request.actorAgentId ||
          !isExecutionMode(thread?.mode) ||
          thread.archived ||
          activeTurns.get(request.threadId) !== request.turnId ||
          !trusted
        )
          throw new Error("Computer Use requires the active parent task.");
        if (
          computerTaskGrant &&
          services.computerUseHost.taskApproval(
            request.toolName,
            request.arguments,
            {
              threadId: request.threadId,
              turnId: request.turnId,
              mode: request.mode,
            },
          ) !== computerTaskGrant
        )
          throw new Error(
            "Computer Use task permission changed. Reopen the target before retrying.",
          );
        if (computerTaskGrant)
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "info",
            message: `Computer Use local approval: task ${request.threadId}, task permission ${computerTaskGrant}.`,
          });
        if (
          request.toolName === "computer_open" ||
          request.toolName === "computer_targets"
        )
          await services.computerUseRuntime?.ensure(controller.signal);
        controller.signal.throwIfAborted();
        if (activeTurns.get(request.threadId) !== request.turnId)
          throw new Error(
            "Computer Use task ended during runtime installation.",
          );
        services.computerUseCalls++;
        computerCall = true;
        const grant = services.computerUseHost.server.authorize(
          {
            threadId: request.threadId,
            turnId: request.turnId,
            mode: request.mode,
          },
          request.toolName,
          request.arguments,
        );
        privateMetadata = grant.metadata;
        releaseComputerGrant = grant.dispose;
      }
      controller.signal.throwIfAborted();
      if (request.sandboxEscalation) {
        const error = currentSandboxEscalationError(request);
        if (error) throw new Error(error);
      }
      const result = await services.mcpClientManager.call(
        request.serverId,
        request.toolName,
        request.arguments,
        request.workspacePath,
        request.mode,
        privateMetadata,
        controller.signal,
        ...(request.sandboxEscalation ? ([true] as const) : ([] as const)),
      );
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: workerRequestId,
        resolution,
        result,
      });
    } catch (error) {
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: workerRequestId,
        resolution: { ...resolution, approved: false },
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      releaseComputerGrant?.();
      if (computerCall) {
        services.computerUseCalls--;
        void services.computerUseRuntime
          ?.finishUpdate()
          .catch((error) =>
            console.error("Computer Use activation failed", error),
          );
      }
      activeMcpCalls.delete(workerRequestId);
    }
  }
  return {
    handleMcpBrokerRequest,
    currentComputerTaskApproval,
    executeApprovedMcp,
  };
}
