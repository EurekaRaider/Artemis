import { isExecutionMode } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { evaluateModePolicy, getPlatformContract } from "@artemis/platform";
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
import {
  conversationApprovalScopes,
  conversationWorkspaceMatches,
} from "../conversation/temporary-conversation.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "emitPayload"
  | "store"
  | "rejectBrokerRequest"
  | "cancellingTurns"
  | "activeTurns"
  | "resolveThreadWorkspace"
  | "createAutomationApproval"
  | "settingsStore"
  | "approvalProjectId"
  | "hookPermission"
  | "pendingApprovals"
>;
export function createShellBroker(services: Dependencies) {
  const {
    emitPayload,
    rejectBrokerRequest,
    cancellingTurns,
    activeTurns,
    resolveThreadWorkspace,
    createAutomationApproval,
    approvalProjectId,
    hookPermission,
    pendingApprovals,
  } = services;
  async function executeApprovedShell(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "shell.execute" }>,
    resolution: ApprovalResolution,
  ): Promise<void> {
    if (!services.agentProcess) return;
    emitPayload(request.threadId, request.turnId, {
      type: "approval.resolved",
      approvalId: resolution.approvalId,
      nonce: resolution.nonce,
      approved: true,
      scope: resolution.scope,
      ...(resolution.source ? { source: resolution.source } : {}),
    });
    services.agentProcess.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution,
      result: { approved: true },
    });
  }

  async function handleShellBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "shell.execute" }>,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) return;
    if (!isExecutionMode(request.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        `${request.mode} mode rejects shell execution.`,
      );
      return;
    }
    const thread = services.store.getThread(request.threadId);
    if (
      !thread ||
      cancellingTurns.has(request.threadId) ||
      thread.mode !== request.mode ||
      activeTurns.get(request.threadId) !== request.turnId
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Shell execution requires the active Work or Codemode turn.",
      );
      return;
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
        "Shell workspace does not match the task project.",
      );
      return;
    }
    const decision = evaluateModePolicy(request.mode, {
      kind: "shell",
      summary: request.command,
      command: request.command,
    });
    if (decision.outcome === "deny") {
      rejectBrokerRequest(workerRequestId, request, decision.reason);
      return;
    }
    const automationResolution = createAutomationApproval(request, {
      summary: `Run ${request.command}`,
      risk: decision.outcome === "ask" ? decision.risk : "medium",
    });
    if (automationResolution) {
      await executeApprovedShell(
        workerRequestId,
        request,
        automationResolution,
      );
      return;
    }

    const approvalPolicy = await services.settingsStore?.approvalPolicy();
    const fullAccessAvailable = getPlatformContract().sandbox.available;
    const fingerprint = createApprovalFingerprint(
      "shell.execute",
      request.command,
    );
    const rememberedScope =
      approvalPolicy === "custom"
        ? services.store.findApprovalGrant({
            threadId: thread.id,
            projectId: approvalProjectId(thread),
            operation: "shell.execute",
            fingerprint,
          })
        : undefined;
    if (rememberedScope) {
      await executeApprovedShell(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: rememberedScope,
        source: "user",
      });
      return;
    }
    const approvalOperation = {
      kind: "shell.execute" as const,
      minimumRisk: decision.outcome === "ask" ? decision.risk : "medium",
      modelApproval: request.modelApproval,
    };
    if (
      decision.outcome === "allow" ||
      shouldAutoApprove(
        approvalPolicy ?? "ask",
        approvalOperation,
        fullAccessAvailable,
      )
    ) {
      await executeApprovedShell(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
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
    if (hookDecision === "allow") {
      await executeApprovedShell(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
        source: "policy",
      });
      return;
    }
    const nonce = randomUUID();
    const allowedScopes =
      approvalPolicy === "custom" && decision.outcome === "ask"
        ? conversationApprovalScopes(thread, decision.allowedScopes)
        : ["once" as const];
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
      summary: "Run shell command",
      command: request.command,
      paths: [],
      network: [],
      risk: effectiveApprovalRisk(approvalOperation),
      allowedScopes: [...allowedScopes],
      source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
      modelRecommendation: modelMayAutoApprove(approvalOperation)
        ? "approve"
        : "deny",
      modelReason: request.modelApproval.reason,
      ...(request.actorAgentId ? { actorAgentId: request.actorAgentId } : {}),
    });
  }
  return { executeApprovedShell, handleShellBrokerRequest };
}
