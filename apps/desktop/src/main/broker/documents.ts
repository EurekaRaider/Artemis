import { isExecutionMode } from "@artemis/protocol";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";
import {
  evaluateModePolicy,
  getPlatformContract,
  resolveWorkspacePath,
} from "@artemis/platform";
import type {
  ApprovalResolution,
  BrokerExecutionRequest,
  Project,
} from "@artemis/protocol";
import {
  effectiveApprovalRisk,
  modelMayAutoApprove,
  shouldAutoApprove,
} from "../security/approval-mode.js";
import { createApprovalFingerprint } from "../security/approval-policy.js";
import { OfficeDocumentService } from "../office/office-document-service.js";
import {
  conversationApprovalScopes,
  conversationWorkspaceMatches,
} from "../conversation/temporary-conversation.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "store"
  | "rejectBrokerRequest"
  | "resolveThreadWorkspace"
  | "createAutomationApproval"
  | "settingsStore"
  | "hookPermission"
  | "pendingApprovals"
  | "emitPayload"
  | "activeTurns"
  | "cancellingTurns"
  | "getOfficeWorkbench"
>;
export function createDocumentBroker(services: Dependencies) {
  const {
    rejectBrokerRequest,
    resolveThreadWorkspace,
    createAutomationApproval,
    hookPermission,
    pendingApprovals,
    emitPayload,
    activeTurns,
    cancellingTurns,
    getOfficeWorkbench,
  } = services;
  async function handleOfficeDocumentBrokerRequest(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "office.document" }>,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) return;
    if (!isExecutionMode(request.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        `${request.mode} mode rejects Office document operations.`,
      );
      return;
    }

    const actionKind =
      request.document.operation === "read"
        ? "read"
        : request.document.operation === "delete"
          ? "delete"
          : "write";
    const summary = `${request.document.operation} ${request.document.path}`;
    const decision = evaluateModePolicy(request.mode, {
      kind: actionKind,
      summary,
      paths: [request.document.path],
    });
    if (decision.outcome === "deny") {
      rejectBrokerRequest(workerRequestId, request, decision.reason);
      return;
    }

    const thread = services.store.getThread(request.threadId);
    if (!thread) {
      rejectBrokerRequest(workerRequestId, request, "Task project not found.");
      return;
    }
    if (!isExecutionMode(thread.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Office document operations require an active Execute task.",
      );
      return;
    }

    let project: Project;
    let taskWorkspace: string;
    try {
      const context = await resolveThreadWorkspace(thread);
      project = context.project;
      taskWorkspace = context.workspacePath;
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    if (!conversationWorkspaceMatches(taskWorkspace, request.workspacePath)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        "Office workspace does not match the task project.",
      );
      return;
    }

    let absolutePath: string;
    try {
      absolutePath = resolveWorkspacePath(
        request.workspacePath,
        request.document.path,
      );
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const fingerprint = createApprovalFingerprint(
      `office.${request.document.operation}`,
      absolutePath,
    );
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

    if (decision.outcome === "allow") {
      await executeApprovedOffice(
        workerRequestId,
        request,
        resolution("once"),
        false,
      );
      return;
    }

    const automationResolution = createAutomationApproval(request, {
      summary,
      paths: [request.document.path],
      risk: decision.risk,
    });
    if (automationResolution) {
      await executeApprovedOffice(
        workerRequestId,
        request,
        automationResolution,
        true,
      );
      return;
    }

    const approvalPolicy = await services.settingsStore?.approvalPolicy();
    const fullAccessAvailable = getPlatformContract().sandbox.available;
    const rememberedScope =
      approvalPolicy === "custom"
        ? services.store.findApprovalGrant({
            threadId: thread.id,
            projectId: project.id,
            operation: "office.document",
            fingerprint,
          })
        : undefined;
    if (rememberedScope) {
      await executeApprovedOffice(
        workerRequestId,
        request,
        resolution(rememberedScope, "user"),
        true,
      );
      return;
    }

    const approvalOperation = {
      kind: "workspace.write" as const,
      minimumRisk: decision.risk,
      modelApproval: request.modelApproval,
    };
    const autoApproved = shouldAutoApprove(
      approvalPolicy ?? "ask",
      approvalOperation,
      fullAccessAvailable,
    );
    if (autoApproved) {
      await executeApprovedOffice(
        workerRequestId,
        request,
        resolution("once", approvalPolicy === "agent" ? "model" : "policy"),
        true,
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
    if (hookDecision === "allow") {
      await executeApprovedOffice(
        workerRequestId,
        request,
        {
          approvalId: request.approvalId,
          nonce: randomUUID(),
          approved: true,
          scope: "once",
          source: "policy",
        },
        false,
      );
      return;
    }
    const nonce = randomUUID();
    const allowedScopes =
      approvalPolicy === "custom"
        ? conversationApprovalScopes(thread, decision.allowedScopes)
        : ["once" as const];
    pendingApprovals.register({
      approvalId: request.approvalId,
      nonce,
      allowedScopes: [...allowedScopes],
      value: {
        workerRequestId,
        request,
        projectId: project.id,
        fingerprint,
      },
    });
    emitPayload(request.threadId, request.turnId, {
      type: "approval.requested",
      approvalId: request.approvalId,
      nonce,
      summary,
      paths: [request.document.path],
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

  async function executeApprovedOffice(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "office.document" }>,
    resolution: ApprovalResolution,
    emitApprovalResolution: boolean,
  ): Promise<void> {
    if (!services.agentProcess) return;
    if (emitApprovalResolution) {
      emitPayload(request.threadId, request.turnId, {
        type: "approval.resolved",
        approvalId: resolution.approvalId,
        nonce: resolution.nonce,
        approved: true,
        scope: resolution.scope,
        ...(resolution.source ? { source: resolution.source } : {}),
      });
    }
    try {
      const thread = services.store?.getThread(request.threadId);
      if (
        !isExecutionMode(request.mode) ||
        !isExecutionMode(thread?.mode) ||
        activeTurns.get(request.threadId) !== request.turnId ||
        cancellingTurns.has(request.threadId)
      )
        throw new Error("Office operations require the current Execute turn");
      const workbench = await getOfficeWorkbench();
      if (!(await workbench.status()).activeVersion)
        throw new Error(
          "Install the Office suite in Plugins to use Office features.",
        );
      if (request.document.protocolVersion === 2) {
        const result = await workbench.sessions.execute(request.document, {
          threadId: request.threadId,
          workspacePath: request.workspacePath,
          mode: request.mode,
        });
        if (request.document.operation === "save")
          emitPayload(request.threadId, request.turnId, {
            type: "file.changed",
            path: request.document.path,
            operation: "update",
          });
        services.agentProcess.post({
          type: "broker.resolve",
          requestId: workerRequestId,
          resolution,
          result,
        });
        return;
      }
      const lease = await workbench.packs.acquire();
      const documentResult = await new OfficeDocumentService(
        request.workspacePath,
        join(app.getPath("userData"), "office-lite"),
      )
        .execute(request.document)
        .finally(() => lease.release());
      if (documentResult.changed) {
        const operation =
          request.document.operation === "create"
            ? "create"
            : request.document.operation === "delete"
              ? "delete"
              : "update";
        emitPayload(request.threadId, request.turnId, {
          type: "file.changed",
          path: request.document.path,
          operation,
        });
      }
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: workerRequestId,
        resolution,
        result: documentResult,
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
  return { handleOfficeDocumentBrokerRequest, executeApprovedOffice };
}
