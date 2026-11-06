import { sandboxEscalationError } from "../security/sandbox-escalation.js";
import type {
  ApprovalResolution,
  BrokerExecutionRequest,
} from "@artemis/protocol";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "activeTurns"
  | "cancellingTurns"
  | "imService"
  | "emitPayload"
  | "agentProcess"
  | "rejectBrokerRequest"
  | "pendingApprovals"
  | "executeApprovedExtension"
  | "executeApprovedMcp"
  | "executeApprovedOffice"
  | "executeApprovedWrite"
  | "executeApprovedLocalFile"
  | "executeApprovedShell"
>;
export function createApprovalBroker(services: Dependencies) {
  const {
    activeTurns,
    cancellingTurns,
    emitPayload,
    rejectBrokerRequest,
    pendingApprovals,
    executeApprovedExtension,
    executeApprovedMcp,
    executeApprovedOffice,
    executeApprovedWrite,
    executeApprovedLocalFile,
    executeApprovedShell,
  } = services;
  function currentSandboxEscalationError(
    request: Extract<
      BrokerExecutionRequest,
      { kind: "mcp.call" | "extension.call" }
    >,
  ): string | undefined {
    const thread = services.store?.getThread(request.threadId);
    const error = sandboxEscalationError(request, {
      mode: thread?.mode,
      turnId: activeTurns.get(request.threadId),
      archived: thread?.archived,
      cancelling: cancellingTurns.has(request.threadId),
    });
    if (error) return error;
    if (services.imService?.hasBinding(request.threadId)) {
      try {
        services.imService.authorizeThread(request.threadId, request.mode);
        if (services.imService.profile(request.threadId))
          return "Sandbox escalation cannot expand a remote permission profile.";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
    return undefined;
  }

  function recordSandboxEscalation(
    request: Extract<
      BrokerExecutionRequest,
      { kind: "mcp.call" | "extension.call" }
    >,
    resolution: ApprovalResolution,
  ): void {
    if (
      !request.sandboxEscalation ||
      (resolution.source !== "model" && resolution.source !== "policy")
    )
      return;
    emitPayload(request.threadId, request.turnId, {
      type: "approval.requested",
      approvalId: resolution.approvalId,
      nonce: resolution.nonce,
      summary: `Run ${request.toolName} outside the local sandbox for this call only: ${request.sandboxEscalation.justification.trim()}`,
      paths: [request.workspacePath],
      network: ["Desktop-user network access"],
      risk: "high",
      allowedScopes: ["once"],
      source: resolution.source,
      modelRecommendation: "approve",
      modelReason: request.modelApproval.reason,
    });
  }

  async function executeApprovedRemote(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "remote.operation" }>,
    resolution: ApprovalResolution,
  ): Promise<void> {
    if (!services.agentProcess || !services.imService) return;
    try {
      if (
        activeTurns.get(request.threadId) !== request.turnId ||
        services.store?.getThread(request.threadId)?.mode !== request.mode ||
        cancellingTurns.has(request.threadId)
      )
        throw new Error("Remote turn has ended or is being cancelled.");
      const result = await services.imService.operate(
        request.threadId,
        request.operation,
        request.mode,
        request.approvalId,
        request.turnId,
      );
      emitPayload(request.threadId, request.turnId, {
        type: "approval.resolved",
        approvalId: resolution.approvalId,
        nonce: resolution.nonce,
        approved: true,
        scope: "once",
      });
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: workerRequestId,
        resolution,
        result,
      });
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function resolveApproval(
    resolution: ApprovalResolution,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) {
      throw new Error("Application is not ready.");
    }
    const pending = pendingApprovals.consume(resolution);
    if (!resolution.approved) {
      emitPayload(pending.request.threadId, pending.request.turnId, {
        type: "approval.resolved",
        approvalId: resolution.approvalId,
        nonce: resolution.nonce,
        approved: false,
        ...(resolution.skipped ? { skipped: true as const } : {}),
        ...(resolution.feedback ? { feedback: resolution.feedback } : {}),
        scope: resolution.scope,
      });
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: pending.workerRequestId,
        resolution,
        error: resolution.feedback
          ? `The user did not authorize this operation. User feedback: ${resolution.feedback}`
          : resolution.skipped
            ? "The user skipped this approval. This operation is not authorized; do not execute it."
            : "The user denied this operation.",
      });
      return;
    }
    if (resolution.scope !== "once") {
      services.store.saveApprovalGrant({
        scope: resolution.scope,
        subjectId:
          resolution.scope === "session"
            ? pending.request.threadId
            : pending.projectId,
        operation: pending.request.kind,
        fingerprint: pending.fingerprint,
        createdAt: new Date().toISOString(),
      });
    }
    if (pending.request.kind === "remote.operation") {
      try {
        if (
          !pending.expiresAt ||
          pending.expiresAt <= Date.now() ||
          pending.fingerprint !==
            services.imService?.operationFingerprint(
              pending.request.threadId,
              pending.request.operation,
              pending.request.mode,
              pending.request.turnId,
            )
        )
          throw new Error(
            "Operation approval expired or its permissions changed.",
          );
      } catch (error) {
        rejectBrokerRequest(
          pending.workerRequestId,
          pending.request,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
      await executeApprovedRemote(
        pending.workerRequestId,
        pending.request,
        resolution,
      );
    } else if (pending.request.kind === "shell.execute") {
      await executeApprovedShell(
        pending.workerRequestId,
        pending.request,
        resolution,
      );
    } else if (
      pending.request.kind === "local.file.read" ||
      pending.request.kind === "local.file.write"
    ) {
      await executeApprovedLocalFile(
        pending.workerRequestId,
        pending.request,
        resolution,
      );
    } else if (pending.request.kind === "workspace.write") {
      await executeApprovedWrite(
        pending.workerRequestId,
        pending.request,
        resolution,
      );
    } else if (pending.request.kind === "office.document") {
      await executeApprovedOffice(
        pending.workerRequestId,
        pending.request,
        resolution,
        true,
      );
    } else if (pending.request.kind === "mcp.call") {
      await executeApprovedMcp(
        pending.workerRequestId,
        pending.request,
        resolution,
      );
    } else if (pending.request.kind === "extension.call") {
      await executeApprovedExtension(
        pending.workerRequestId,
        pending.request,
        resolution,
      );
    }
  }
  return {
    currentSandboxEscalationError,
    recordSandboxEscalation,
    executeApprovedRemote,
    resolveApproval,
  };
}
