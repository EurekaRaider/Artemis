import type { Binding } from "./im-runtime-types.js";
import { isExecutionMode } from "@artemis/protocol";

import {
  IM_SECURITY_VERSION,
  imScopeConfirmation,
  imScopeRevision,
  type ImSecurityContext,
  type ExecutionGrant,
} from "@artemis/protocol";
import {
  imAudience,
  requireImScope,
  authorizeImPath,
  authorizeImReadPath,
  ImPermissionError,
  imContentHash,
} from "./im-policy.js";

import {
  imIdentityKey,
  isImOwnerDirectRequest,
  remoteOperationSchema,
  requireImGrant,
  type RemoteExecutionProfile,
  type RemoteInvocationContext,
  type RemoteOperation,
  type RunMode,
} from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImSecurityContext(
  services: Pick<
    ImCoordinatorDependencies,
    | "usesLocalGateway"
    | "text"
    | "config"
    | "executionRequest"
    | "pendingAudience"
    | "ops"
    | "securityReady"
    | "retiredGroup"
    | "identities"
    | "put"
    | "spaces"
    | "secureContext"
    | "checkContext"
    | "leaseUntil"
    | "fullLocalAccess"
    | "get"
    | "scopedExecutionSupported"
    | "grant"
    | "authorizeThread"
    | "authorizeOperation"
    | "groupContext"
    | "remove"
  >,
) {
  function executionRequest(binding: Binding): RemoteInvocationContext {
    // Native assignment TTL is a start deadline. The confirmed project grant
    // and current group revision continue to bound an already started task.
    return (binding.parentThreadId ||
      isImOwnerDirectRequest(binding.request)) &&
      binding.executionStarted
      ? { ...binding.request, expiresAt: Number.MAX_SAFE_INTEGER }
      : binding.request;
  }

  function secureContext(
    binding: Binding,
    source: ImSecurityContext["source"] = binding.request.sourceKind ===
    "tool-result"
      ? "tool-result"
      : binding.request.originator
        ? "member"
        : "owner",
  ): ImSecurityContext {
    if (
      binding.request.conversation.kind === "group" &&
      !services.usesLocalGateway()
    )
      throw new Error(services.text("localGatewayRequired"));
    if (!binding.projectId)
      throw new Error("Ad-hoc tasks carry no project security context.");
    const grant = requireImGrant(
      services.config,
      services.executionRequest(binding),
      binding.projectId,
    );
    const audience = imAudience(binding.request.conversation);
    if (services.pendingAudience(audience))
      throw new Error("Group authorization is not active yet.");
    const scope = requireImScope(
      grant,
      audience,
      undefined,
      services.ops.locale?.() ?? "zh-CN",
    );
    if (
      binding.request.conversation.kind === "group" &&
      scope.spaceRevision !== binding.request.conversation.spaceRevision
    )
      throw new Error(services.text("membersChanged"));
    if (!services.securityReady)
      throw new Error(services.text("gatewayUpgrade"));
    return {
      version: IM_SECURITY_VERSION,
      projectId: binding.projectId,
      revision: imScopeRevision(grant.security!, scope),
      contextRevision:
        scope.contextRevision ?? imScopeRevision(grant.security!, scope),
      audience,
      identityKey: imIdentityKey(binding.request.identity),
      source,
      messageId: binding.request.messageId,
      ...(binding.request.conversation.spaceRevision
        ? { spaceRevision: binding.request.conversation.spaceRevision }
        : {}),
    };
  }

  function checkContext(binding: Binding): ExecutionGrant {
    if (services.retiredGroup(binding))
      throw new Error(services.text("groupRetired"));
    if (isImOwnerDirectRequest(binding.request)) {
      if (
        !services.identities.some(
          (identity) =>
            imIdentityKey(identity) === imIdentityKey(binding.request.identity),
        )
      )
        throw new Error(services.text("identityRevoked"));
      const grant = requireImGrant(
        services.config,
        services.executionRequest(binding),
        binding.projectId ?? "",
      );
      // Saved direct chats no longer carry a group-style data scope.
      if (binding.security) {
        delete binding.security;
        services.put("bindings", binding.threadId, binding);
      }
      return grant;
    }
    if (!binding.projectId) throw new Error(services.text("adhocDirectOnly"));
    if (
      services.pendingAudience(`space:${binding.request.conversation.spaceId}`)
    )
      throw new Error("Group authorization is saved but not active.");
    if (binding.request.conversation.spaceId) {
      const space = services.spaces.find(
        (s) =>
          (s as { id?: string }).id === binding.request.conversation.spaceId,
      ) as { revision?: string; confirmed?: boolean } | undefined;
      if (!space?.confirmed) throw new Error(services.text("scopeUnconfirmed"));
      if (space.revision !== binding.security?.spaceRevision)
        throw new Error(services.text("scopeRevisionChanged"));
    }
    const current = services.secureContext(binding);
    if (
      !binding.security ||
      binding.security.audience !== current.audience ||
      binding.security.identityKey !== current.identityKey ||
      binding.security.spaceRevision !== current.spaceRevision
    )
      throw new Error(services.text("audienceChanged"));
    // Permission changes affect operations, not conversation identity. Keep
    // delivery/approval snapshots versioned so stale work cannot be replayed.
    if (binding.security.revision !== current.revision) {
      binding.security = current;
      services.put("bindings", binding.threadId, binding);
    }
    return requireImGrant(
      services.config,
      services.executionRequest(binding),
      binding.projectId,
    );
  }

  function fullLocalAccess(
    binding: Binding,
    grant = services.checkContext(binding),
  ): boolean {
    const scope = grant.security?.scopes.find(
      (scope) => scope.audience === binding.security?.audience,
    );
    return (
      scope?.localAccess === "full" &&
      !!imScopeConfirmation(grant.security, scope)
    );
  }

  function grant(binding: Binding) {
    const grant = services.checkContext(binding);
    if (services.leaseUntil <= Date.now())
      throw new Error(
        "Gateway device lease is unavailable. Reconnect before executing remote work.",
      );
    if (
      !services.identities.some(
        (i) => imIdentityKey(i) === imIdentityKey(binding.request.identity),
      )
    )
      throw new Error(services.text("identityRevoked"));
    if (binding.request.conversation.spaceRevision) {
      const space = services.spaces.find(
        (value) =>
          typeof value === "object" &&
          value !== null &&
          (value as { id?: string }).id ===
            binding.request.conversation.spaceId,
      ) as { revision?: string; confirmed?: boolean } | undefined;
      if (
        !space?.confirmed ||
        space.revision !== binding.request.conversation.spaceRevision
      )
        throw new Error(services.text("restartAfterScopeChange"));
    }
    return services.fullLocalAccess(binding, grant)
      ? { ...grant, approval: "automatic" as const }
      : grant;
  }

  function profile(threadId: string): RemoteExecutionProfile | undefined {
    const binding = services.get<Binding>("bindings", threadId);
    if (!binding || isImOwnerDirectRequest(binding.request)) return undefined;
    // Expiry alone never removes a remote execution boundary.
    const grant = services.config.grants.find(
      (g) => g.projectId === binding.projectId,
    );
    const dataScope = grant?.security?.scopes.find(
      (s) => s.audience === binding.security?.audience,
    );
    const executionConfirmed =
      !!dataScope && !!imScopeConfirmation(grant?.security, dataScope);
    return {
      collaborationRole:
        binding.request.nativeTaskId || binding.request.collaboration
          ? "worker"
          : "coordinator",
      ...(dataScope
        ? {
            dataScope: executionConfirmed
              ? dataScope
              : {
                  ...dataScope,
                  localAccess: "project" as const,
                  writePaths: [],
                  writeMode: "selected" as const,
                },
          }
        : {}),
      network:
        dataScope?.localAccess === "full" && executionConfirmed
          ? true
          : (grant?.network ?? false),
      shell:
        executionConfirmed &&
        (dataScope?.localAccess === "full" ||
          (services.scopedExecutionSupported && (grant?.shell ?? false))),
      ...(binding.security ? { security: binding.security } : {}),
    };
  }

  function hasBinding(threadId: string): boolean {
    return !!services.get<Binding>("bindings", threadId);
  }

  function authorizeThread(threadId: string, mode: RunMode): void {
    const binding = services.get<Binding>("bindings", threadId);
    if (!binding) return;

    const grant = services.grant(binding);
    if (isExecutionMode(mode) && !isExecutionMode(grant.mode))
      throw new Error("Remote Execute is not authorized for this project.");
  }

  function authorizeOperation(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId?: string,
  ) {
    const binding = services.get<Binding>("bindings", threadId);
    if (!binding) throw new Error("Remote tool is unavailable in this task.");
    const current = services.grant(binding);
    if (operation.action === "participants") {
      if (
        binding.request.conversation.kind !== "group" ||
        !binding.request.conversation.spaceId
      )
        throw new Error(
          "IM participant discovery requires a current group conversation.",
        );
      services.authorizeThread(threadId, mode);
      return current;
    }
    const scope = requireImScope(
      current,
      imAudience(binding.request.conversation),
      undefined,
      services.ops.locale?.() ?? "zh-CN",
    );
    const fullLocal =
      scope.localAccess === "full" &&
      !!imScopeConfirmation(current.security, scope);
    if (operation.action === "read" && !fullLocal)
      authorizeImReadPath(
        requireImScope(
          current,
          imAudience(binding.request.conversation),
          undefined,
          services.ops.locale?.() ?? "zh-CN",
        ),
        operation.path,
        services.ops.locale?.() ?? "zh-CN",
      );
    if (operation.action === "write" && !fullLocal)
      authorizeImPath(
        requireImScope(
          current,
          imAudience(binding.request.conversation),
          "write",
          services.ops.locale?.() ?? "zh-CN",
        ),
        operation.path,
        true,
        services.ops.locale?.() ?? "zh-CN",
      );
    if (operation.action === "shell" || operation.action === "write")
      requireImScope(
        current,
        imAudience(binding.request.conversation),
        "write",
        services.ops.locale?.() ?? "zh-CN",
      );
    if (
      operation.action === "shell" &&
      !fullLocal &&
      !services.scopedExecutionSupported
    )
      throw new Error(services.text("commandScopeUnsupported"));
    if (binding.targetDeviceIds && operation.action === "collaborate") {
      const command = operation.command;
      const targets =
        command.action === "delegate-many"
          ? (command.assignments?.map((a) => a.participantId) ?? [])
          : command.participantId
            ? [command.participantId]
            : [];
      if (targets.some((id) => !binding.targetDeviceIds!.includes(id)))
        throw new Error(services.text("selectedMembersOnly"));
    }
    if (binding.privateLocal && operation.action === "collaborate")
      throw new Error(services.text("localCommandNoSend"));
    if (binding.localExecution && operation.action === "collaborate") {
      if (
        !turnId ||
        services.get<string>("local-turns", turnId) !== threadId ||
        !binding.request.conversation.spaceId
      )
        throw new Error(
          "Group collaboration requires this task's active desktop turn.",
        );
      const grant = services.grant({
        ...binding,
        request: {
          ...binding.request,
          id: `desktop:${turnId}`,
          expiresAt: Date.now() + 30 * 60_000,
        },
      });
      if (!isExecutionMode(mode) || !isExecutionMode(grant.mode))
        throw new Error(
          "Plan cannot dispatch group collaboration. Authorize Execute for this space first.",
        );
      return grant;
    }
    services.authorizeThread(threadId, mode);
    const grant = services.grant(binding);
    if (
      operation.action !== "read" &&
      (!isExecutionMode(mode) || !isExecutionMode(grant.mode))
    )
      throw new Error("Plan cannot execute or publish remote operations.");
    if (operation.action === "shell" && !fullLocal && !grant.shell)
      throw new Error("Remote shell is not authorized.");
    return grant;
  }

  function operationFingerprint(
    threadId: string,
    operation: RemoteOperation,
    mode: RunMode,
    turnId: string,
  ): string {
    services.authorizeOperation(threadId, operation, mode, turnId);
    const binding = services.get<Binding>("bindings", threadId)!;
    return imContentHash(
      JSON.stringify([
        threadId,
        turnId,
        mode,
        binding.security,
        remoteOperationSchema.parse(operation),
      ]),
    );
  }

  function hasGroupCollaboration(threadId: string): boolean {
    const binding = services.get<Binding>("bindings", threadId);
    return (
      !!binding &&
      binding.request.deviceId === services.config.deviceId &&
      binding.request.conversation.kind === "group" &&
      !!binding.request.conversation.spaceId &&
      services.groupContext(binding).capability !== "manual" &&
      !services.groupContext(binding).stale
    );
  }

  function hasPermissionBlock(threadId: string): boolean {
    return !!services.get("permission-blocks", threadId);
  }

  function blockPermission(
    threadId: string,
    denied: ImPermissionError,
    turnId?: string,
  ) {
    services.remove("permission-blocks", threadId);
    const binding = services.get<Binding>("bindings", threadId);
    const grant = binding ? services.grant(binding) : undefined;
    const scope =
      grant && binding
        ? requireImScope(
            grant,
            imAudience(binding.request.conversation),
            undefined,
            services.ops.locale?.() ?? "zh-CN",
          )
        : undefined;
    return {
      state: "operation-denied",
      parkPermission: false,
      code: denied.code,
      ...(scope ? { allowedScope: scope } : {}),
      message: `${denied.message} ${services.text("operationDeniedGuidance", binding?.request)}`,
    };
  }
  const handlers = {
    executionRequest,
    secureContext,
    checkContext,
    fullLocalAccess,
    grant,
    profile,
    hasBinding,
    authorizeThread,
    authorizeOperation,
    operationFingerprint,
    hasGroupCollaboration,
    hasPermissionBlock,
    blockPermission,
  };
  return handlers;
}
