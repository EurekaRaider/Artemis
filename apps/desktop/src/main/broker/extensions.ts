import { isExecutionMode } from "@artemis/protocol";
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
import {
  conversationApprovalScopes,
  conversationWorkspaceMatches,
} from "../conversation/temporary-conversation.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "store"
  | "trustedExtensionManager"
  | "rejectBrokerRequest"
  | "currentSandboxEscalationError"
  | "resolveThreadWorkspace"
  | "createAutomationApproval"
  | "settingsStore"
  | "approvalProjectId"
  | "hookPermission"
  | "pendingApprovals"
  | "emitPayload"
  | "recordSandboxEscalation"
>;
export function createExtensionBroker(services: Dependencies) {
  const {
    rejectBrokerRequest,
    currentSandboxEscalationError,
    resolveThreadWorkspace,
    createAutomationApproval,
    approvalProjectId,
    hookPermission,
    pendingApprovals,
    emitPayload,
    recordSandboxEscalation,
  } = services;
  async function handleExtensionBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "extension.call" }>,
  ): Promise<void> {
    if (
      !services.agentProcess ||
      !services.store ||
      !services.trustedExtensionManager
    )
      return;
    if (!isExecutionMode(request.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        `${request.mode} mode rejects executable extensions.`,
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
    const context = await resolveThreadWorkspace(thread);
    if (
      !conversationWorkspaceMatches(
        context.workspacePath,
        request.workspacePath,
      )
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Extension workspace does not match the task project.",
      );
      return;
    }
    const status = services.trustedExtensionManager
      .status()
      .find((candidate) => candidate.config.id === request.extensionId);
    const advertised = status?.tools.find(
      (tool) => tool.toolName === request.toolName,
    );
    if (
      status?.state !== "ready" ||
      !advertised ||
      advertised.extensionName !== request.extensionName
    ) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Trusted extension metadata no longer matches the approved file.",
      );
      return;
    }

    const fingerprint = createApprovalFingerprint(
      "extension.call",
      `${request.extensionId}\0${request.toolName}`,
    );
    const approvalSummary = [
      `Run trusted extension ${request.extensionName}: ${request.toolName}`,
      request.sandboxEscalation
        ? `Run outside the local sandbox for this call only: ${request.sandboxEscalation.justification.trim()}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
    const automationResolution = request.sandboxEscalation
      ? undefined
      : createAutomationApproval(request, {
          summary: `Run ${request.extensionName}: ${request.toolName}`,
          network: status.config.allowNetwork ? [request.extensionName] : [],
          risk: status.config.allowNetwork ? "high" : "medium",
        });
    if (automationResolution) {
      await executeApprovedExtension(
        workerRequestId,
        request,
        automationResolution,
      );
      return;
    }
    const approvalPolicy = await services.settingsStore?.approvalPolicy();
    const fullAccessAvailable = getPlatformContract().sandbox.available;
    const rememberedScope =
      !request.sandboxEscalation && approvalPolicy === "custom"
        ? services.store.findApprovalGrant({
            threadId: thread.id,
            projectId: approvalProjectId(thread),
            operation: "extension.call",
            fingerprint,
          })
        : undefined;
    const resolution = (
      scope: "once" | "session" | "project",
      source?: ApprovalResolution["source"],
    ) => ({
      approvalId: request.approvalId,
      nonce: randomUUID(),
      approved: true as const,
      scope,
      ...(source ? { source } : {}),
    });
    if (rememberedScope) {
      await executeApprovedExtension(
        workerRequestId,
        request,
        resolution(rememberedScope, "user"),
      );
      return;
    }
    const approvalOperation = {
      kind: "extension.call" as const,
      allowNetwork:
        status.config.allowNetwork || Boolean(request.sandboxEscalation),
      fullAccess: Boolean(request.sandboxEscalation),
      modelApproval: request.modelApproval,
    };
    if (
      shouldAutoApprove(
        approvalPolicy ?? "ask",
        approvalOperation,
        fullAccessAvailable,
      )
    ) {
      await executeApprovedExtension(
        workerRequestId,
        request,
        resolution("once", approvalPolicy === "agent" ? "model" : "policy"),
      );
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
      await executeApprovedExtension(workerRequestId, request, {
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
      !request.sandboxEscalation && approvalPolicy === "custom"
        ? conversationApprovalScopes(thread, ["once", "session", "project"])
        : (["once"] as const);
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
      paths: [request.workspacePath],
      network: approvalOperation.allowNetwork ? [request.extensionName] : [],
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

  async function executeApprovedExtension(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "extension.call" }>,
    resolution: ApprovalResolution,
  ): Promise<void> {
    if (!services.agentProcess || !services.trustedExtensionManager) return;
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
    try {
      const localFullAccess =
        Boolean(request.sandboxEscalation) ||
        (await services.settingsStore?.localFullAccess());
      if (request.sandboxEscalation) {
        const error = currentSandboxEscalationError(request);
        if (error) throw new Error(error);
      }
      const result = await services.trustedExtensionManager.call(
        request.extensionId,
        request.toolName,
        request.arguments,
        request.workspacePath,
        request.mode,
        localFullAccess,
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
    }
  }
  return { handleExtensionBrokerRequest, executeApprovedExtension };
}
