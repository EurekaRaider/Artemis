import { isExecutionMode } from "@artemis/protocol";
import { ImPermissionError, imRequiresApproval } from "../im/im-policy.js";
import { randomUUID } from "node:crypto";
import {
  evaluateModePolicy,
  getPlatformContract,
  resolveWorkspacePath,
} from "@artemis/platform";
import type { BrokerExecutionRequest, Project } from "@artemis/protocol";
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
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "agentProcess"
  | "store"
  | "hookContext"
  | "cancellingTurns"
  | "imService"
  | "activeTurns"
  | "getHooksService"
  | "mainWindow"
  | "attachmentReads"
  | "attachmentScope"
  | "attachmentStore"
  | "executeApprovedRemote"
  | "pendingApprovals"
  | "emitPayload"
  | "handleGoalBrokerRequest"
  | "handleUserInputBrokerRequest"
  | "handleShellBrokerRequest"
  | "handleLocalFileBrokerRequest"
  | "handleMemoryAppendBrokerRequest"
  | "handleMcpBrokerRequest"
  | "handleExtensionBrokerRequest"
  | "handleOfficeDocumentBrokerRequest"
  | "handlePluginToolBrokerRequest"
  | "resolveThreadWorkspace"
  | "createAutomationApproval"
  | "executeApprovedWrite"
  | "settingsStore"
  | "hookPermission"
