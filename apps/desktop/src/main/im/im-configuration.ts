import { busy } from "./im-runtime-values.js";
import type { Binding } from "./im-runtime-types.js";
import { isExecutionMode } from "@artemis/protocol";

import { randomUUID } from "node:crypto";

import {
  imPolicyVersion,
  imProjectPolicy,
  type ImAuthorizationOperation,
  IM_ADHOC_PROJECT_ID,
  imScopeConfirmation,
  imScopeRevision,
  imPathWithinScope,
  type ImOutboundCandidate,
  type ExecutionGrant,
} from "@artemis/protocol";

import { lstat } from "node:fs/promises";

import {
  assertImGatewayUrl,
  imSettingsSchema,
  type ImSettings,
  type ImStatus,
} from "@artemis/protocol";

import { checkedRemotePath } from "./im-sandbox.js";
import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImConfiguration(
  services: Pick<
    ImCoordinatorDependencies,
    | "config"
    | "get"
    | "serializeAuthorization"
    | "pendingAuthorizations"
    | "savePreparedSettings"
    | "prepareSettings"
    | "token"
    | "text"
    | "ops"
    | "checkSandbox"
    | "http"
    | "spaces"
    | "db"
    | "put"
    | "applySettingsEffects"
    | "list"
    | "grant"
    | "cancelOperations"
    | "remove"
    | "securityReady"
    | "syncSecurity"
    | "error"
    | "state"
    | "leaseUntil"
    | "status"
  >,
) {
  async function save(input: unknown): Promise<ImStatus> {
    const baseline = JSON.stringify(services.config);
    for (const grant of imSettingsSchema.parse(input).grants) {
      for (const scope of grant.security?.scopes ?? []) {
        const old = services.config.grants
          .find((g) => g.projectId === grant.projectId)
          ?.security?.scopes.find((s) => s.audience === scope.audience);
        if (scope.localAccess === "full" && old?.localAccess !== "full")
          throw new Error(
            "Use confirmed group authorization to enable full local access.",
          );
      }
    }
    if (
      services.get("migrations", "authorization-v1") &&
      JSON.stringify(imSettingsSchema.parse(input).grants) !==
        JSON.stringify(services.config.grants)
    )
      throw new Error(
        "Use the versioned group authorization command to change grants.",
      );
    return services.serializeAuthorization(async () => {
      if (baseline !== JSON.stringify(services.config))
        throw new Error("IM settings changed; refresh before saving.");
      if (services.pendingAuthorizations().length)
        throw new Error(
          "Resolve pending group authorization before changing IM settings.",
        );
      return services.savePreparedSettings(
        await services.prepareSettings(input),
      );
    });
  }

  async function prepareSettings(input: unknown): Promise<ImSettings> {
    const baseline = JSON.stringify(services.config);
    const settings = imSettingsSchema.parse(input);
    if (settings.deviceId !== services.config.deviceId)
      throw new Error("Register the device before changing its identity.");
    if (settings.gatewayUrl !== services.config.gatewayUrl && services.token)
      throw new Error("Register separately when changing Gateways.");
    if (settings.enabled) {
      assertImGatewayUrl(settings.gatewayUrl);
      if (!services.token || !settings.deviceId)
        throw new Error(services.text("registerFirst"));
    }
    const projects = services.ops.projects();
    if (
      settings.grants.some(
        (grant) => !projects.some((p) => p.id === grant.projectId),
      )
    )
      throw new Error("Grant references an unavailable project.");
    if (
      settings.defaultProjectId &&
      settings.defaultProjectId !== IM_ADHOC_PROJECT_ID &&
      !projects.some((project) => project.id === settings.defaultProjectId)
    )
      throw new Error("Default project must be available.");
    if (
      new Set(settings.grants.map((g) => g.projectId)).size !==
      settings.grants.length
    )
      throw new Error("Duplicate project grants are not allowed.");
    for (const grant of settings.grants)
      if (
        grant.groups.length > 0 &&
        isExecutionMode(grant.mode) &&
        grant.shell &&
        grant.security?.scopes.some((scope) => scope.localAccess !== "full") &&
        process.platform === "darwin"
      )
        await services.checkSandbox(
          projects.find((p) => p.id === grant.projectId)!.path,
        );
    // A confirmation names the exact recipient roster, not a mutable space ID.
    if (
      settings.grants.some((g) =>
        g.security?.scopes.some(
          (s) =>
            imScopeConfirmation(g.security, s) &&
            s.audience !== "owner" &&
            !s.spaceRevision,
        ),
      )
    ) {
      const status = await (await services.http("/v1/device/status")).json();
      services.spaces = status.spaces ?? [];
      for (const grant of settings.grants)
        for (const scope of grant.security?.scopes ?? []) {
          if (
            !imScopeConfirmation(grant.security, scope) ||
            scope.audience === "owner" ||
            scope.spaceRevision
          )
            continue;
          const space = services.spaces.find(
            (s) => (s as { id?: string }).id === scope.audience.slice(6),
          ) as { revision?: string } | undefined;
          if (!space?.revision)
            throw new Error(services.text("confirmMembers"));
          scope.spaceRevision = space.revision;
        }
    }
    for (const grant of settings.grants) {
      const previous = services.config.grants.find(
        (g) => g.projectId === grant.projectId,
      );
      grant.policyVersion =
        previous &&
        JSON.stringify(imProjectPolicy(previous)) ===
          JSON.stringify(imProjectPolicy(grant))
          ? imPolicyVersion(previous)!
          : randomUUID();
      if (!grant.security) continue;
      const allowed = new Set(["owner", ...grant.groups]);
      const controls = (g: ExecutionGrant) =>
        JSON.stringify([g.mode, g.approval, g.shell, g.network, g.expiresAt]);
      const semantic = (scope: import("@artemis/protocol").ImDataScope) =>
        JSON.stringify({
          audience: scope.audience,
          localAccess: scope.localAccess ?? "project",
          spaceRevision: scope.spaceRevision,
          readPaths: [...scope.readPaths].sort(),
          writePaths: [...scope.writePaths].sort(),
          filePaths: [...(scope.filePaths ?? [])].sort(),
          writeMode: scope.writeMode ?? "selected",
        });
      let changed = false;
      for (const scope of grant.security.scopes) {
        const old = previous?.security?.scopes.find(
          (s) => s.audience === scope.audience,
        );
        const confirmedAt = imScopeConfirmation(grant.security, scope);
        if (!allowed.has(scope.audience))
          throw new Error(services.text("spaceUnauthorized"));
        if (!scope.filePaths && scope.localAccess !== "full") {
          scope.filePaths = [];
          for (const path of scope.readPaths) {
            const full = await checkedRemotePath(
              projects.find((p) => p.id === grant.projectId)!.path,
              path,
            );
            const info = await lstat(full).catch((error) => {
              if (error.code !== "ENOENT") throw error;
              return undefined;
            });
            if (!info?.isDirectory()) scope.filePaths.push(path);
          }
        }
        const same =
          !!old &&
          !!previous?.security &&
          semantic(old) === semantic(scope) &&
          controls(previous) === controls(grant) &&
          !!imScopeConfirmation(previous.security, old) === !!confirmedAt;
        scope.revision = same
          ? imScopeRevision(previous!.security!, old!)
          : randomUUID();
        const retainsReadableData =
          old &&
          previous?.security &&
          (old.localAccess ?? "project") === (scope.localAccess ?? "project") &&
          old.spaceRevision === scope.spaceRevision &&
          (!scope.readPaths.length ||
            (old.readPaths.length > 0 &&
              old.readPaths.every((path) =>
                imPathWithinScope(path, scope.readPaths),
              ))) &&
          (scope.filePaths ?? []).every((file) =>
            old.filePaths?.includes(file),
          );
        scope.contextRevision = retainsReadableData
          ? (old.contextRevision ?? imScopeRevision(previous!.security!, old))
          : scope.revision;
        scope.confirmedAt = confirmedAt;
        changed ||= !same;
      }
      for (const audience of grant.groups) {
        if (
          !previous?.groups.includes(audience) &&
          !grant.security.scopes.some(
            (s) =>
              s.audience === audience && imScopeConfirmation(grant.security, s),
          )
        )
          throw new Error(services.text("confirmNewGroup"));
      }
      if (
        changed ||
        previous?.security?.scopes.length !== grant.security.scopes.length
      )
        grant.security.revision = randomUUID();
      else if (previous?.security)
        grant.security.revision = previous.security.revision;
      grant.security.confirmedAt = Math.max(
        0,
        ...grant.security.scopes.map((s) => s.confirmedAt ?? 0),
      );
    }
    if (baseline !== JSON.stringify(services.config))
      throw new Error("IM settings changed during validation.");
    return settings;
  }

  async function savePreparedSettings(
    settings: ImSettings,
    operation?: ImAuthorizationOperation,
  ): Promise<ImStatus> {
    services.db.exec("SAVEPOINT im_authorization_commit");
    try {
      services.put("settings", "current", settings);
      if (operation) {
        operation.phases.local = "applied";
        const grant = settings.grants.find(
          (g) => g.projectId === operation.command.projectId,
        )!;
        operation.appliedPolicyVersion = imPolicyVersion(grant)!;
        operation.appliedScopeVersion = grant.security?.scopes.find(
          (s) => s.audience === `space:${operation.group!.id}`,
        )?.revision!;
        services.put(
          "group-authorizations",
          operation.command.operationId,
          operation,
        );
      }
      services.db.exec("RELEASE im_authorization_commit");
    } catch (error) {
      services.db.exec(
        "ROLLBACK TO im_authorization_commit; RELEASE im_authorization_commit",
      );
      throw error;
    }
    services.config = settings;
    return services.applySettingsEffects(settings);
  }

  async function applySettingsEffects(settings: ImSettings): Promise<ImStatus> {
    // Invalidate every local operation before waiting on cancellations or the network.
    const invalid = services.list<Binding>("bindings").filter((binding) => {
      const revision = binding.security?.revision;
      try {
        services.grant(binding);
        // Stop in-flight work and retire pending output under the old grant,
        // while retaining the conversation for its next turn.
        return revision !== binding.security?.revision;
      } catch {
        return true;
      }
    });
    for (const binding of invalid) {
      services.cancelOperations(binding.threadId);
      services.remove("permission-blocks", binding.threadId);
    }
    for (const candidate of services.list<ImOutboundCandidate>(
      "outbound-candidates",
    )) {
      if (
        invalid.some((b) => b.threadId === candidate.threadId) &&
        ["pending", "sending"].includes(candidate.state)
      ) {
        services.put("outbound-candidates", candidate.id, {
          ...candidate,
          state: "expired",
        });
        services.remove("outbound-bodies", candidate.id);
        services.remove("outbox", candidate.id);
      }
    }
    const cancellations = invalid
      .filter((binding) => {
        const thread = services.ops.thread(binding.threadId);
        return thread && busy(thread);
      })
      .map((binding) => services.ops.cancel(binding.threadId));
    await Promise.allSettled(cancellations);
    for (const binding of invalid) await services.ops.close(binding.threadId);
    if (services.securityReady)
      await services.syncSecurity().catch(() => {
        services.error = services.text("scopeSyncPending");
      });
    if (!settings.enabled) {
      services.state = "disabled";
      if (services.token && services.leaseUntil > Date.now())
        await services
          .http("/v1/device/release", "POST", {})
          .catch(() => undefined);
      services.leaseUntil = 0;
    }
    return services.status();
  }
  const handlers = {
    save,
    prepareSettings,
    savePreparedSettings,
    applySettingsEffects,
  };
  return handlers;
}
