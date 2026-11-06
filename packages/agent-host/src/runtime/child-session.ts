import { createSessionAttachmentTools } from "./tools/session-attachments.js";
import { createSessionRemoteTools } from "./tools/session-remote.js";

import { createSessionMcpTools } from "./tools/session-mcp.js";
import { createSessionTeamTools } from "./tools/session-team.js";

import { createDependencyTool } from "./tools/session-workspace-dependencies.js";
import { createObservedShellTools } from "./tools/session-observed-shell.js";

import { createOfficeDocumentToolFactory } from "./tools/office-document.js";
import { createWriteToolFactory } from "./tools/workspace-write.js";

import { createWebSearchTool } from "./tools/web-search.js";

import {
  isTerminalChildStatus,
  normalizedWritePaths,
  writePathAllowed,
} from "./agent-team-policy.js";
import { createModelStreamIdleWatchdog } from "./stream-health.js";
import type {
  OpenThreadRequest,
  LaunchChildAgentInput,
  ChildAgentExecution,
} from "./runtime-types.js";

import { modelCapabilityTools } from "../models/model-capability-tools.js";
import { isExecutionMode } from "@artemis/protocol";
import { createHooksBridge } from "../tools/hooks-bridge.js";
import {
  configureToolExposure,
  codemodePolicyExtension,
} from "../policy/tool-exposure.js";
import { assertCustomAgentContext } from "../context/custom-agent-context.js";
import { createAttachmentTools } from "../tools/attachment-tools.js";
import {
  createRemoteChildTools,
  isRemoteToolAllowed,
  remoteResourceOverrides,
} from "../tools/remote-tools.js";
import { randomUUID } from "node:crypto";

import { createWorkspaceReadTool } from "../tools/workspace-read-tool.js";
import { dirname, resolve } from "node:path";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createCodemodeExtension,
} from "@earendil-works/pi-coding-agent";

import {
  AGENT_TEAM_LOGICAL_MAXIMUM,
  AGENT_TEAM_MAXIMUM_DEPTH,
  AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN,
  AGENT_TEAM_SPAWN_BUDGET,
  PiAdapter,
  type ModelSelection,
} from "@artemis/protocol";
import { modeInstruction } from "../policy/mode-instructions.js";

