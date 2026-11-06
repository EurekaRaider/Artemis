import { ROOT_AGENT_ID, isTerminalChildStatus } from "../agent-team-policy.js";

import type {
  OpenThreadRequest,
  LaunchChildAgentInput,
  ChildAgentExecution,
  AgentTeamSnapshot,
  ChildAgentSnapshot,
} from "../runtime-types.js";

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  AGENT_TEAM_LOGICAL_MAXIMUM,
  AGENT_TEAM_MAXIMUM_DEPTH,
  AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
  AGENT_TEAM_SPAWN_BUDGET,
  matchCatalogLexically,
} from "@artemis/protocol";

import type { AgentRuntimeDependencies } from "../agent-runtime-dependencies.js";
export function createSessionTeamTools(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    | "threads"
    | "resolveCustomAgentDispatch"
    | "turnAutoCatalog"
    | "ensureTeam"
    | "directChildren"
    | "validateTeamWritePaths"
    | "emitChild"
    | "emitCustomAgentRoute"
    | "childSnapshot"
    | "listAgentTeam"
    | "waitForAgentTeam"
    | "suspendAgentLease"
    | "sendAgentTeamMessage"
    | "setAgentWriteScope"
    | "finishAgentTeam"
    | "finishAgentSubteam"
    | "waitForChildAgent"
    | "childAgentStatus"
    | "steerChildAgent"
    | "cancelChildAgent"
    | "takeOverChildAgent"
    | "retryChildAgent"
  >,
  getLaunchChildAgent: () => (
    input: LaunchChildAgentInput,
  ) => ChildAgentExecution,
) {
  const childToolResult = (
    snapshot: ChildAgentSnapshot,
    guidance?: string,
  ) => ({
    content: [
      {
        type: "text" as const,
        text: `${JSON.stringify(snapshot, null, 2)}${guidance ? `\n\n${guidance}` : ""}`,
      },
    ],
    details: snapshot,
  });
  const teamToolResult = (snapshot: AgentTeamSnapshot) => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            team: snapshot.team,
            snapshotKind: snapshot.snapshotKind,
            blockingAgentIds: snapshot.blockingAgentIds,
            observation: snapshot.observation,
            members: snapshot.members.map((member) => ({
              agentId: member.agentId,
              label: member.label,
              parentAgentId: member.parentAgentId,
              depth: member.depth,
              subtreeStatus: member.subtreeStatus,
              directChildCount: member.directChildCount,
              role: member.role,
              task: member.task.slice(0, 512),
              dependsOnAgentIds: member.dependsOnAgentIds,
              required: member.required,
              coordinationStatus: member.coordinationStatus,
              queueReason: member.queueReason,
              status: member.status,
              health: member.health,
              attempt: member.attempt,
              updatedAt: member.updatedAt,
              lastActivityAt: member.lastActivityAt,
              elapsedMilliseconds: member.elapsedMilliseconds,
              currentToolStartedAt: member.currentToolStartedAt,
              writePaths: member.writePaths,
              ...(member.currentTool
                ? { currentTool: member.currentTool }
                : {}),
              ...(member.error ? { error: member.error } : {}),
            })),
            messages: snapshot.messages,
            observationExpired: snapshot.observationExpired,
            guidance:
              "A delta contains only changed members; an empty delta does not mean the team is empty. On blocked, suspect, stalled, or repeated no-progress observations, inspect the affected agents and cancel/retry or take over their work instead of repeatedly waiting. Use cancel_agent with take_over_summary to assume responsibility after the subtree stops, complete and verify its work, then finish_team. A cancelling agent may still hold its write scope.",
          },
          null,
          2,
        ),
      },
    ],
    details: snapshot,
  });
  const createSpawnAgentTool = (senderAgentId: string) =>
    defineTool({
      name: "spawn_agent",
      label: "Delegate to sub-agent",
      description:
        "Start one bounded child task without blocking the current agent. Prefer three to five complementary direct children only when parallel work materially helps. Artemis allows 64 current members, five levels, eight direct children per agent, and queues work above the active capacity.",
      parameters: Type.Object(
        {
          label: Type.String({
            minLength: 1,
            maxLength: 120,
            description: "Short label shown in the Artemis agent tree.",
          }),
          role: Type.Optional(
            Type.String({
              minLength: 1,
              maxLength: 120,
              description: "Specific responsibility within the team.",
            }),
          ),
          task: Type.String({
            minLength: 1,
            maxLength: 32 * 1024,
            description: "Concrete task for the child agent.",
          }),
          depends_on_agent_ids: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
              maxItems: AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
            }),
          ),
          write_paths: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 1_024 }), {
              maxItems: 32,
            }),
          ),
          required: Type.Optional(Type.Boolean()),
          agent: Type.Optional(
            Type.String({
              minLength: 1,
              description:
                "Custom sub-agent definition ID. Prefer a listed custom agent over a free-text role whenever one matches the task; only use a free-text role when nothing matches.",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const hosted = services.threads.get(request.threadId);
        if (!hosted?.currentTurnId || !hosted.currentMode) {
          throw new Error("No active turn is available for delegation.");
        }
        const supervisor =
          senderAgentId === ROOT_AGENT_ID
            ? undefined
            : hosted.childAgents.get(senderAgentId);
        if (
          senderAgentId !== ROOT_AGENT_ID &&
          (!supervisor ||
            supervisor.status === "cancelling" ||
            isTerminalChildStatus(supervisor.status))
        ) {
          throw new Error("Only an active agent may create child agents.");
        }
        if (supervisor?.customAgentSnapshot) {
          throw new Error(
            "CUSTOM_AGENT_NESTED_DELEGATION_DENIED: custom sub-agent definitions cannot delegate further this term.",
          );
        }
        const depth = (supervisor?.depth ?? 0) + 1;
        if (depth > AGENT_TEAM_MAXIMUM_DEPTH) {
          throw new Error(
            `An agent tree may be at most ${AGENT_TEAM_MAXIMUM_DEPTH} levels deep.`,
          );
        }
        const customAgentSnapshot = services.resolveCustomAgentDispatch(
          hosted,
          senderAgentId,
          params.agent,
          params.role,
        );
        // P1 trigger pass (D#152 PR5): task-text hits against the
        // automatic catalog are advisory candidates only. A lexical hit
        // is certainty about text, not about task fit — the spawn
        // proceeds as a free role and the result lists candidates; an
        // explicit model choice above is never overridden by a trigger.
        const autoCatalog = services.turnAutoCatalog(hosted);
        const triggerCandidates =
          customAgentSnapshot || autoCatalog.overflow
            ? []
            : matchCatalogLexically(
                autoCatalog.entries,
                params.role ?? null,
                params.task,
              ).triggerCandidates;
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
          services.directChildren(hosted, senderAgentId).length >=
          AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN
        ) {
          throw new Error(
            `An agent may have at most ${AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN} direct children.`,
          );
        }
        const dependsOnAgentIds = [
          ...new Set(params.depends_on_agent_ids ?? []),
        ];
        for (const dependencyId of dependsOnAgentIds) {
          const dependency = hosted.childAgents.get(dependencyId);
          if (!dependency || !team.memberAgentIds.includes(dependencyId)) {
            throw new Error(
              `A dependency must already belong to this team: ${dependencyId}.`,
            );
          }
          if (
            dependency.parentAgentId !== senderAgentId &&
            !isTerminalChildStatus(dependency.status)
          ) {
            throw new Error(
              "A running dependency must be a direct sibling of the new agent.",
            );
          }
        }
        const child = getLaunchChildAgent()({
          turnId: hosted.currentTurnId,
          mode: hosted.currentMode,
          parentAgentId: senderAgentId,
          depth,
          label: params.label.trim(),
          role: params.role?.trim() || params.label.trim(),
          task: params.task.trim(),
          dependsOnAgentIds,
          writePaths: services.validateTeamWritePaths(
            hosted,
            undefined,
            params.write_paths ?? [],
          ),
          required: params.required ?? true,
          attempt: 1,
          ...(customAgentSnapshot ? { customAgentSnapshot } : {}),
        });
        if (supervisor) services.emitChild(hosted, supervisor);
        // Routing audit (D#152 PR5): exactly one durable record per
        // spawn decision, emitted after the indivisible accept so the
        // instanceId is real.
        if (customAgentSnapshot) {
          services.emitCustomAgentRoute(hosted, {
            decision: "accepted",
            invocationSource:
              customAgentSnapshot.invocationSource === "user-explicit"
                ? "user-explicit"
                : "model-explicit",
            selectionBasis: "explicit-id",
            parentAgentId: senderAgentId,
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
        } else {
          services.emitCustomAgentRoute(hosted, {
            decision: triggerCandidates.length > 0 ? "advisory" : "free-role",
            invocationSource: "none",
            selectionBasis:
              triggerCandidates.length > 0 ? "trigger-words" : "none",
            parentAgentId: senderAgentId,
            catalogId: autoCatalog.catalogId,
            catalogSize: autoCatalog.entries.length,
            candidates: triggerCandidates.map((candidate) => ({
              definitionId: candidate.definitionId,
              revision: candidate.revision,
              name: candidate.name,
            })),
            instanceId: child.agentId,
          });
        }
        const guidance = [
          "The child is running asynchronously. Wait for it only when you need its result; collaboration waits release your active execution slot.",
          ...(triggerCandidates.length > 0
            ? [
                triggerCandidates.length > 1
                  ? `[Routing] The task text lexically matches multiple custom sub-agents: ${triggerCandidates.map((candidate) => `${candidate.name} (id: ${candidate.definitionId})`).join(", ")}. None was chosen automatically, so the child runs as a free role. To delegate to one, spawn again with the agent parameter set to its id.`
                  : `[Routing] The task text lexically matches custom sub-agent ${triggerCandidates[0]!.name} (id: ${triggerCandidates[0]!.definitionId}). The child runs as a free role; to use the custom sub-agent instead, spawn again with the agent parameter set to its id.`,
              ]
            : []),
        ];
        return childToolResult(
          services.childSnapshot(hosted, child),
          guidance.join("\n\n"),
        );
      },
    });
  const spawnAgentTool = createSpawnAgentTool(ROOT_AGENT_ID);
  const listAgentsTool = defineTool({
    name: "list_agents",
    label: "Inspect agent team",
    description:
      "Inspect the current team, member responsibilities, dependencies, health, write scopes, and audited messages.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () =>
      teamToolResult(services.listAgentTeam(request.threadId)),
  });
  const createWaitTeamTool = (actorAgentId: string) =>
    defineTool({
      name: "wait_team",
      label: "Wait for agent team",
      description:
        "Observe the team until a coordination message or member status changes. Waiting releases the current agent's active execution slot and never stops the team.",
      parameters: Type.Object(
        {
          deadline_seconds: Type.Number({ minimum: 1, maximum: 300 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const snapshot = await services.suspendAgentLease(
          request.threadId,
          actorAgentId,
          () =>
            services.waitForAgentTeam(
              request.threadId,
              actorAgentId,
              params.deadline_seconds,
            ),
        );
        if (snapshot.observation)
          snapshot.observation.resumedAt = new Date().toISOString();
        return teamToolResult(snapshot);
      },
    });
  const waitTeamTool = createWaitTeamTool(ROOT_AGENT_ID);
  const createSendMessageTool = (senderAgentId: string) =>
    defineTool({
      name: "send_message",
      label: "Message agent team",
      description:
        "Send one audited finding, request, blocker, or handoff to the parent, all teammates, or one teammate. Use agent IDs from list_agents.",
      parameters: Type.Object(
        {
          recipient: Type.String({ minLength: 1 }),
          kind: Type.Union([
            Type.Literal("finding"),
            Type.Literal("request"),
            Type.Literal("blocker"),
            Type.Literal("handoff"),
          ]),
          message: Type.String({ minLength: 1, maxLength: 8 * 1024 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) => {
        const message = await services.sendAgentTeamMessage(
          request.threadId,
          senderAgentId,
          params.recipient,
          params.kind,
          params.message,
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(message, null, 2) },
          ],
          details: message,
        };
      },
    });
  const sendMessageTool = createSendMessageTool("parent");
  const setAgentWriteScopeTool = defineTool({
    name: "set_agent_write_scope",
    label: "Set agent write scope",
    description:
      "Replace one running member's cooperative workspace-relative write scope. Overlapping scopes are rejected; an empty list makes the workspace write tool read-only.",
    parameters: Type.Object(
      {
        agent_id: Type.String({ minLength: 1 }),
        write_paths: Type.Array(
          Type.String({ minLength: 1, maxLength: 1_024 }),
          { maxItems: 32 },
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) =>
      childToolResult(
        services.setAgentWriteScope(
          request.threadId,
          params.agent_id,
          params.write_paths,
        ),
      ),
  });
  const finishTeamTool = defineTool({
    name: "finish_team",
    label: "Finish agent team",
    description:
      "Close the team only after required members settle and their results have been integrated. Failed required members must be explicitly waived with a concise final summary.",
    parameters: Type.Object(
      {
        waived_agent_ids: Type.Optional(
          Type.Array(Type.String({ minLength: 1 }), {
            maxItems: AGENT_TEAM_LOGICAL_MAXIMUM,
          }),
        ),
        summary: Type.String({ minLength: 1, maxLength: 4 * 1024 }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) =>
      teamToolResult(
        services.finishAgentTeam(
          request.threadId,
          params.waived_agent_ids ?? [],
          params.summary,
        ),
      ),
  });
  const createFinishSubteamTool = (actorAgentId: string) =>
    defineTool({
      name: "finish_subteam",
      label: "Finish child-agent subtree",
      description:
        "Integrate this agent's direct children before returning to its supervisor. Required children must settle; failures need explicit waivers and every nested child subteam must already be integrated.",
      parameters: Type.Object(
        {
          waived_agent_ids: Type.Optional(
            Type.Array(Type.String({ minLength: 1 }), {
              maxItems: AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
            }),
          ),
          summary: Type.String({ minLength: 1, maxLength: 4 * 1024 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          await services.finishAgentSubteam(
            request.threadId,
            actorAgentId,
            params.waived_agent_ids ?? [],
            params.summary,
          ),
        ),
    });
  const createWaitAgentTool = (actorAgentId: string) =>
    defineTool({
      name: "wait_agent",
      label: "Wait for sub-agent",
      description:
        "Observe a sub-agent for a model-selected deadline. Waiting releases the current agent's active execution slot. Deadline expiry does not stop the sub-agent.",
      parameters: Type.Object(
        {
          agent_id: Type.String({ minLength: 1 }),
          deadline_seconds: Type.Number({ minimum: 1, maximum: 300 }),
        },
        { additionalProperties: false },
      ),
      execute: async (_toolCallId, params) =>
        childToolResult(
          await services.suspendAgentLease(request.threadId, actorAgentId, () =>
            services.waitForChildAgent(
              request.threadId,
              params.agent_id,
              params.deadline_seconds,
            ),
          ),
          "If status is healthy and still running, choose another wait window. If it is suspect, stalled, failed, or cancelling too long, stop it and continue another way.",
        ),
    });
  const waitAgentTool = createWaitAgentTool(ROOT_AGENT_ID);
  const getAgentStatusTool = defineTool({
    name: "get_agent_status",
    label: "Check sub-agent",
    description:
      "Immediately inspect a sub-agent's runtime, last activity, current tool, and health without waiting.",
    parameters: Type.Object(
      { agent_id: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) =>
      childToolResult(
        services.childAgentStatus(request.threadId, params.agent_id),
      ),
  });
  const steerAgentTool = defineTool({
    name: "steer_agent",
    label: "Nudge sub-agent",
    description:
      "Send a concise correction or status request to a queued or running sub-agent.",
    parameters: Type.Object(
      {
        agent_id: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1, maxLength: 4 * 1024 }),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) =>
      childToolResult(
        await services.steerChildAgent(
          request.threadId,
          params.agent_id,
          params.message,
        ),
      ),
  });
  const cancelAgentTool = defineTool({
    name: "cancel_agent",
    label: "Stop sub-agent",
    description:
      "Stop a sub-agent that is stuck, unhealthy, unnecessary, or should be replaced. The root may provide take_over_summary to assume responsibility for the stopped subtree; this preserves history and removes its required-member blockers. Complete and verify the remaining work before finish_team.",
    parameters: Type.Object(
      {
        agent_id: Type.String({ minLength: 1 }),
        take_over_summary: Type.Optional(
          Type.String({ minLength: 1, maxLength: 4 * 1024 }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) =>
      childToolResult(
        params.take_over_summary
          ? await services.takeOverChildAgent(
              request.threadId,
              params.agent_id,
              params.take_over_summary,
            )
          : await services.cancelChildAgent(request.threadId, params.agent_id),
        "Inspect the returned status. Do not reuse a cancelling subtree's write scopes. Once it has stopped, retry it or use take_over_summary to take responsibility, complete its work and verify the result before finish_team.",
      ),
  });
  const retryAgentTool = defineTool({
    name: "retry_agent",
    label: "Retry sub-agent",
    description:
      "Retry the same bounded task after its prior sub-agent completed, failed, or was cancelled.",
    parameters: Type.Object(
      { agent_id: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    execute: async (_toolCallId, params) =>
      childToolResult(
        services.retryChildAgent(request.threadId, params.agent_id),
        "Monitor the new agent_id with wait_agent.",
      ),
  });
  return {
    childToolResult,
    teamToolResult,
    createSpawnAgentTool,
    spawnAgentTool,
    listAgentsTool,
    createWaitTeamTool,
    waitTeamTool,
    createSendMessageTool,
    sendMessageTool,
    setAgentWriteScopeTool,
    finishTeamTool,
    createFinishSubteamTool,
    createWaitAgentTool,
    waitAgentTool,
    getAgentStatusTool,
    steerAgentTool,
    cancelAgentTool,
    retryAgentTool,
  };
}
