import type { LocalFileBrokerRequest } from "../application/runtime-types.js";
import { existsSync } from "node:fs";
import { isExecutionMode } from "@artemis/protocol";
import { recordDesignThinSnapshot } from "../design/design-thin-snapshots.js";
import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getPlatformContract, resolveWorkspacePath } from "@artemis/platform";
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
  readLocalTextFile,
  resolveLocalFilePath,
  writeLocalTextFile,
} from "../workspace/local-file-access.js";
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
  | "settingsStore"
  | "approvalProjectId"
  | "hookPermission"
  | "pendingApprovals"
  | "designArtifactWriteSink"
>;
export function createLocalFileBroker(services: Dependencies) {
  const {
    emitPayload,
    rejectBrokerRequest,
    cancellingTurns,
    activeTurns,
    resolveThreadWorkspace,
    approvalProjectId,
    hookPermission,
    pendingApprovals,
  } = services;
  function localFileRequestSummary(request: LocalFileBrokerRequest): string {
    return `${request.kind === "local.file.read" ? "Read" : "Write"} local file ${request.path}`;
  }

  async function executeApprovedLocalFile(
    workerRequestId: string,
    request: LocalFileBrokerRequest,
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
    try {
      const result =
        request.kind === "local.file.read"
          ? {
              path: resolveLocalFilePath(request.path),
              content: await readLocalTextFile(request.path),
            }
          : await writeLocalTextFile(request.path, request.content);
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

  async function handleLocalFileBrokerRequest(
    workerRequestId: string,
    request: LocalFileBrokerRequest,
  ): Promise<void> {
    if (!services.agentProcess || !services.store) return;
    if (!isExecutionMode(request.mode)) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        `${request.mode} mode rejects local file access.`,
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
        "Local file access requires the active Work or Codemode turn.",
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
        "Agent workspace does not match the task project.",
      );
      return;
    }
    let path: string;
    try {
      path = resolveLocalFilePath(request.path);
    } catch (error) {
      rejectBrokerRequest(
        workerRequestId,
        request,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }

    const approvalPolicy = await services.settingsStore?.approvalPolicy();
    const fullAccessAvailable = getPlatformContract().sandbox.available;
    const fingerprint = createApprovalFingerprint(request.kind, path);
    const rememberedScope =
      approvalPolicy === "custom"
        ? services.store.findApprovalGrant({
            threadId: thread.id,
            projectId: approvalProjectId(thread),
            operation: request.kind,
            fingerprint,
          })
        : undefined;
    if (rememberedScope) {
      await executeApprovedLocalFile(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: rememberedScope,
        source: "user",
      });
      return;
    }

    const approvalOperation = {
      kind: request.kind,
      minimumRisk: "high" as const,
      modelApproval: request.modelApproval,
    };
    if (
      shouldAutoApprove(
        approvalPolicy ?? "ask",
        approvalOperation,
        fullAccessAvailable,
      )
    ) {
      await executeApprovedLocalFile(workerRequestId, request, {
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
      await executeApprovedLocalFile(workerRequestId, request, {
        approvalId: request.approvalId,
        nonce: randomUUID(),
        approved: true,
        scope: "once",
        source: "policy",
      });
      return;
    }
    const nonce = randomUUID();
    const allowedScopes = conversationApprovalScopes(thread, [
      "once",
      "session",
      "project",
    ]);
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
      summary: localFileRequestSummary(request),
      paths: [path],
      network: [],
      risk: effectiveApprovalRisk(approvalOperation),
      allowedScopes: [...allowedScopes],
      source: modelMayAutoApprove(approvalOperation) ? "policy" : "model",
      modelRecommendation: modelMayAutoApprove(approvalOperation)
        ? "approve"
        : "deny",
      modelReason: request.modelApproval.reason,
    });
  }

  async function executeApprovedWrite(
    workerRequestId: string,
    request: Extract<BrokerExecutionRequest, { kind: "workspace.write" }>,
    resolution: ApprovalResolution,
  ): Promise<void> {
    if (!services.agentProcess) {
      return;
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
      const path = resolveWorkspacePath(
        request.workspacePath,
        request.relativePath,
      );
      let operation: "create" | "update" = "create";
      try {
        await stat(path);
        operation = "update";
      } catch {
        // A missing target is a create operation.
      }
      // 写前快照（若文件已存在）：原始状态必须先进历史
      if (existsSync(path) && /\.(html?|htm)$/i.test(path)) {
        await recordDesignThinSnapshot(request.workspacePath, path, {
          source: "pre-change",
        }).catch(() => undefined);
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, request.content, "utf8");
      // 设计薄快照：agent 写入工作区设计页（html/htm）时自动留版本
      //（托管账本退役后的历史实现；失败不打断写入本身）
      await recordDesignThinSnapshot(request.workspacePath, path, {
        source: "agent-write",
        operationId: workerRequestId,
      }).catch(() => undefined);
      // 设计面板开着（线程已绑定）：写入后推送工作区清单快照
      if (services.store?.getThread(request.threadId)?.typeBinding) {
        services.designArtifactWriteSink?.(request.threadId);
      }
      emitPayload(request.threadId, request.turnId, {
        type: "file.changed",
        path: request.relativePath,
        operation,
      });
      services.agentProcess.post({
        type: "broker.resolve",
        requestId: workerRequestId,
        resolution,
        result: { path: request.relativePath, operation },
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
  return {
    localFileRequestSummary,
    executeApprovedLocalFile,
    handleLocalFileBrokerRequest,
    executeApprovedWrite,
  };
}