import { configureModelContextWindow } from "../context/context-window.js";
import { createResourceOverrides } from "../policy/resource-overrides.js";
import { omitReasoningFromSession } from "../models/reasoning-persistence.js";
import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
interface ChildSessionContext {
  readonly modelRuntime: Awaited<
    ReturnType<AgentRuntimeDependencies["getModelRuntime"]>
  >;
  readonly createObservedBashTools: ReturnType<
    typeof createObservedShellTools
  >["createObservedBashTools"];
  readonly createWriteTool: ReturnType<typeof createWriteToolFactory>;
  readonly invokeRemoteOperation: ReturnType<
    typeof createSessionRemoteTools
  >["invokeRemoteOperation"];
  readonly createOfficeDocumentTool: ReturnType<
    typeof createOfficeDocumentToolFactory
  >;
  readonly createSendMessageTool: ReturnType<
    typeof createSessionTeamTools
  >["createSendMessageTool"];
  readonly createSpawnAgentTool: ReturnType<
    typeof createSessionTeamTools
  >["createSpawnAgentTool"];
  readonly createWaitAgentTool: ReturnType<
    typeof createSessionTeamTools
  >["createWaitAgentTool"];
  readonly createWaitTeamTool: ReturnType<
    typeof createSessionTeamTools
  >["createWaitTeamTool"];
  readonly createFinishSubteamTool: ReturnType<
    typeof createSessionTeamTools
  >["createFinishSubteamTool"];
  readonly createMcpTools: ReturnType<
    typeof createSessionMcpTools
  >["createMcpTools"];
  readonly invokeAttachmentOperation: ReturnType<
    typeof createSessionAttachmentTools
  >["invokeAttachmentOperation"];
  readonly webSearchTool: ReturnType<typeof createWebSearchTool>;
  readonly loadWorkspaceDependenciesTool: ReturnType<
    typeof createDependencyTool
  >["loadWorkspaceDependenciesTool"];
  readonly listAgentsTool: ReturnType<
    typeof createSessionTeamTools
  >["listAgentsTool"];
  readonly mcpToolByPiName: ReturnType<
    typeof createSessionMcpTools
  >["mcpToolByPiName"];
}
export function createChildSessionLauncher(
  request: OpenThreadRequest,
  services: Pick<
    AgentRuntimeDependencies,
    | "threads"
    | "ensureTeam"
    | "emitChild"
    | "emitTeam"
    | "cancelledTurns"
    | "configuration"
    | "broker"
    | "agentDir"
    | "codemodeWorkers"
    | "getModelRuntime"
    | "customAgentToolAllowed"
    | "promptCache"
    | "configureSessionCompaction"
    | "promptCacheUsage"
    | "sink"
    | "waitForProviderAdmission"
    | "providerAdmissionBlockedUntil"
    | "modelStreamIdleTimeoutMs"
    | "directChildren"
    | "sendAgentTeamMessage"
    | "requestChildCancellation"
    | "descendantAgents"
    | "bashExecutions"
    | "recordProviderBackoff"
    | "concurrency"
  >,
  context: ChildSessionContext,
): (input: LaunchChildAgentInput) => ChildAgentExecution {
  return (input) => {
    const hosted = services.threads.get(request.threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${request.threadId}`);
    }
    if (input.customAgentSnapshot) {
      const selection = input.customAgentSnapshot.resolvedModel;
      const model = context.modelRuntime.getModel(
        selection.providerId,
        selection.modelId,
      );
      if (!model)
        throw new Error(
          `CUSTOM_AGENT_MODEL_UNAVAILABLE: ${selection.providerId}/${selection.modelId}`,
        );
    }
    const agentId = randomUUID();
    const controller = new AbortController();
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const now = Date.now();
    const child: ChildAgentExecution = {
      ...input,
      agentId,
      status: "queued",
      controller,
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
      output: "",
      pendingSteers: [],
      recentObservationMilliseconds: [],
      activityVersion: 0,
      activityWaiters: new Set(),
      subtreeIntegrated: false,
      done,
      settle,
    };
    const team = services.ensureTeam(hosted);
    if (team.spawnCount >= AGENT_TEAM_SPAWN_BUDGET) {
      throw new Error(
        `This turn exhausted its ${AGENT_TEAM_SPAWN_BUDGET}-spawn safety budget.`,
      );
    }
    if (input.replacesAgentId) {
      const replacedIndex = team.memberAgentIds.indexOf(input.replacesAgentId);
      if (replacedIndex >= 0) {
        team.memberAgentIds.splice(replacedIndex, 1, agentId);
      } else {
        team.memberAgentIds.push(agentId);
      }
      team.requiredAgentIds.delete(input.replacesAgentId);
      team.blockedAgentIds.delete(input.replacesAgentId);
      for (const member of hosted.childAgents.values()) {
        if (!member.dependsOnAgentIds.includes(input.replacesAgentId)) {
          continue;
        }
        member.dependsOnAgentIds = member.dependsOnAgentIds.map(
          (dependencyId) =>
            dependencyId === input.replacesAgentId ? agentId : dependencyId,
        );
        services.emitChild(hosted, member);
      }
    } else {
      if (team.memberAgentIds.length >= AGENT_TEAM_LOGICAL_MAXIMUM) {
        throw new Error(
          `An agent team may contain at most ${AGENT_TEAM_LOGICAL_MAXIMUM} members.`,
        );
      }
      team.memberAgentIds.push(agentId);
    }
    team.spawnCount += 1;
    if (input.required) team.requiredAgentIds.add(agentId);
    delete child.replacesAgentId;
    hosted.childAgents.set(agentId, child);
    team.status = "running";
    services.emitChild(hosted, child);
    services.emitTeam(hosted);

    const cancellationKey = `${request.threadId}\0${input.turnId}`;
    const dependencies = input.dependsOnAgentIds
      .map((dependencyId) => hosted.childAgents.get(dependencyId))
      .filter((dependency): dependency is ChildAgentExecution =>
        Boolean(dependency),
      );
    const dependenciesReady = new Promise<void>((resolve, reject) => {
      const abort = () => {
        controller.signal.removeEventListener("abort", abort);
        reject(new DOMException("Aborted", "AbortError"));
      };
      if (controller.signal.aborted) {
        abort();
        return;
      }
      controller.signal.addEventListener("abort", abort, { once: true });
      void Promise.all(dependencies.map((dependency) => dependency.done)).then(
        () => {
          controller.signal.removeEventListener("abort", abort);
          resolve();
        },
      );
    });
    void dependenciesReady
      .then(async () => {
        controller.signal.throwIfAborted();
        const failedDependency = dependencies.find(
          (dependency) => dependency.status !== "completed",
        );
        if (failedDependency) {
          child.status = "blocked";
          child.error = `Dependency ${failedDependency.agentId} finished with ${failedDependency.status}.`;
          child.lastActivityAt = Date.now();
          team.blockedAgentIds.add(child.agentId);
          services.emitChild(hosted, child);
          child.settle();
          return;
        }
        await services.concurrency.run(
          "child",
          async (lease) => {
            hosted.activeLeases.set(agentId, lease);
            if (
              controller.signal.aborted ||
              services.cancelledTurns.has(cancellationKey)
            ) {
              throw new DOMException("Aborted", "AbortError");
            }

            child.status = "running";
            child.startedAt = Date.now();
            child.lastActivityAt = child.startedAt;
            services.emitChild(hosted, child);

            let unsubscribe = () => {};
            let pendingActivity = "";
            let activityUpdateTimer: ReturnType<typeof setTimeout> | undefined;
            const frozenSnapshot = input.customAgentSnapshot;
            const frozenSelection: ModelSelection | undefined = frozenSnapshot
              ? {
                  providerId: frozenSnapshot.resolvedModel.providerId,
                  modelId: frozenSnapshot.resolvedModel.modelId,
                  thinkingLevel: (frozenSnapshot.resolvedModel.thinkingLevel ??
                    "off") as ModelSelection["thinkingLevel"],
                }
              : undefined;
            const childProviderId =
              frozenSelection?.providerId ?? hosted.selection?.providerId;
            const childAdapter = new PiAdapter(
              `${input.turnId}:child:${agentId}`,
            );
            const childToolNames = new Map<string, string>();
            const childTextParts = new Map<string, string>();
            const emitActivityUpdate = () => {
              const activityDelta = pendingActivity;
              pendingActivity = "";
              if (!activityDelta) return;
              services.emitChild(hosted, child, { activityDelta });
            };
            const scheduleActivityUpdate = (delta: string) => {
              child.lastActivityAt = Date.now();
              pendingActivity = `${pendingActivity}${delta}`.slice(-8 * 1024);
              if (activityUpdateTimer) return;
              activityUpdateTimer = setTimeout(() => {
                activityUpdateTimer = undefined;
                emitActivityUpdate();
              }, 1_000);
            };
            const flushActivityUpdate = () => {
              if (activityUpdateTimer) clearTimeout(activityUpdateTimer);
              activityUpdateTimer = undefined;
              emitActivityUpdate();
            };

            try {
              const {
                contextWindow: _parentContextWindow,
                ...childConfiguration
              } = services.configuration;
              const childContextWindow = frozenSnapshot
                ? frozenSnapshot.resolvedModel.contextWindow
                : hosted.contextWindow;
              const childOverrides = createResourceOverrides(
                () => ({
                  ...childConfiguration,
                  ...(frozenSelection
                    ? { selection: frozenSelection }
                    : hosted.selection
                      ? { selection: hosted.selection }
                      : {}),
                  ...(childContextWindow === undefined
                    ? {}
                    : { contextWindow: childContextWindow }),
                }),
                "child",
              );
              if (frozenSnapshot) {
                const baseAppend = childOverrides.appendSystemPromptOverride;
                childOverrides.appendSystemPromptOverride = (base) => [
                  ...(baseAppend ? baseAppend(base) : base),
                  `## Dedicated instructions (custom sub-agent "${frozenSnapshot.definitionName}", revision ${frozenSnapshot.definitionRevision})\n${frozenSnapshot.instructions}`,
                ];
              }
              const childHooksBridge = createHooksBridge({
                enabled: () => services.configuration.hooksEnabled === true,
                broker: services.broker,
                threadId: request.threadId,
                cwd: request.workspacePath,
                actorId: agentId,
                mode: () => input.mode,
                turnId: () => hosted.currentTurnId,
                canContinue: () =>
                  !controller.signal.aborted &&
                  Boolean(hosted.currentTurnId) &&
                  !services.cancelledTurns.has(
                    `${request.threadId}\0${hosted.currentTurnId}`,
                  ),
              });
              const childResourceLoader = new DefaultResourceLoader({
                cwd: request.workspacePath,
                agentDir: services.agentDir,
                noExtensions: true,
                extensionFactories: [
                  childHooksBridge.factory,
                  codemodePolicyExtension(() => input.mode),
                  createCodemodeExtension({
                    mode: "only",
                    models: true,
                    acquireWorker: (signal) =>
                      services.codemodeWorkers.acquire(signal),
                  }),
                ],
                ...childOverrides,
                ...(request.remoteExecution
                  ? remoteResourceOverrides(request.remoteExecution)
                  : {}),
              });
              await childResourceLoader.reload();
              controller.signal.throwIfAborted();
              const modelRuntime = await services.getModelRuntime();
              const selection = frozenSelection ?? hosted.selection;
              const catalogModel = selection
                ? modelRuntime.getModel(selection.providerId, selection.modelId)
                : undefined;
              if (frozenSnapshot && !catalogModel) {
                // Fixed (or inherited-then-removed) models fail loudly;
                // never silently switch provider, model, or tier.
                throw new Error(
                  `CUSTOM_AGENT_MODEL_UNAVAILABLE: ${frozenSnapshot.resolvedModel.providerId}/${frozenSnapshot.resolvedModel.modelId}`,
                );
              }
              const selectedModel = catalogModel
                ? configureModelContextWindow(
                    catalogModel,
                    frozenSnapshot
                      ? frozenSnapshot.resolvedModel.contextWindow
                      : hosted.contextWindow,
                  )
                : undefined;
              const childBashTools = context.createObservedBashTools(() => ({
                turnId: input.turnId,
                ownerId: agentId,
                mode: input.mode,
              }));
              const childWriteTool = context.createWriteTool(() => ({
                actorAgentId: agentId,
                writePaths: child.writePaths,
              }));
              const childRemoteTools = request.remoteExecution
                ? createRemoteChildTools(
                    context.invokeRemoteOperation,
                    (path) =>
                      isExecutionMode(input.mode) &&
                      writePathAllowed(
                        child.writePaths,
                        normalizedWritePaths(request.workspacePath, [path])[0]!,
                      ),
                    request.remoteExecution,
                  )
                : [];
              const childOfficeDocumentTool = context.createOfficeDocumentTool(
                () => ({
                  actorAgentId: agentId,
                  writePaths: child.writePaths,
                }),
              );
              const childSendMessageTool =
                context.createSendMessageTool(agentId);
              const childSpawnAgentTool = frozenSnapshot
                ? null
                : context.createSpawnAgentTool(agentId);
              const childWaitAgentTool = context.createWaitAgentTool(agentId);
              const childWaitTeamTool = context.createWaitTeamTool(agentId);
              const childFinishSubteamTool =
                context.createFinishSubteamTool(agentId);
              const childMcpTools = isExecutionMode(input.mode)
                ? context.createMcpTools(agentId)
                : [];
              const childTools = [
                ...modelCapabilityTools(modelRuntime, () => input.mode),
                ...createAttachmentTools((operation) =>
                  context.invokeAttachmentOperation(operation, child.session),
                ),
                ...childRemoteTools,
                createWorkspaceReadTool(request.workspacePath, () =>
                  childResourceLoader
                    .getSkills()
                    .skills.map((skill) => dirname(skill.filePath)),
                ),
                context.webSearchTool,
                ...(isExecutionMode(input.mode)
                  ? [
                      childWriteTool,
                      ...(services.configuration.officeEnabled
                        ? [childOfficeDocumentTool]
                        : []),
                    ]
                  : []),
                context.loadWorkspaceDependenciesTool,
                ...(childSpawnAgentTool ? [childSpawnAgentTool] : []),
                context.listAgentsTool,
                childWaitAgentTool,
                childWaitTeamTool,
                childSendMessageTool,
                childFinishSubteamTool,
                ...(isExecutionMode(input.mode)
                  ? [
                      childBashTools.bashTool,
                      childBashTools.bashWaitTool,
                      childBashTools.bashCancelTool,
                    ]
                  : []),
                ...childMcpTools,
              ];
              const guardedChildTools = frozenSnapshot
                ? childTools
                    .filter((tool) =>
                      services.customAgentToolAllowed(
                        tool.name,
                        frozenSnapshot,
                        input.mode,
                      ),
                    )
                    .map((tool) => ({
                      ...tool,
                      execute: async (
                        ...args: Parameters<typeof tool.execute>
                      ) => {
                        if (
                          !services.customAgentToolAllowed(
                            tool.name,
                            frozenSnapshot,
                            hosted.currentMode ?? "plan",
                          )
                        ) {
                          throw new Error(
                            `CUSTOM_AGENT_TOOL_DENIED: ${tool.name} is outside this instance's current authorization.`,
                          );
                        }
                        return tool.execute(...args);
                      },
                    }))
                : childTools;
              const created = await createAgentSession({
                cwd: request.workspacePath,
                agentDir: services.agentDir,
                sessionManager: omitReasoningFromSession(
                  SessionManager.inMemory(request.workspacePath),
                ),
                modelRuntime,
                ...(selectedModel ? { model: selectedModel } : {}),
                ...(selection
                  ? { thinkingLevel: selection.thinkingLevel }
                  : {}),
                resourceLoader: childResourceLoader,
                noTools: "builtin",
                customTools: guardedChildTools.map(configureToolExposure),
                tools: [
                  ...guardedChildTools.map((tool) => tool.name),
                  ...(input.mode === "codemode" ? ["codemode"] : []),
                ],
              });
              if (request.remoteExecution)
                created.session.setActiveToolsByName(
                  created.session
                    .getActiveToolNames()
                    .filter((name) =>
                      isRemoteToolAllowed(
                        name,
                        input.mode,
                        request.remoteExecution!.shell,
                        request.remoteExecution!.collaborationRole,
                      ),
                    ),
                );
              child.session = created.session;
              childHooksBridge.installFinish(created.session);
              controller.signal.throwIfAborted();
              services.promptCache.registerSession(child.session.sessionId, {
                scope: "child",
                priorTopLevelUserTurns: 0,
              });
              services.configureSessionCompaction(child.session);
              child.session.setActiveToolsByName([
                ...child.session.agent.state.tools
                  .filter(
                    (tool) =>
                      childRemoteTools.some(
                        (candidate) => candidate.name === tool.name,
                      ) ||
                      tool.name.startsWith("attachment_") ||
                      tool.name === "read" ||
                      tool.name === "web_search" ||
                      tool.name === "spawn_agent" ||
                      tool.name === "list_agents" ||
                      tool.name === "wait_agent" ||
                      tool.name === "wait_team" ||
                      tool.name === "send_message" ||
                      tool.name === "finish_subteam" ||
                      (isExecutionMode(input.mode) &&
                        (tool.name === "shell" ||
                          tool.name === "shell_wait" ||
                          tool.name === "shell_cancel" ||
                          tool.name === "write" ||
                          tool.name === "office_document")) ||
                      (isExecutionMode(input.mode) &&
                        tool.name === "load_workspace_dependencies") ||
                      (isExecutionMode(input.mode) &&
                        childMcpTools.some(
                          (candidate) => candidate.name === tool.name,
                        )),
                  )
                  .map((tool) => tool.name),
                ...(input.mode === "codemode" ? ["codemode"] : []),
              ]);
              unsubscribe = child.session.subscribe((event) => {
                for (const payload of childAdapter.adapt(event as never)) {
                  if (payload.type === "message.superseded") {
                    for (const id of childTextParts.keys())
                      if (id.startsWith(`${payload.messageId}:`))
                        childTextParts.delete(id);
                    child.output = [...childTextParts.values()]
                      .join("")
                      .slice(-60 * 1024);
                  }
                  if (payload.type === "message.part.delta") {
                    if (payload.partType === "text") {
                      childTextParts.set(
                        payload.partId,
                        (childTextParts.get(payload.partId) ?? "") +
                          payload.delta,
                      );
                      child.output = [...childTextParts.values()]
                        .join("")
                        .slice(-60 * 1024);
                    }
                    scheduleActivityUpdate(payload.delta);
                  } else if (payload.type === "tool.started") {
                    childToolNames.set(payload.toolCallId, payload.toolName);
                    const mcpTool = context.mcpToolByPiName.get(
                      payload.toolName,
                    );
                    if (mcpTool) {
                      services.sink.emit(hosted.threadId, input.turnId, {
                        type: "mcp.tool.used",
                        toolCallId: payload.toolCallId,
                        serverId: mcpTool.serverId,
                        serverName: mcpTool.serverName,
                        toolName: mcpTool.toolName,
                        agentId,
                      });
                    }
                    child.currentTool = payload.toolName;
                    child.currentToolStartedAt = Date.now();
                    const toolInput =
                      payload.input === undefined
                        ? ""
                        : `\n${JSON.stringify(payload.input, null, 2).slice(
                            0,
                            2 * 1024,
                          )}`;
                    scheduleActivityUpdate(
                      `\n[${payload.toolName} started]${toolInput}\n`,
                    );
                  } else if (payload.type === "tool.updated") {
                    scheduleActivityUpdate(payload.output.slice(-2 * 1024));
                  } else if (payload.type === "tool.completed") {
                    const toolName =
                      childToolNames.get(payload.toolCallId) ?? "tool";
                    delete child.currentTool;
                    delete child.currentToolStartedAt;
                    scheduleActivityUpdate(
                      `\n[${toolName} ${payload.isError ? "failed" : "completed"}]\n${
                        payload.output?.slice(-4 * 1024) ?? ""
                      }\n`,
                    );
                  } else if (payload.type === "turn.failed") {
                    child.error = payload.message;
                    scheduleActivityUpdate(`\n[failed] ${payload.message}\n`);
                  } else if (payload.type === "assistant.usage") {
                    services.sink.emit(
                      hosted.threadId,
                      input.turnId,
                      services.promptCacheUsage(
                        child.session!.sessionId,
                        payload,
                        hosted.selection,
                      ),
                    );
                  }
                }
              });
              const queuedGuidance = child.pendingSteers.length
                ? `\n\nAdditional guidance received while queued:\n${child.pendingSteers.join("\n")}`
                : "";
              if (
                childProviderId &&
                (services.providerAdmissionBlockedUntil.get(childProviderId) ??
                  0) > Date.now()
              ) {
                await lease.suspend(() =>
                  services.waitForProviderAdmission(
                    childProviderId,
                    controller.signal,
                  ),
                );
              }
              const childPrompt = `${modeInstruction(input.mode)}\n\nYou are ${input.role}, an Artemis child agent at depth ${input.depth} of ${AGENT_TEAM_MAXIMUM_DEPTH}. Complete only this bounded task:\n${input.task}\n\nYour supervisor is ${input.parentAgentId}. You may create up to ${AGENT_TEAM_MAXIMUM_DIRECT_CHILDREN} direct children when the task has independent workstreams and the team still has capacity. Your cooperative write scope is ${input.writePaths.length > 0 ? input.writePaths.join(", ") : "empty (workspace write calls are read-only)"}.${queuedGuidance}`;
              if (frozenSnapshot && child.session.model) {
                assertCustomAgentContext(child.session.model, {
                  systemPrompt: child.session.systemPrompt,
                  tools: child.session.agent.state.tools,
                  messages: [
                    {
                      role: "user",
                      content: childPrompt,
                      timestamp: Date.now(),
                    },
                  ],
                });
              }
              controller.signal.throwIfAborted();
              const watchdog = createModelStreamIdleWatchdog(
                services.modelStreamIdleTimeoutMs,
                () => {
                  void child.session?.abort().catch(() => undefined);
                },
              );
              const stopWatching = child.session.subscribe(watchdog.observe);
              child.modelStreamWatchdog = watchdog;
              try {
                await Promise.race([
                  child.session.prompt(childPrompt),
                  watchdog.stalled,
                ]);
              } finally {
                stopWatching();
                watchdog.dispose();
                delete child.modelStreamWatchdog;
              }
              if (child.error) throw new Error(child.error);
              if (
                services.directChildren(hosted, child.agentId).length > 0 &&
                !child.subtreeIntegrated
              ) {
                throw new Error(
                  "The agent ended before calling finish_subteam for its direct children.",
                );
              }
              child.status = controller.signal.aborted
                ? "cancelled"
                : "completed";
              if (
                child.status === "completed" &&
                child.output.trim() &&
                !team.messages.some(
                  (message) =>
                    message.fromAgentId === child.agentId &&
                    message.kind === "handoff",
                )
              ) {
                await services.sendAgentTeamMessage(
                  request.threadId,
                  child.agentId,
                  "supervisor",
                  "handoff",
                  child.output.trim().slice(-8 * 1024),
                );
              }
            } catch (error) {
              if (childProviderId) {
                services.recordProviderBackoff(childProviderId, error);
              }
              const cancelled =
                controller.signal.aborted ||
                services.cancelledTurns.has(cancellationKey);
              child.status = cancelled ? "cancelled" : "failed";
              if (!cancelled) {
                child.error = (
                  error instanceof Error ? error.message : String(error)
                ).slice(0, 4 * 1024);
              }
            } finally {
              if (child.status === "failed" || child.status === "cancelled") {
                for (const descendant of services.descendantAgents(
                  hosted,
                  child.agentId,
                )) {
                  services.requestChildCancellation(hosted, descendant);
                }
              }
              hosted.activeLeases.delete(agentId);
              flushActivityUpdate();
              if (activityUpdateTimer) clearTimeout(activityUpdateTimer);
              unsubscribe();
              services.bashExecutions.cancelScope({
                threadId: request.threadId,
                turnId: input.turnId,
                ownerId: agentId,
              });
              delete child.currentTool;
              delete child.currentToolStartedAt;
              child.lastActivityAt = Date.now();
              if (child.session) {
                services.promptCache.unregisterSession(child.session.sessionId);
              }
              child.session?.dispose();
              delete child.session;
              services.emitChild(hosted, child);
              child.settle();
            }
          },
          controller.signal,
          request.threadId,
        );
      })
      .catch((error: unknown) => {
        if (!isTerminalChildStatus(child.status)) {
          const cancelled = controller.signal.aborted;
          child.status = cancelled ? "cancelled" : "failed";
          if (!cancelled) {
            child.error = (
              error instanceof Error ? error.message : String(error)
            ).slice(0, 4 * 1024);
          }
          child.lastActivityAt = Date.now();
          services.emitChild(hosted, child);
          child.settle();
        }
      });

    return child;
  };
}
