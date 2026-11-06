import { errorMessage } from "./im-runtime-values.js";

import {
  IM_AUTHORIZATION_VERSION,
  imAuthorizationFingerprint,
  imAuthorizationCommandSchema,
  imAuthorizationImpactVersion,
  imPolicyVersion,
  imProjectPolicy,
  type ImAuthorizationCommand,
  type ImAuthorizationOperation,
  IM_SECURITY_VERSION,
  imScopeRevision,
  type ExecutionGrant,
  type CollaborationSpace,
} from "@artemis/protocol";

import {
  imConversationKey,
  imIdentityKey,
  type ImIdentity,
  type ImSettings,
} from "@artemis/protocol";

import type { ImCoordinatorDependencies } from "./im-coordinator-dependencies.js";
export function createImAuthorizationCoordinator(
  services: Pick<
    ImCoordinatorDependencies,
    | "authorizationTail"
    | "list"
    | "pendingAuthorizations"
    | "spaces"
    | "usesLocalGateway"
    | "config"
    | "ensureLocalGateway"
    | "http"
    | "ops"
    | "get"
    | "authorizationSnapshot"
    | "checkAuthorizationVersions"
    | "prepareSettings"
    | "authorizationSettings"
    | "db"
    | "put"
    | "savePreparedSettings"
    | "applySettingsEffects"
    | "completingAuthorization"
    | "refreshConnection"
    | "syncSecurity"
    | "syncGroupConversations"
    | "securitySyncTail"
    | "sendSecurity"
    | "pendingAudience"
  >,
) {
  function serializeAuthorization<T>(work: () => Promise<T>): Promise<T> {
    const next = services.authorizationTail.then(work, work);
    services.authorizationTail = next.catch(() => undefined);
    return next;
  }

  function pendingAuthorizations() {
    return services
      .list<ImAuthorizationOperation>("group-authorizations")
      .filter((op) => op.state !== "complete" && op.state !== "superseded");
  }

  function pendingAudience(audience: string, except?: string) {
    return services.pendingAuthorizations().some((op) => {
      const group =
        op.group ??
        (services.spaces as CollaborationSpace[]).find((g) =>
          g.endpoints.some(
            (e) =>
              imConversationKey(e) ===
              imConversationKey(op.command.conversation),
          ),
        );
      return (
        op.command.operationId !== except &&
        group &&
        `space:${group.id}` === audience
      );
    });
  }

  async function authorizationSnapshot(command: ImAuthorizationCommand) {
    if (
      !services.usesLocalGateway() ||
      command.deviceId !== services.config.deviceId
    )
      throw new Error("Native group authorization requires this local device.");
    const credential = await services.ensureLocalGateway();
    const status = await (
      await services.http("/v1/admin/status", "GET", undefined, credential)
    ).json();
    if (status.authorizationVersion !== IM_AUTHORIZATION_VERSION)
      throw new Error(
        "Gateway does not support recoverable authorization. Upgrade before continuing.",
      );
    const paired = (
      status.identities as Array<{ deviceId: string; identity: ImIdentity }>
    ).some(
      (i) =>
        i.deviceId === command.deviceId &&
        imIdentityKey(i.identity) === imIdentityKey(command.owner),
    );
    if (
      !paired ||
      command.owner.connectionId !== command.conversation.connectionId ||
      command.conversation.kind !== "group" ||
      command.conversation.spaceId
    )
      throw new Error("The target group requires its observed paired owner.");
    const observed = (
      status.groups as Array<{
        conversation: import("@artemis/protocol").ImConversation;
        identities: ImIdentity[];
      }>
    ).find(
      (g) =>
        imConversationKey(g.conversation) ===
        imConversationKey(command.conversation),
    );
    if (
      !observed?.identities.some(
        (i) => imIdentityKey(i) === imIdentityKey(command.owner),
      )
    )
      throw new Error(
        "Use your paired account in the target group before authorizing it.",
      );
    const group = (status.spaces as CollaborationSpace[]).find((g) =>
      g.endpoints.some(
        (e) => imConversationKey(e) === imConversationKey(command.conversation),
      ),
    );
    return { credential, group };
  }

  function checkAuthorizationVersions(
    command: ImAuthorizationCommand,
    group?: CollaborationSpace,
    operation?: ImAuthorizationOperation,
  ) {
    const grant = services.config.grants.find(
      (g) => g.projectId === command.projectId,
    );
    const scope = grant?.security?.scopes.find(
      (s) => s.audience === `space:${group?.id}`,
    );
    const applied = operation?.phases.local === "applied";
    const policyVersion = applied
      ? operation.appliedPolicyVersion
      : command.expectedPolicyVersion;
    const scopeVersion = applied
      ? operation.appliedScopeVersion
      : command.expectedScopeVersion;
    const groupVersion =
      operation?.group?.revision ?? command.expectedGroupVersion;
    if (
      imPolicyVersion(grant) !== policyVersion ||
      (scope && grant?.security
        ? imScopeRevision(grant.security, scope)
        : null) !== (scopeVersion ?? null) ||
      (group?.revision ?? null) !== groupVersion ||
      (!applied &&
        (services.config.enabled !== command.expectedDeviceEnabled ||
          imAuthorizationImpactVersion(
            services.config,
            command.projectId,
            !!command.policy,
            command.enableService,
          ) !== command.expectedImpactVersion))
    )
      throw new Error(
        "Authorization version conflict. Review the current policy, group and scope before confirming again.",
      );
    if (!services.ops.projects().some((p) => p.id === command.projectId))
      throw new Error("Project is unavailable.");
  }

  function authorizationSettings(
    command: ImAuthorizationCommand,
    group: CollaborationSpace,
  ): ImSettings {
    const previous = services.config.grants.find(
      (g) => g.projectId === command.projectId,
    );
    if (!previous && !command.policy)
      throw new Error("A new project requires an explicit shared policy.");
    const audience = `space:${group.id}`;
    const grant: ExecutionGrant = {
      ...(previous ?? { projectId: command.projectId, groups: [] }),
      ...(command.policy ?? imProjectPolicy(previous!)),
      groups: [...new Set([...(previous?.groups ?? []), audience])],
      security: {
        version: IM_SECURITY_VERSION,
        revision: previous?.security?.revision ?? command.operationId,
        confirmedAt: command.scope.confirmedAt ?? 0,
        scopes: [
          ...(previous?.security?.scopes.filter(
            (s) => s.audience !== audience,
          ) ?? []),
          {
            ...command.scope,
            audience,
            spaceRevision: group.revision!,
          },
        ],
      },
    };
    return {
      ...services.config,
      enabled: command.enableService || services.config.enabled,
      grants: [
        ...services.config.grants
          .filter((g) => g.projectId !== command.projectId)
          .map((g) => ({
            ...g,
            groups: g.groups.filter((value) => value !== audience),
            ...(g.security
              ? {
                  security: {
                    ...g.security,
                    scopes: g.security.scopes.filter(
                      (s) => s.audience !== audience,
                    ),
                  },
                }
              : {}),
          })),
        grant,
      ],
    };
  }

  async function submitGroupAuthorization(
    raw: ImAuthorizationCommand,
  ): Promise<ImAuthorizationOperation> {
    const command = imAuthorizationCommandSchema.parse(raw);
    if (
      command.intent !== "pause" &&
      command.scope.localAccess === "full" &&
      command.fullAccessConfirmed !== true
    )
      throw new Error(
        "Explicit confirmation is required for full local access.",
      );
    if (command.confirmationFingerprint !== imAuthorizationFingerprint(command))
      throw new Error("The authorization summary changed. Confirm it again.");
    let operation = services.get<ImAuthorizationOperation>(
      "group-authorizations",
      command.operationId,
    );
    if (
      operation &&
      JSON.stringify(operation.command) !== JSON.stringify(command)
    )
      throw new Error(
        "Authorization operation ID conflicts with saved contents.",
      );
    if (operation?.state === "complete" || operation?.state === "superseded")
      return operation;
    if (operation?.state === "conflict") throw new Error(operation.error);
    if (!operation) {
      if (command.gatewayUrl !== services.config.gatewayUrl)
        throw new Error("Gateway identity changed.");
      const pending = services.pendingAuthorizations();
      const superseded = pending.find(
        (op) => op.command.operationId === command.supersedes,
      );
      if (
        pending.length &&
        (!superseded ||
          pending.length !== 1 ||
          imConversationKey(superseded.command.conversation) !==
            imConversationKey(command.conversation))
      )
        throw new Error(
          "Resolve the pending authorization before submitting another change.",
        );
      const { group } = await services.authorizationSnapshot(command);
      services.checkAuthorizationVersions(command, group);
      if (
        (!group && command.intent !== "create") ||
        (group && command.intent === "create")
      )
        throw new Error(
          "The group already exists or no longer exists. Review its current binding.",
        );
      if (
        group?.nativeGroup?.projectId !== command.projectId &&
        group &&
        command.intent !== "rebind"
      )
        throw new Error(
          "A project change requires explicit rebind confirmation.",
        );
      if (
        command.intent !== "pause" &&
        (!command.scope.confirmedAt ||
          (command.policy?.expiresAt ??
            services.config.grants.find(
              (g) => g.projectId === command.projectId,
            )?.expiresAt ??
            0) <= Date.now())
      )
        throw new Error(
          "Confirm the scope and a future expiration before submitting.",
        );
      // Entire scope and sandbox preflight happens before either journal or Gateway writes.
      await services.prepareSettings(
        services.authorizationSettings(
          command,
          group ??
            ({
              id: "authorization-preflight",
              revision: "authorization-preflight",
            } as CollaborationSpace),
        ),
      );
      services.checkAuthorizationVersions(command, group);
      const bindingNeeded =
        !group ||
        group.nativeGroup?.projectId !== command.projectId ||
        group.nativeGroup?.enabled !== (command.intent !== "pause");
      operation = {
        version: IM_AUTHORIZATION_VERSION,
        command,
        state: "pending",
        phases: {
          binding: bindingNeeded ? "pending" : "not-needed",
          local: "pending",
          activation: bindingNeeded ? "pending" : "not-needed",
          sync: "pending",
        },
        ...(bindingNeeded ? {} : { group }),
      };
      services.db.exec("SAVEPOINT im_authorization_begin");
      try {
        if (superseded)
          services.put("group-authorizations", superseded.command.operationId, {
            ...superseded,
            state: "superseded",
          });
        services.put("migrations", "authorization-v1", true);
        services.put("settings", "current", services.config);
        services.put("group-authorizations", command.operationId, operation);
        services.db.exec("RELEASE im_authorization_begin");
      } catch (error) {
        services.db.exec(
          "ROLLBACK TO im_authorization_begin; RELEASE im_authorization_begin",
        );
        throw error;
      }
    }
    const record = operation;
    let phase: keyof ImAuthorizationOperation["phases"] = "binding";
    try {
      let snapshot = await services.authorizationSnapshot(command);
      const binding = {
        conversation: command.conversation,
        owner: command.owner,
        allowedSenders:
          snapshot.group?.participants
            .map((p) => p.identity)
            .filter((i) => imIdentityKey(i) !== imIdentityKey(command.owner)) ??
          [],
        deviceId: command.deviceId,
        name: command.name,
        projectId: command.projectId,
        enabled: command.intent !== "pause",
      };
      // Gateway persists the exact binding input; retries use its saved senders, not a refreshed roster.
      const savedBinding = services.get<typeof binding>(
        "group-authorization-bindings",
        command.operationId,
      );
      const requestBinding = savedBinding ?? binding;
      const gatewayStep = async (step: "prepare" | "activate") => {
        if (!savedBinding)
          services.put(
            "group-authorization-bindings",
            command.operationId,
            requestBinding,
          );
        return (await (
          await services.http(
            "/v1/admin/native-authorization",
            "PUT",
            {
              version: IM_AUTHORIZATION_VERSION,
              operationId: command.operationId,
              ...(command.supersedes ? { supersedes: command.supersedes } : {}),
              phase: step,
              expectedGroupVersion: command.expectedGroupVersion,
              binding: requestBinding,
            },
            snapshot.credential,
          )
        ).json()) as { version: number; group: CollaborationSpace };
      };
      if (
        record.phases.binding !== "not-needed" &&
        record.phases.binding !== "applied"
      ) {
        // Replaying prepare reconciles a lost response against the Gateway journal.
        const result = await gatewayStep("prepare");
        record.group = result.group;
        record.phases.binding = "applied";
        services.put("group-authorizations", command.operationId, record);
      }
      snapshot = await services.authorizationSnapshot(command);
      services.checkAuthorizationVersions(command, snapshot.group, record);
      phase = "local";
      if (record.phases.local !== "applied") {
        const settings = await services.prepareSettings(
          services.authorizationSettings(command, record.group!),
        );
        // Identity and CAS are checked again after asynchronous filesystem and network work.
        snapshot = await services.authorizationSnapshot(command);
        services.checkAuthorizationVersions(command, snapshot.group, record);
        await services.savePreparedSettings(settings, record);
      } else {
        await services.applySettingsEffects(services.config);
      }
      phase = "activation";
      if (
        record.phases.activation !== "not-needed" &&
        record.phases.activation !== "applied"
      ) {
        await gatewayStep("activate");
        record.phases.activation = "applied";
        services.put("group-authorizations", command.operationId, record);
      }
      phase = "sync";
      services.completingAuthorization = command.operationId;
      await services.refreshConnection();
      await services.syncSecurity(command.operationId);
      const security = (await (
        await services.http("/v1/device/security")
      ).json()) as {
        grants: Array<{
          projectId: string;
          audience: string;
          revision: string;
        }>;
      };
      if (
        services.config.enabled &&
        !security.grants.some(
          (g) =>
            g.projectId === command.projectId &&
            g.audience === `space:${record.group!.id}` &&
            g.revision === record.appliedScopeVersion,
        )
      )
        throw new Error(
          "Gateway authorization readback does not match the committed scope.",
        );
      snapshot = await services.authorizationSnapshot(command);
      services.checkAuthorizationVersions(command, snapshot.group, record);
      if (snapshot.group?.nativeGroup?.enabled !== (command.intent !== "pause"))
        throw new Error("Group activation could not be verified.");
      record.phases.sync = "applied";
      record.state = "complete";
      delete record.error;
      services.put("group-authorizations", command.operationId, record);
      await services.syncGroupConversations();
      return record;
    } catch (error) {
      // A local write may already be committed even when cancellation/close rejects.
      const persisted = services.get<ImAuthorizationOperation>(
        "group-authorizations",
        command.operationId,
      )!;
      if (persisted.phases[phase] !== "applied")
        persisted.phases[phase] = phase === "local" ? "failed" : "unknown";
      persisted.error = errorMessage(error);
      if (
        /version conflict|identity is no longer|paired owner/.test(
          persisted.error,
        )
      )
        persisted.state = "conflict";
      services.put("group-authorizations", command.operationId, persisted);
      return persisted;
    } finally {
      services.completingAuthorization = undefined;
    }
  }

  function syncSecurity(completingOperation?: string): Promise<void> {
    const result = services.securitySyncTail.then(() =>
      services.sendSecurity(
        completingOperation ?? services.completingAuthorization,
      ),
    );
    services.securitySyncTail = result.catch(() => undefined);
    return result;
  }

  async function sendSecurity(completingOperation?: string): Promise<void> {
    await services.http("/v1/device/security", "POST", {
      version: IM_SECURITY_VERSION,
      grants: services.config.enabled
        ? services.config.grants.flatMap((g) =>
            g.security
              ? g.security.scopes
                  .filter(
                    (scope) =>
                      (scope.audience === "owner" ||
                        g.groups.includes(scope.audience)) &&
                      !services.pendingAudience(
                        scope.audience,
                        completingOperation,
                      ),
                  )
                  .map((scope) => ({
                    projectId: g.projectId,
                    revision: imScopeRevision(g.security!, scope),
                    audience: scope.audience,
                    expiresAt: g.expiresAt,
                  }))
              : [],
          )
        : [],
    });
  }
  const handlers = {
    serializeAuthorization,
    pendingAuthorizations,
    pendingAudience,
    authorizationSnapshot,
    checkAuthorizationVersions,
    authorizationSettings,
    submitGroupAuthorization,
    syncSecurity,
    sendSecurity,
  };
  return handlers;
}