>;
export function createBrokerDispatch(services: Dependencies) {
  const {
    hookContext,
    cancellingTurns,
    activeTurns,
    getHooksService,
    attachmentReads,
    attachmentScope,
    attachmentStore,
    executeApprovedRemote,
    pendingApprovals,
    emitPayload,
    handleGoalBrokerRequest,
    handleUserInputBrokerRequest,
    handleShellBrokerRequest,
    handleLocalFileBrokerRequest,
    handleMemoryAppendBrokerRequest,
    handleMcpBrokerRequest,
    handleExtensionBrokerRequest,
    handleOfficeDocumentBrokerRequest,
    handlePluginToolBrokerRequest,
    resolveThreadWorkspace,
    createAutomationApproval,
    executeApprovedWrite,
    hookPermission,
  } = services;
  async function handleBrokerRequest(
    workerRequestId: string,
    request: BrokerExecutionRequest,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) {
      return;
    }
    if (request.kind === "hook.run") {
      try {
        const context = await hookContext({ threadId: request.threadId });
        if (
          !isExecutionMode(context.mode) ||
          !isExecutionMode(request.mode) ||
          cancellingTurns.has(request.threadId)
        )
          throw new Error("Hooks require an active Execute task");
        if (
          !conversationWorkspaceMatches(
            context.workspacePath,
            request.workspacePath,
          )
        )
          throw new Error("Hook workspace mismatch");
        services.imService?.authorizeThread(request.threadId, request.mode);
        const goal = services.store.getThread(request.threadId)?.goal;
        if (
          ["Stop", "SubagentStop"].includes(
            request.invocation.hook_event_name,
          ) &&
          goal?.status === "budgetLimited"
        )
          throw new Error("Goal token budget exhausted");
        const activeTurn = activeTurns.get(request.threadId);
        if (activeTurn && activeTurn !== request.turnId)
          throw new Error("Stale hook invocation");
        if (
          !activeTurn &&
          !["PreCompact", "PostCompact", "SessionStart"].includes(
            request.invocation.hook_event_name,
          )
        )
          throw new Error("Hook requires an active turn");
        const data = await getHooksService().run(context, {
          ...request.invocation,
          session_id: request.threadId,
          cwd: context.workspacePath,
          permission_mode: "work",
        });
        services.agentProcess.post({
          type: "broker.resolve",
          requestId: workerRequestId,
          resolution: {
            approvalId: request.approvalId,
            nonce: randomUUID(),
            approved: true,
            scope: "once",
            source: "policy",
          },
          result: data,
        });
      } catch (error) {
        rejectBrokerRequest(workerRequestId, request, String(error));
      }
      return;
    }
    if (services.imService?.hasBinding(request.threadId)) {
      try {
        services.imService.authorizeThread(request.threadId, request.mode);
        if (
          activeTurns.get(request.threadId) !== request.turnId ||
          services.store.getThread(request.threadId)?.mode !== request.mode ||
          cancellingTurns.has(request.threadId)
        )
          throw new Error("Remote operation requires the current active turn.");
        if (
          services.imService.profile(request.threadId) &&
          request.kind !== "remote.operation" &&
          request.kind !== "user.input" &&
          request.kind !== "attachment.read"
        )
          throw new Error(
            "This tool is not in the owner's remote permission profile.",
          );
      } catch (error) {
        rejectBrokerRequest(
          workerRequestId,
          request,
          error instanceof Error ? error.message : String(error),
        );
        return;
      }
    }
    switch (request.kind) {
      case "plan.submit": {
        try {
          if (
            request.mode !== "plan" ||
            activeTurns.get(request.threadId) !== request.turnId ||
            cancellingTurns.has(request.threadId)
          )
            throw new Error("Plan submission requires the current Plan turn.");
          const plan = services.store.proposePlan(
            request.threadId,
            request.turnId,
            request,
          );
          const event = services.store
            .getThreadEvents(request.threadId)
            .at(-1)!;
          services.mainWindow?.webContents.send(IPC.agentEvents, [event]);
          services.agentProcess.post({
            type: "broker.resolve",
            requestId: workerRequestId,
            resolution: {
              approvalId: request.approvalId,
              nonce: randomUUID(),
              approved: true,
              scope: "once",
              source: "policy",
            },
            result: plan,
          });
        } catch (error) {
          rejectBrokerRequest(workerRequestId, request, String(error));
        }
        return;
      }
      case "attachment.read": {
        const controller = new AbortController();
        const reads =
          attachmentReads.get(request.threadId) ?? new Set<AbortController>();
        reads.add(controller);
        attachmentReads.set(request.threadId, reads);
        try {
          if (
            activeTurns.get(request.threadId) !== request.turnId ||
            services.store.getThread(request.threadId)?.mode !== request.mode ||
            cancellingTurns.has(request.threadId)
          )
            throw new Error(
              "Attachment access requires the current active turn",
            );
          const result = await attachmentStore().operate(
            attachmentScope(request.threadId),
            request.operation,
            controller.signal,
          );
          if (
            controller.signal.aborted ||
            activeTurns.get(request.threadId) !== request.turnId ||
            services.store.getThread(request.threadId)?.mode !== request.mode ||
            cancellingTurns.has(request.threadId)
          )
            throw new Error(
              "Attachment access requires the current active turn",
            );
          services.agentProcess.post({
            type: "broker.resolve",
            requestId: workerRequestId,
            resolution: {
              approvalId: request.approvalId,
              nonce: randomUUID(),
              approved: true,
              scope: "once",
              source: "policy",
            },
            result,
          });
        } catch (error) {
          rejectBrokerRequest(
            workerRequestId,
            request,
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          reads.delete(controller);
          if (!reads.size) attachmentReads.delete(request.threadId);
        }
        return;
      }
      case "remote.operation": {
        try {
          if (!services.imService)
            throw new Error("IM service is unavailable.");
          if (
            activeTurns.get(request.threadId) !== request.turnId ||
            services.store.getThread(request.threadId)?.mode !== request.mode ||
            cancellingTurns.has(request.threadId)
          )
            throw new Error(
              "Group or remote operations require the current active turn.",
            );
          const grant = services.imService.authorizeOperation(
            request.threadId,
            request.operation,
            request.mode,
            request.turnId,
          );
          if (imRequiresApproval(grant.approval, request.operation)) {
            const nonce = randomUUID();
            pendingApprovals.register({
              approvalId: request.approvalId,
              nonce,
              allowedScopes: ["once"],
              value: {
                workerRequestId,
                request: structuredClone(request),
                projectId: services.store.getThread(request.threadId)!
                  .projectId!,
                fingerprint: services.imService.operationFingerprint(
                  request.threadId,
                  request.operation,
                  request.mode,
                  request.turnId,
                ),
                expiresAt: Date.now() + 300000,
              },
            });
            emitPayload(request.threadId, request.turnId, {
              type: "approval.requested",
              approvalId: request.approvalId,
              nonce,
              summary: JSON.stringify(request.operation).slice(0, 2000),
              paths: [],
              network: [],
              risk: request.operation.action === "shell" ? "high" : "medium",
              allowedScopes: ["once"],
              source: "policy",
            });
          } else
            await executeApprovedRemote(workerRequestId, request, {
              approvalId: request.approvalId,
              nonce: randomUUID(),
              approved: true,
              scope: "once",
              source: "policy",
            });
        } catch (error) {
          // Route typed permission denials through the service so it persists the
          // blocked state and returns a park result, without executing the tool.
          if (error instanceof ImPermissionError) {
            services.agentProcess?.post({
              type: "broker.resolve",
              requestId: workerRequestId,
              resolution: {
                approvalId: request.approvalId,
                nonce: randomUUID(),
                approved: true,
                scope: "once",
                source: "policy",
              },
              result: services.imService!.blockPermission(
                request.threadId,
                error,
                request.turnId,
              ),
            });
            return;
          }
          rejectBrokerRequest(
            workerRequestId,
            request,
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      }
      case "goal.get":
      case "goal.create":
      case "goal.update":
        await handleGoalBrokerRequest(workerRequestId, request);
        return;
      case "user.input":
        handleUserInputBrokerRequest(workerRequestId, request);
        return;
      case "shell.execute":
        await handleShellBrokerRequest(workerRequestId, request);
        return;
      case "local.file.read":
      case "local.file.write":
        await handleLocalFileBrokerRequest(workerRequestId, request);
        return;
      case "memory.append":
        await handleMemoryAppendBrokerRequest(workerRequestId, request);
        return;
      case "mcp.call":
        await handleMcpBrokerRequest(workerRequestId, request);
        return;
      case "extension.call":
        await handleExtensionBrokerRequest(workerRequestId, request);
        return;
      case "office.document":
        await handleOfficeDocumentBrokerRequest(workerRequestId, request);
        return;
      case "plugin.tool":
        await handlePluginToolBrokerRequest(workerRequestId, request);
        return;
    }
    const decision = evaluateModePolicy(request.mode, {
      kind: "write",
      summary: `Write ${request.relativePath}`,
      paths: [request.relativePath],
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
        "Agent workspace does not match the task project.",
      );
      return;
    }

    let absolutePath: string;
    try {
      absolutePath = resolveWorkspacePath(
        request.workspacePath,
        request.relativePath,
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
      "workspace.write",
      absolutePath,
    );
    const automationResolution = createAutomationApproval(request, {
      summary: `Write ${request.relativePath}`,
      paths: [request.relativePath],
      risk: decision.outcome === "ask" ? decision.risk : "medium",
    });
    if (automationResolution) {
      await executeApprovedWrite(
        workerRequestId,
        request,
        automationResolution,
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
            operation: "workspace.write",
            fingerprint,
          })
        : undefined;
    if (rememberedScope) {
      await executeApprovedWrite(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: rememberedScope,
        source: "user",
      });
      return;
    }

    const approvalOperation = {
      kind: "workspace.write" as const,
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
      await executeApprovedWrite(workerRequestId, request, {
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
      await executeApprovedWrite(workerRequestId, request, {
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
      summary: `Write ${request.relativePath}`,
      paths: [request.relativePath],
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

  function rejectBrokerRequest(
    workerRequestId: string,
    request: BrokerExecutionRequest,
    error: string,
  ): void {
    services.agentProcess?.post({
      type: "broker.resolve",
      requestId: workerRequestId,
      resolution: {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: false,
        scope: "once",
      },
      error,
    });
  }
  return { handleBrokerRequest, rejectBrokerRequest };
}
