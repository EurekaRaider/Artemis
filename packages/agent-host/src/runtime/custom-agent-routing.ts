import { ROOT_AGENT_ID, isTerminalChildStatus } from "./agent-team-policy.js";

import type { HostedThread } from "./runtime-types.js";

import { isExecutionMode } from "@artemis/protocol";

import type { CustomAgentTaskInvocation } from "@artemis/protocol";

import { createHash } from "node:crypto";

import {
  AGENT_TEAM_LOGICAL_MAXIMUM,
  AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
  AGENT_TEAM_SPAWN_BUDGET,
  computeEffectiveCapabilities,
  isDefinitionEffectiveForProject,
  checkCatalogBudget,
  freezeInstanceSnapshot,
  normalizeAgentToken,
  type CapabilityClass,
  type CustomAgentCatalogEntry,
  type CustomAgentDefinition,
  type CustomAgentInstanceSnapshot,
  type AgentPayload,
  type RunMode,
} from "@artemis/protocol";

import {
  CUSTOM_AGENT_CHILD_BASELINE,
  resolveCustomAgentToolCapabilities,
} from "../policy/custom-agent-capabilities.js";
import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createCustomAgentRouting(
  services: Pick<
    AgentRuntimeDependencies,
    | "configuration"
    | "sink"
    | "turnAutoCatalog"
    | "emitCustomAgentRoute"
    | "resolveCustomAgentDispatch"
    | "acceptExplicitCustomAgentInvocation"
    | "ensureTeam"
    | "directChildren"
    | "requestChildCancellation"
    | "threads"
  >,
) {
  function turnAutoCatalog(hosted: HostedThread): {
    entries: CustomAgentCatalogEntry[];
    catalogId: string;
    overflow: boolean;
  } {
    const definitions =
      hosted.turnCustomAgents ?? services.configuration.customAgents ?? [];
    const entries: CustomAgentCatalogEntry[] = definitions
      .filter(
        (definition) =>
          definition.enabled && definition.allowAutomaticInvocation,
      )
      .map((definition) => ({
        definitionId: definition.id,
        revision: definition.revision,
        name: definition.name,
        description: definition.description,
        scope: definition.scope,
        allowAutomaticInvocation: definition.allowAutomaticInvocation,
        triggers: [...definition.triggers],
      }));
    const catalogId = `auto:${createHash("sha256")
      .update(
        entries
          .map((entry) => `${entry.definitionId}@${entry.revision}`)
          .sort()
          .join("\0"),
      )
      .digest("hex")
      .slice(0, 16)}`;
    return {
      entries,
      catalogId,
      overflow: !checkCatalogBudget(entries).withinBudget,
    };
  }

  function emitCustomAgentRoute(
    hosted: HostedThread,
    payload: Omit<
      Extract<AgentPayload, { type: "custom-agent.route" }>,
      "type" | "schemaVersion" | "projectId"
    >,
  ): void {
    if (!hosted.currentTurnId) return;
    services.sink.emit(hosted.threadId, hosted.currentTurnId, {
      type: "custom-agent.route",
      schemaVersion: 1,
      // The main process enriches the trusted projectId from the thread
      // record; the runtime never accepts one from the model.
      projectId: null,
      ...payload,
    });
  }

  function resolveCustomAgentDispatch(
    hosted: HostedThread,
    senderAgentId: string,
    agentId: string | undefined,
    role: string | undefined,
    explicit?: { invocationId: string; revision: number },
  ): CustomAgentInstanceSnapshot | undefined {
    const definitions =
      hosted.turnCustomAgents ?? services.configuration.customAgents ?? [];
    if (!explicit && services.turnAutoCatalog(hosted).overflow) {
      if (agentId !== undefined) {
        throw new Error(
          "CUSTOM_AGENT_NOT_FOUND: automatic routing is disabled because this turn's catalog exceeds its budget.",
        );
      }
      return undefined;
    }
    if (agentId === undefined) {
      if (!role) return undefined;
      const normalizedRole = normalizeAgentToken(role);
      // P1 correction scope is the automatic catalog only: definitions
      // that disabled automatic invocation never hijack a free-text role
      // (D#152 plan section 7 — the model's catalog is the automatic
      // slice, manual-only definitions are @-invoked by users).
      const matches = definitions.filter(
        (definition) =>
          definition.enabled &&
          definition.allowAutomaticInvocation &&
          normalizeAgentToken(definition.name) === normalizedRole,
      );
      if (matches.length === 1) {
        const candidate = matches[0]!;
        const catalog = services.turnAutoCatalog(hosted);
        services.emitCustomAgentRoute(hosted, {
          decision: "reference-required",
          invocationSource: "model-automatic",
          selectionBasis: "role-exact",
          parentAgentId: senderAgentId,
          catalogId: catalog.catalogId,
          catalogSize: catalog.entries.length,
          candidates: [
            {
              definitionId: candidate.id,
              revision: candidate.revision,
              name: candidate.name,
            },
          ],
          errorCode: "CUSTOM_AGENT_REFERENCE_REQUIRED",
        });
        throw new Error(
          `CUSTOM_AGENT_REFERENCE_REQUIRED: role "${role}" exactly names the custom sub-agent "${candidate.name}"; retry with the explicit agent parameter "${candidate.id}".`,
        );
      }
      return undefined;
    }
    const definition = definitions.find(
      (candidate) => candidate.id === agentId,
    );
    if (!definition) {
      throw new Error(
        `CUSTOM_AGENT_NOT_FOUND: no effective custom sub-agent definition "${agentId}" for this project.`,
      );
    }
    const liveDefinition = services.configuration.customAgents?.find(
      (candidate) => candidate.id === agentId,
    );
    if (!liveDefinition || !liveDefinition.enabled || !definition.enabled) {
      throw new Error(
        `CUSTOM_AGENT_DISABLED: custom sub-agent "${definition.name}" is disabled.`,
      );
    }
    // A model-supplied id may only target the automatic catalog; a
    // manual-only definition is invisible to the model and cannot be
    // invoked by it (the model can never forge the user-explicit source).
    if (!explicit && !definition.allowAutomaticInvocation) {
      throw new Error(
        `CUSTOM_AGENT_NOT_FOUND: custom sub-agent "${definition.name}" is not available for automatic invocation.`,
      );
    }
    if (explicit && definition.revision !== explicit.revision) {
      throw new Error(
        `CUSTOM_AGENT_REVISION_CONFLICT: custom sub-agent "${definition.name}" was edited (now revision ${definition.revision}); refresh the reference and retry.`,
      );
    }
    if (
      !isDefinitionEffectiveForProject(
        liveDefinition,
        services.configuration.customAgentProjectIds?.[agentId] ?? [],
        hosted.customAgentProjectId ?? null,
      )
    ) {
      throw new Error(
        "CUSTOM_AGENT_OUT_OF_SCOPE: the definition is no longer effective for this project.",
      );
    }
    const supervisor =
      senderAgentId === ROOT_AGENT_ID
        ? undefined
        : hosted.childAgents.get(senderAgentId);
    const supervisorModel = supervisor?.session?.model;
    const parentSelection = supervisorModel
      ? {
          providerId: supervisorModel.provider,
          modelId: supervisorModel.id,
          thinkingLevel: supervisor!.session!.thinkingLevel,
        }
      : (supervisor?.customAgentSnapshot?.resolvedModel ?? hosted.selection);
    const inheritedContextWindow = supervisor
      ? (supervisorModel?.contextWindow ??
        supervisor.customAgentSnapshot?.resolvedModel.contextWindow)
      : (hosted.session?.model?.contextWindow ?? hosted.contextWindow);
    const resolvedProviderId =
      definition.modelPolicy.kind === "fixed"
        ? definition.modelPolicy.providerId
        : parentSelection?.providerId;
    const resolvedModelId =
      definition.modelPolicy.kind === "fixed"
        ? definition.modelPolicy.modelId
        : parentSelection?.modelId;
    if (!resolvedProviderId || !resolvedModelId) {
      throw new Error(
        "CUSTOM_AGENT_MODEL_UNAVAILABLE: no model is available to inherit from the parent session.",
      );
    }
    const resolvedThinking =
      definition.thinkingPolicy.kind === "fixed"
        ? definition.thinkingPolicy.level
        : (parentSelection?.thinkingLevel ?? null);
    const supervisorCaps: ReadonlySet<CapabilityClass> =
      supervisor?.customAgentSnapshot
        ? new Set(supervisor.customAgentSnapshot.effectiveCapabilities)
        : CUSTOM_AGENT_CHILD_BASELINE;
    const liveGrants = new Set(CUSTOM_AGENT_CHILD_BASELINE);
    if ((services.configuration.mcpTools ?? []).length === 0) {
      liveGrants.delete("mcp");
    }
    const effectiveCapabilities = computeEffectiveCapabilities(
      {
        runMode: hosted.currentMode ?? "plan",
        childBaseline: CUSTOM_AGENT_CHILD_BASELINE,
        parentDelegatable: supervisorCaps,
        liveGrants,
      },
      definition.toolPolicy,
      resolveCustomAgentToolCapabilities,
    );
    return freezeInstanceSnapshot({
      definitionId: definition.id,
      definitionRevision: definition.revision,
      definitionName: definition.name,
      instructions: definition.instructions,
      catalogId: `turn:${hosted.currentTurnId ?? "unknown"}`,
      projectId: hosted.customAgentProjectId ?? null,
      resolvedModel: {
        providerId: resolvedProviderId,
        modelId: resolvedModelId,
        thinkingLevel: resolvedThinking,
        ...(definition.modelPolicy.kind === "inherit" &&
        inheritedContextWindow !== undefined
          ? { contextWindow: inheritedContextWindow }
          : {}),
      },
      effectiveCapabilities,
      toolPolicy: { kind: "inherit" },
      invocationSource: explicit ? "user-explicit" : "model-explicit",
      selectionBasis: "explicit-reference",
      ...(explicit ? { invocationId: explicit.invocationId } : {}),
      frozenAt: Date.now(),
    });
  }

  function acceptExplicitCustomAgentTasks(
    hosted: HostedThread,
    tasks: CustomAgentTaskInvocation[],
  ) {
    if (
      tasks.length > AGENT_TEAM_LOGICAL_MAXIMUM ||
      new Set(tasks.map((task) => task.invocationId)).size !== tasks.length
    ) {
      throw new Error("CUSTOM_AGENT_INVALID: invalid task batch.");
    }
    let newCount = 0;
    // Validate the complete batch before any member is allocated or budget debited.
    for (const task of tasks) {
      if (!task.text.trim())
        throw new Error("CUSTOM_AGENT_INVALID: empty task block.");
      const bound = hosted.explicitCustomAgentInvocations.get(
        task.invocationId,
      );
      if (bound !== undefined) {
        if (!hosted.childAgents.has(bound))
          throw new Error("INVOCATION_OUTCOME_UNKNOWN: task instance is gone.");
        continue;
      }
      newCount++;
      if (
        !services.resolveCustomAgentDispatch(
          hosted,
          ROOT_AGENT_ID,
          task.definitionId,
          undefined,
          task,
        )
      ) {
        throw new Error(
          "CUSTOM_AGENT_NOT_FOUND: task definition is not effective.",
        );
      }
    }
    if (
      (hosted.team?.spawnCount ?? 0) + newCount > AGENT_TEAM_SPAWN_BUDGET ||
      (hosted.team?.memberAgentIds.length ?? 0) + newCount >
        AGENT_TEAM_LOGICAL_MAXIMUM
    ) {
      throw new Error(
        "CUSTOM_AGENT_INVALID: task batch exceeds the team capacity.",
      );
    }
    return tasks.map((task) =>
      services.acceptExplicitCustomAgentInvocation(
        hosted,
        task,
        task.text,
        true,
      ),
    );
  }

  function acceptExplicitCustomAgentInvocation(
    hosted: HostedThread,
    invocation: {
      invocationId: string;
      definitionId: string;
      revision: number;
    },
    taskText: string,
    taskBlock = false,
  ): { agentId: string; definitionName: string; duplicate: boolean } {
    const boundAgentId = hosted.explicitCustomAgentInvocations.get(
      invocation.invocationId,
    );
    if (boundAgentId !== undefined) {
      const bound = hosted.childAgents.get(boundAgentId);
      if (!bound) {
        throw new Error(
          `INVOCATION_OUTCOME_UNKNOWN: explicit invocation ${invocation.invocationId} was committed but its instance is gone; re-execute with a new invocation.`,
        );
      }
      return {
        agentId: boundAgentId,
        definitionName:
          bound.customAgentSnapshot?.definitionName ?? invocation.definitionId,
        duplicate: true,
      };
    }
    const customAgentSnapshot = services.resolveCustomAgentDispatch(
      hosted,
      ROOT_AGENT_ID,
      invocation.definitionId,
      undefined,
      { invocationId: invocation.invocationId, revision: invocation.revision },
    );
    if (!customAgentSnapshot) {
      throw new Error(
        `CUSTOM_AGENT_NOT_FOUND: no effective custom sub-agent definition "${invocation.definitionId}" for this project.`,
      );
    }
    const team = services.ensureTeam(hosted);
    if (team.spawnCount >= AGENT_TEAM_SPAWN_BUDGET) {
      throw new Error(
        `This turn exhausted its ${AGENT_TEAM_SPAWN_BUDGET}-spawn safety budget.`,
      );
    }
    if (team.memberAgentIds.length >= AGENT_TEAM_LOGICAL_MAXIMUM) {
      throw new Error(
        `An agent team may contain at most ${AGENT_TEAM_LOGICAL_MAXIMUM} members.`,
      );
    }
    if (
      !taskBlock &&
      services.directChildren(hosted, ROOT_AGENT_ID).length >=
        AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN
    ) {
      throw new Error(
        `An agent may have at most ${AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN} direct children.`,
      );
    }
    if (!hosted.currentTurnId || !hosted.currentMode) {
      throw new Error("No active turn is available for delegation.");
    }
    const child = hosted.launchChildAgent({
      turnId: hosted.currentTurnId,
      mode: hosted.currentMode,
      parentAgentId: ROOT_AGENT_ID,
      depth: 1,
      label: customAgentSnapshot.definitionName,
      role: customAgentSnapshot.definitionName,
      task: taskText,
      dependsOnAgentIds: [],
      writePaths: [],
      required: true,
      attempt: 1,
      customAgentSnapshot,
    });
    hosted.explicitCustomAgentInvocations.set(
      invocation.invocationId,
      child.agentId,
    );
    const autoCatalog = services.turnAutoCatalog(hosted);
    services.emitCustomAgentRoute(hosted, {
      decision: "accepted",
      invocationSource: "user-explicit",
      selectionBasis: "explicit-id",
      parentAgentId: ROOT_AGENT_ID,
      catalogId: autoCatalog.catalogId,
      catalogSize: autoCatalog.entries.length,
      candidates: [],
      selectedDefinitionId: customAgentSnapshot.definitionId,
      selectedRevision: customAgentSnapshot.definitionRevision,
      instanceId: child.agentId,
      model: {
        providerId: customAgentSnapshot.resolvedModel.providerId,
        modelId: customAgentSnapshot.resolvedModel.modelId,
      },
      capabilities: [...customAgentSnapshot.effectiveCapabilities],
    });
    return {
      agentId: child.agentId,
      definitionName: customAgentSnapshot.definitionName,
      duplicate: false,
    };
  }

  function customAgentToolAllowed(
    name: string,
    snapshot: CustomAgentInstanceSnapshot,
    mode: RunMode,
  ): boolean {
    // Host lifecycle tools remain available even after business access is revoked.
    if (
      [
        "list_agents",
        "wait_agent",
        "wait_team",
        "send_message",
        "finish_subteam",
        "shell_cancel",
      ].includes(name)
    )
      return true;
    if (name === "spawn_agent") return false;
    const configured = services.configuration.mcpTools?.find(
      (tool) => tool.piName === name,
    );
    const ref = configured
      ? {
          kind: "mcp" as const,
          serverId: configured.serverId,
          toolName: configured.toolName,
        }
      : { kind: "builtin" as const, toolId: name };
    const live = services.configuration.customAgents?.find(
      (definition) => definition.id === snapshot.definitionId,
    );
    if (
      live &&
      !isDefinitionEffectiveForProject(
        { ...live, enabled: true },
        services.configuration.customAgentProjectIds?.[live.id] ?? [],
        snapshot.projectId,
      )
    )
      return false;
    if (["model_capabilities", "classify", "generate_image"].includes(name))
      return isExecutionMode(mode);
    // Unknown/removed MCP tools must not fall through as business reads.
    const classes = resolveCustomAgentToolCapabilities(ref);
    const modeCaps = computeEffectiveCapabilities(
      {
        runMode: mode,
        childBaseline: CUSTOM_AGENT_CHILD_BASELINE,
        parentDelegatable: CUSTOM_AGENT_CHILD_BASELINE,
        liveGrants: CUSTOM_AGENT_CHILD_BASELINE,
      },
      { kind: "inherit" },
      resolveCustomAgentToolCapabilities,
    );
    return (
      classes.size > 0 &&
      [...classes].every((capability) => modeCaps.has(capability))
    );
  }

  function reconcileCustomAgentChildren(
    definitions: CustomAgentDefinition[] | undefined,
  ): void {
    for (const hosted of services.threads.values()) {
      for (const child of hosted.childAgents.values()) {
        const snapshot = child.customAgentSnapshot;
        if (!snapshot || child.startedAt) continue;
        if (isTerminalChildStatus(child.status)) continue;
        if (child.status === "cancelling") continue;
        const definition = definitions?.find(
          (candidate) => candidate.id === snapshot.definitionId,
        );
        if (
          !definition ||
          !isDefinitionEffectiveForProject(
            definition,
            services.configuration.customAgentProjectIds?.[definition.id] ?? [],
            snapshot.projectId,
          )
        ) {
          services.requestChildCancellation(hosted, child);
        }
      }
    }
  }
  const handlers = {
    turnAutoCatalog,
    emitCustomAgentRoute,
    resolveCustomAgentDispatch,
    acceptExplicitCustomAgentTasks,
    acceptExplicitCustomAgentInvocation,
    customAgentToolAllowed,
    reconcileCustomAgentChildren,
  };
  return handlers;
}
