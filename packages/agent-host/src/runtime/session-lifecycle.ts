import { createChildSessionLauncher } from "./child-session.js";
import { createSessionAttachmentTools } from "./tools/session-attachments.js";
import { createSessionRemoteTools } from "./tools/session-remote.js";
import { createSessionExtensionTools } from "./tools/session-extensions.js";
import { createSessionMcpTools } from "./tools/session-mcp.js";
import { createSessionTeamTools } from "./tools/session-team.js";
import { createSessionPlanTools } from "./tools/session-plan.js";
import { createDependencyTool } from "./tools/session-workspace-dependencies.js";
import { createObservedShellTools } from "./tools/session-observed-shell.js";
import { createSaveMemoryTool } from "./tools/memory.js";
import { createGoalTools } from "./tools/goals.js";
import { createOfficeDocumentToolFactory } from "./tools/office-document.js";
import { createWriteToolFactory } from "./tools/workspace-write.js";
import { createRequestUserInputTool } from "./tools/user-input.js";
import { createLocalFileTools } from "./tools/local-files.js";
import { createWebSearchTool } from "./tools/web-search.js";
import { createLazySessionManager } from "./session-storage.js";
import { terminalAgentStopReason } from "./agent-team-policy.js";

import type {
  SessionTool,
  OpenThreadRequest,
  HostedThread,
  LaunchChildAgentInput,
  ChildAgentExecution,
} from "./runtime-types.js";

import { projectMcpTools } from "../policy/project-mcp-overrides.js";

import { contextEditingExtension } from "../context/context-editing.js";
import { modelCapabilityTools } from "../models/model-capability-tools.js";

import { createHooksBridge } from "../tools/hooks-bridge.js";
import {
  configureToolExposure,
  codemodePolicyExtension,
} from "../policy/tool-exposure.js";

import {
  isRemoteToolAllowed,
  remoteResourceOverrides,
} from "../tools/remote-tools.js";

import { randomUUID, createHash } from "node:crypto";

import { existsSync } from "node:fs";
import { createWorkspaceReadTool } from "../tools/workspace-read-tool.js";
import { dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import {
  DefaultResourceLoader,
  SessionManager,
  createAgentSession,
  createCodemodeExtension,
  defineTool,
} from "@earendil-works/pi-coding-agent";

import { Type } from "@sinclair/typebox";

import { forkPiSession } from "../sessions/session-fork.js";
import { deletePiSessionTranscript } from "../sessions/session-delete.js";

import { configureModelContextWindow } from "../context/context-window.js";

import { createResourceOverrides } from "../policy/resource-overrides.js";

import { omitReasoningFromSession } from "../models/reasoning-persistence.js";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createSessionLifecycle(
  services: Pick<
    AgentRuntimeDependencies,
    | "threads"
    | "closeThread"
    | "requireActiveThread"
    | "broker"
    | "parkedDelegationTurns"
    | "cancel"
    | "sink"
    | "serializeUserInput"
    | "shellRuntime"
    | "bashExecutions"
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
    | "configuration"
    | "emitTeam"
    | "cancelledTurns"
    | "agentDir"
    | "codemodeWorkers"
    | "getModelRuntime"
    | "customAgentToolAllowed"
    | "promptCache"
    | "configureSessionCompaction"
    | "promptCacheUsage"
    | "waitForProviderAdmission"
    | "providerAdmissionBlockedUntil"
    | "modelStreamIdleTimeoutMs"
    | "requestChildCancellation"
    | "descendantAgents"
    | "recordProviderBackoff"
    | "concurrency"
    | "onSessionFile"
    | "handleContextUsageEvent"
    | "emitContextUsage"
  >,
) {
  async function openThread(request: OpenThreadRequest): Promise<{
    sessionFile?: string;
  }> {
    if (request.groupCollaboration && !request.remoteExecution?.security)
      throw new Error("Group sessions require a verified IM security context.");
    const current = services.threads.get(request.threadId);
    if (current) {
      // Rebuild when the bound plugin revision changes; keep active turns intact.
      if (
        JSON.stringify(current.typeBinding) !==
        JSON.stringify(request.typeBinding)
      ) {
        if (current.currentTurnId)
          throw new Error(
            "Cannot change the task plugin binding while a turn is active; retry after the turn ends.",
          );
        await services.closeThread(request.threadId);
      } else {
        return current.session.sessionFile
          ? { sessionFile: current.session.sessionFile }
          : {};
      }
    }

    const remoteToolsRuntime = createSessionRemoteTools(request, services);
    const { invokeRemoteOperation, remoteTools } = remoteToolsRuntime;

    const attachmentsToolsRuntime = createSessionAttachmentTools(
      request,
      services,
    );
    const { invokeAttachmentOperation, attachmentTools } =
      attachmentsToolsRuntime;

    const readTool = createWorkspaceReadTool(request.workspacePath, () =>
      resourceLoader.getSkills().skills.map((skill) => dirname(skill.filePath)),
    );

    const host = services;
    const brokerToolContext = {
      threads: services.threads,
      broker: services.broker,
      sink: services.sink,
      get configuration() {
        return host.configuration;
      },
      serializeUserInput: <T>(threadId: string, action: () => Promise<T>) =>
        services.serializeUserInput(threadId, action),
    };
    const webSearchTool = createWebSearchTool(request, brokerToolContext);

    const { localFileReadTool, localFileWriteTool } = createLocalFileTools(
      request,
      brokerToolContext,
    );

    // Tool APIs need a root object with properties; a top-level union is
    // rejected by some providers and loses its branches in Pi's Anthropic path.
    const requestUserInputTool = createRequestUserInputTool(
      request,
      brokerToolContext,
    );

    const observedShellToolsRuntime = createObservedShellTools(
      request,
      services,
    );
    const { createObservedBashTools } = observedShellToolsRuntime;

    const parentBashTools = createObservedBashTools(() => {
      const hosted = services.threads.get(request.threadId);
      if (!hosted?.currentTurnId) {
        throw new Error("No active turn is available for this shell command.");
      }
      return {
        turnId: hosted.currentTurnId,
        ownerId: "parent",
        mode: hosted.currentMode ?? "plan",
      };
    });

    const createWriteTool = createWriteToolFactory(request, brokerToolContext);
    const writeTool = createWriteTool(() => ({}));

    const createOfficeDocumentTool = createOfficeDocumentToolFactory(
      request,
      brokerToolContext,
    );
    const officeDocumentTool = createOfficeDocumentTool(() => ({}));

    const workspaceDependenciesToolsRuntime = createDependencyTool();
    const { loadWorkspaceDependenciesTool } = workspaceDependenciesToolsRuntime;

    const planToolsRuntime = createSessionPlanTools(request, services);
    const { submitPlanTool, updatePlanTool } = planToolsRuntime;

    const { getGoalTool, createGoalTool, updateGoalTool } = createGoalTools(
      request,
      brokerToolContext,
    );

    const saveMemoryTool = createSaveMemoryTool(request, brokerToolContext);

    let launchChildAgent!: (
      input: LaunchChildAgentInput,
    ) => ChildAgentExecution;
    const teamToolsRuntime = createSessionTeamTools(
      request,
      services,
      () => launchChildAgent,
    );
    const {
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
    } = teamToolsRuntime;

    const mcpToolsRuntime = createSessionMcpTools(
      request,
      services,
      await projectMcpTools(
        request.workspacePath,
        services.configuration.mcpTools ?? [],
      ),
    );
    const {
      mcpToolByPiName,
      createMcpTools,
      searchMcpToolsTool,
      mcpDiscoveryTools,
    } = mcpToolsRuntime;

    const extensionsToolsRuntime = createSessionExtensionTools(
      request,
      services,
    );
    const { extensionTools } = extensionsToolsRuntime;

    launchChildAgent = createChildSessionLauncher(request, services, {
      get modelRuntime() {
        return modelRuntime;
      },
      get createObservedBashTools() {
        return createObservedBashTools;
      },
      get createWriteTool() {
        return createWriteTool;
      },
      get invokeRemoteOperation() {
        return invokeRemoteOperation;
      },
      get createOfficeDocumentTool() {
        return createOfficeDocumentTool;
      },
      get createSendMessageTool() {
        return createSendMessageTool;
      },
      get createSpawnAgentTool() {
        return createSpawnAgentTool;
      },
      get createWaitAgentTool() {
        return createWaitAgentTool;
      },
      get createWaitTeamTool() {
        return createWaitTeamTool;
      },
      get createFinishSubteamTool() {
        return createFinishSubteamTool;
      },
      get createMcpTools() {
        return createMcpTools;
      },
      get invokeAttachmentOperation() {
        return invokeAttachmentOperation;
      },
      get webSearchTool() {
        return webSearchTool;
      },
      get loadWorkspaceDependenciesTool() {
        return loadWorkspaceDependenciesTool;
      },
      get listAgentsTool() {
        return listAgentsTool;
      },
      get mcpToolByPiName() {
        return mcpToolByPiName;
      },
    });

    const scopedAgentDir = request.remoteExecution
      ? join(
          services.agentDir,
          "im-scoped",
          createHash("sha256")
            .update(
              JSON.stringify([
                request.threadId,
                request.remoteExecution.security?.identityKey,
                request.remoteExecution.security?.audience,
                request.remoteExecution.security?.contextRevision ??
                  request.remoteExecution.security?.revision,
                request.remoteExecution.security?.spaceRevision,
              ]),
            )
            .digest("hex"),
        )
      : services.agentDir;
    const sessionRelative = request.sessionFile
      ? relative(scopedAgentDir, resolve(request.sessionFile))
      : "";
    const compatibleSession =
      request.sessionFile &&
      (!request.remoteExecution ||
        (!!sessionRelative &&
          sessionRelative !== ".." &&
          !sessionRelative.startsWith(`..${sep}`) &&
          !isAbsolute(sessionRelative)));
    const sessionManager =
      compatibleSession &&
      request.sessionFile &&
      existsSync(request.sessionFile)
        ? omitReasoningFromSession(SessionManager.open(request.sessionFile))
        : createLazySessionManager(
            request.workspacePath,
            scopedAgentDir,
            (sessionFile) =>
              services.onSessionFile?.(request.threadId, sessionFile),
          );
    const modelRuntime = await services.getModelRuntime();
    const selection = request.selection ?? services.configuration.selection;
    const catalogModel = selection
      ? modelRuntime.getModel(selection.providerId, selection.modelId)
      : undefined;
    if (selection && !catalogModel) {
      throw new Error(
        `Configured model is unavailable: ${selection.providerId}/${selection.modelId}`,
      );
    }
    const selectedModel = catalogModel
      ? configureModelContextWindow(
          catalogModel,
          request.contextWindow ?? services.configuration.contextWindow,
        )
      : undefined;
    const hooksBridge = createHooksBridge({
      enabled: () => services.configuration.hooksEnabled === true,
      broker: services.broker,
      threadId: request.threadId,
      cwd: request.workspacePath,
      onPromptBlocked: (message) => {
        const turnId = services.threads.get(request.threadId)?.currentTurnId;
        if (turnId)
          services.sink.emit(request.threadId, turnId, {
            type: "turn.failed",
            code: "HOOK_PROMPT_BLOCKED",
            message,
          });
      },
      resumed: Boolean(request.sessionFile),
      mode: () => services.threads.get(request.threadId)?.currentMode ?? "plan",
      turnId: () => services.threads.get(request.threadId)?.currentTurnId,
      canContinue: () => {
        const turn = services.threads.get(request.threadId)?.currentTurnId;
        const key = `${request.threadId}\0${turn}`;
        return (
          Boolean(turn) &&
          !services.cancelledTurns.has(key) &&
          !services.parkedDelegationTurns.has(key)
        );
      },
    });
    const resourceLoader = new DefaultResourceLoader({
      cwd: request.workspacePath,
      agentDir: services.agentDir,
      noExtensions: true,
      extensionFactories: [
        hooksBridge.factory,
        contextEditingExtension(
          () => services.threads.get(request.threadId)?.currentMode,
        ),
        codemodePolicyExtension(
          () => services.threads.get(request.threadId)?.currentMode,
        ),
        createCodemodeExtension({
          mode: "only",
          models: true,
          acquireWorker: (signal) => services.codemodeWorkers.acquire(signal),
        }),
      ],
      ...createResourceOverrides(() => {
        const opened = services.threads.get(request.threadId);
        const threadSelection = opened?.selection ?? selection;
        const threadContextWindow =
          opened?.contextWindow ??
          request.contextWindow ??
          services.configuration.contextWindow;
        return {
          ...services.configuration,
          ...(threadSelection ? { selection: threadSelection } : {}),
          ...(threadContextWindow
            ? { contextWindow: threadContextWindow }
            : {}),
        };
      }),
      ...(request.remoteExecution
        ? remoteResourceOverrides(request.remoteExecution)
        : {}),
    });
    await resourceLoader.reload();
    const modelTools = modelCapabilityTools(
      modelRuntime,
      () => services.threads.get(request.threadId)?.currentMode,
    );
    // 组装顺序：model 能力工具在前（main 的 Pi 升级），其余全量在后；
    // configureToolExposure 是 main 新增的按模式暴露配置，包在受限过滤
    // 之前，保证受限 allow-list 看到的是最终形态的工具。
    const assembledToolsAll = [
      ...modelTools,
      ...attachmentTools,
      ...remoteTools,
      readTool,
      webSearchTool,
      localFileReadTool,
      localFileWriteTool,
      requestUserInputTool,
      writeTool,
      officeDocumentTool,
      loadWorkspaceDependenciesTool,
      updatePlanTool,
      submitPlanTool,
      getGoalTool,
      createGoalTool,
      updateGoalTool,
      saveMemoryTool,
      spawnAgentTool,
      listAgentsTool,
      waitTeamTool,
      sendMessageTool,
      setAgentWriteScopeTool,
      finishTeamTool,
      waitAgentTool,
      getAgentStatusTool,
      steerAgentTool,
      cancelAgentTool,
      retryAgentTool,
      parentBashTools.bashTool,
      parentBashTools.bashWaitTool,
      parentBashTools.bashCancelTool,
      ...mcpDiscoveryTools,
      ...mcpToolsRuntime.mcpTools,
      ...extensionTools,
    ].map(configureToolExposure);

    // S2 plugin tools (proposal §5/§7): tools declared by the bound plugin's
    // published manifest are injected as broker-mediated customTools. The
    // execute body carries no capability of its own — it round-trips to the
    // main-process dispatcher which re-verifies the trust chain (content
    // hash recomputed from disk + unrevoked grant + mode gate) before any
    // runtime spawn. Plan/Review never sees plugin tools at all.
    const pluginBrokerTools = request.typeBinding
      ? (request.pluginTools ?? []).map((declared) =>
          defineTool({
            name: `plugin_${declared.name}`,
            label: declared.name,
            description: declared.description,
            parameters: Type.Object(
              {
                input: Type.Optional(
                  Type.Record(Type.String(), Type.Unknown()),
                ),
              },
              { additionalProperties: true },
            ),
            execute: async (_toolCallId, params) => {
              const hosted = services.threads.get(request.threadId);
              const result = await services.broker.request({
                kind: "plugin.tool",
                approvalId: randomUUID(),
                threadId: request.threadId,
                turnId: hosted?.currentTurnId ?? request.threadId,
                mode: hosted?.currentMode ?? "work",
                pluginId: request.typeBinding!.pluginId,
                toolName: declared.name,
                args:
                  params.input && typeof params.input === "object"
                    ? (params.input as Record<string, unknown>)
                    : {},
              });
              if (!result.approved) {
                throw new Error(
                  result.error ?? "Plugin tool dispatch was refused.",
                );
              }
              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(result.data ?? {}, null, 2),
                  },
                ],
                details: result.data,
              };
            },
          }),
        )
      : [];

    const customTools = [...assembledToolsAll, ...pluginBrokerTools];
    const { session } = await createAgentSession({
      cwd: request.workspacePath,
      agentDir: services.agentDir,
      sessionManager,
      modelRuntime,
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selection ? { thinkingLevel: selection.thinkingLevel } : {}),
      resourceLoader,
      noTools: "builtin",
      customTools,
    });
    session.setActiveToolsByName([
      ...customTools.map((tool) => tool.name),
      "edit_context",
    ]);
    const previousFinishTurn = session.agent.finishTurn;
    session.agent.finishTurn = async (context, signal) => {
      const decision =
        (await previousFinishTurn?.(context, signal)) ?? undefined;
      if (
        context.message.stopReason === "error" ||
        context.message.stopReason === "aborted"
      ) {
        return decision;
      }
      const hosted = services.threads.get(request.threadId);
      const turn = hosted?.currentTurnId;
      if (
        hosted &&
        turn &&
        (planToolsRuntime.submittedPlanTurn === turn ||
          planToolsRuntime.stoppedPlanLoopTurn === turn)
      ) {
        const queue = session.clearQueue();
        hosted.recoveredQueueMessages.push(
          ...queue.steering,
          ...queue.followUp,
        );
        return { action: "end" };
      }
      const key = `${request.threadId}\0${turn}`;
      if (
        services.parkedDelegationTurns.has(key) ||
        services.cancelledTurns.has(key)
      ) {
        if (hosted && session.pendingMessageCount > 0) {
          const queue = session.clearQueue();
          hosted.recoveredQueueMessages.push(
            ...queue.steering,
            ...queue.followUp,
          );
        }
        return { action: "end" };
      }
      return decision;
    };
    hooksBridge.installFinish(session);
    const restoredTopLevelUserTurns = session.messages.filter(
      (message) => message.role === "user",
    ).length;
    services.promptCache.registerSession(session.sessionId, {
      scope: "parent",
      priorTopLevelUserTurns: restoredTopLevelUserTurns,
    });
    services.configureSessionCompaction(session);
    const directMcpNames = () =>
      new Set(
        mcpToolsRuntime.configuredMcpTools
          .filter(
            (tool) =>
              !(
                tool.exposure === "direct" ||
                (tool.serverId === services.configuration.computerUseServerId &&
                  tool.toolName === "computer_open")
              ),
          )
          .map((tool) => tool.piName),
      );
    const mcpDirectToolNames = directMcpNames();
    session.setActiveToolsByName(
      session
        .getActiveToolNames()
        .filter((name) => !mcpDirectToolNames.has(name)),
    );
    const readSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "read",
    );
    const localFileReadSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "local_file_read",
    );
    const webSearchSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "web_search",
    );
    const localFileWriteSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "local_file_write",
    );
    const requestUserInputSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "request_user_input",
    );
    const writeSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "write",
    );
    const updatePlanSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "update_plan",
    );
    const getGoalSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "get_goal",
    );
    const createGoalSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "create_goal",
    );
    const updateGoalSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "update_goal",
    );
    const saveMemorySessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "save_memory",
    );
    const officeDocumentSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "office_document",
    );
    const loadWorkspaceDependenciesSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "load_workspace_dependencies",
    );
    const spawnAgentSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "spawn_agent",
    );
    const childControlSessionTools = session.agent.state.tools.filter((tool) =>
      [
        "wait_agent",
        "get_agent_status",
        "steer_agent",
        "cancel_agent",
        "retry_agent",
      ].includes(tool.name),
    );
    const teamSessionTools = session.agent.state.tools.filter((tool) =>
      [
        "list_agents",
        "wait_team",
        "send_message",
        "set_agent_write_scope",
        "finish_team",
      ].includes(tool.name),
    );
    const bashSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "shell",
    );
    const bashWaitSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "shell_wait",
    );
    const bashCancelSessionTool = session.agent.state.tools.find(
      (tool) => tool.name === "shell_cancel",
    );
    if (
      !readSessionTool ||
      !webSearchSessionTool ||
      !localFileReadSessionTool ||
      !localFileWriteSessionTool ||
      !requestUserInputSessionTool ||
      !writeSessionTool ||
      !officeDocumentSessionTool ||
      !loadWorkspaceDependenciesSessionTool ||
      !updatePlanSessionTool ||
      !getGoalSessionTool ||
      !createGoalSessionTool ||
      !updateGoalSessionTool ||
      !saveMemorySessionTool ||
      !spawnAgentSessionTool ||
      childControlSessionTools.length !== 5 ||
      teamSessionTools.length !== 5 ||
      !bashSessionTool ||
      !bashWaitSessionTool ||
      !bashCancelSessionTool
    ) {
      session.dispose();
      throw new Error("Pi did not register Artemis workspace tools.");
    }
    const executeTools = session.agent.state.tools.filter(
      (tool) =>
        remoteTools.some((candidate) => candidate.name === tool.name) ||
        tool.name === "edit_context" ||
        tool.name === "read" ||
        tool.name === "web_search" ||
        tool.name.startsWith("attachment_") ||
        // Include bound plugin tools alongside ordinary mode-filtered tools.
        tool.name.startsWith("plugin_") ||
        tool.name === "local_file_read" ||
        modelTools.some((candidate) => candidate.name === tool.name) ||
        tool.name === "local_file_write" ||
        tool.name === "request_user_input" ||
        tool.name === "shell" ||
        tool.name === "shell_wait" ||
        tool.name === "shell_cancel" ||
        tool.name === "write" ||
        tool.name === "office_document" ||
        tool.name === "load_workspace_dependencies" ||
        tool.name === "update_plan" ||
        tool.name === "get_goal" ||
        tool.name === "create_goal" ||
        tool.name === "update_goal" ||
        tool.name === "save_memory" ||
        tool.name === "spawn_agent" ||
        teamSessionTools.some((candidate) => candidate.name === tool.name) ||
        childControlSessionTools.some(
          (candidate) => candidate.name === tool.name,
        ) ||
        mcpToolsRuntime.mcpTools.some(
          (candidate) =>
            candidate.name === tool.name && !mcpDirectToolNames.has(tool.name),
        ) ||
        mcpDiscoveryTools.some((candidate) => candidate.name === tool.name) ||
        extensionTools.some((candidate) => candidate.name === tool.name),
    );
    const hosted: HostedThread = {
      threadId: request.threadId,
      workspacePath: request.workspacePath,
      target: request.target,
      ...(request.typeBinding ? { typeBinding: request.typeBinding } : {}),
      ...(selection ? { selection: structuredClone(selection) } : {}),
      ...((request.contextWindow ?? services.configuration.contextWindow)
        ? {
            contextWindow:
              request.contextWindow ?? services.configuration.contextWindow,
          }
        : {}),
      session,
      resourceLoader,
      refreshMcpTools: async () => {
        const next = await projectMcpTools(
          request.workspacePath,
          services.configuration.mcpTools ?? [],
        );
        if (
          JSON.stringify(next) ===
          JSON.stringify(mcpToolsRuntime.configuredMcpTools)
        )
          return false;
        const oldNames = new Set(
          mcpToolsRuntime.configuredMcpTools.map((tool) => tool.piName),
        );
        const active = session
          .getActiveToolNames()
          .filter((name) => !oldNames.has(name));
        mcpToolsRuntime.configuredMcpTools = next;
        mcpToolByPiName.clear();
        for (const tool of next) mcpToolByPiName.set(tool.piName, tool);
        mcpToolsRuntime.mcpTools = createMcpTools();
        // Pi retains the SDK customTools array; public reload rebuilds its registry.
        // This is exercised by the next-turn installation integration test.
        customTools.splice(
          0,
          customTools.length,
          ...customTools.filter((tool) => !oldNames.has(tool.name)),
          ...mcpToolsRuntime.mcpTools.map(configureToolExposure),
        );
        await session.reload();
        hosted.mcpDirectToolNames = directMcpNames();
        hosted.mcpToolNames = new Set(
          [...mcpDiscoveryTools, ...mcpToolsRuntime.mcpTools].map(
            (tool) => tool.name,
          ),
        );
        const entryNames = next
          .filter((tool) => !hosted.mcpDirectToolNames.has(tool.piName))
          .map((tool) => tool.piName);
        session.setActiveToolsByName([...active, ...entryNames]);
        hosted.executeTools = [
          ...hosted.executeTools.filter((tool) => !oldNames.has(tool.name)),
          ...session.agent.state.tools.filter((tool) =>
            entryNames.includes(tool.name),
          ),
        ];
        return true;
      },
      currentTurnId: undefined,
      currentMode: undefined,
      compacting: false,
      topLevelUserTurns: restoredTopLevelUserTurns,
      ...(readSessionTool ? { readTool: readSessionTool } : {}),
      ...(writeSessionTool ? { writeTool: writeSessionTool } : {}),
      mcpToolNames: new Set(
        [...mcpDiscoveryTools, ...mcpToolsRuntime.mcpTools].map(
          (tool) => tool.name,
        ),
      ),
      mcpDirectToolNames,
      delegatedTools: [
        ...session.agent.state.tools.filter((tool) =>
          tool.name.startsWith("attachment_"),
        ),
        readSessionTool,
        webSearchSessionTool,
        requestUserInputSessionTool,
        updatePlanSessionTool,
        getGoalSessionTool,
        spawnAgentSessionTool,
        ...teamSessionTools,
        ...childControlSessionTools,
      ].filter((tool): tool is SessionTool => Boolean(tool)),
      executeTools,
      childAgents: new Map(),
      activeLeases: new Map(),
      explicitCustomAgentInvocations: new Map(),
      currentMission: undefined,
      team: undefined,
      interruptedTeamContext: undefined,
      recoveredQueueMessages: [],
      deferredTurnCompletion: undefined,
      launchChildAgent,
      adapter: undefined,
      unsubscribe: () => {},
    };
    if (request.remoteExecution) {
      const remoteSessionTools = session.agent.state.tools.filter((tool) =>
        remoteTools.some((candidate) => candidate.name === tool.name),
      );
      hosted.executeTools = hosted.executeTools.filter((tool) =>
        isRemoteToolAllowed(
          tool.name,
          "work",
          request.remoteExecution!.shell,
          request.remoteExecution!.collaborationRole,
        ),
      );
      hosted.delegatedTools = [
        ...hosted.delegatedTools,
        ...remoteSessionTools,
      ].filter((tool) => isRemoteToolAllowed(tool.name, "plan", false));
      session.agent.state.tools = hosted.delegatedTools;
    }
    if (!services.configuration.officeEnabled) {
      session.setActiveToolsByName(
        session
          .getActiveToolNames()
          .filter((name) => name !== "office_document"),
      );
    }
    hosted.unsubscribe = session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        if (planToolsRuntime.planUpdateTurn !== hosted.currentTurnId) {
          planToolsRuntime.planUpdateTurn = hosted.currentTurnId;
          planToolsRuntime.consecutivePlanUpdates = 0;
        }
        planToolsRuntime.consecutivePlanUpdates =
          event.toolName === "update_plan"
            ? planToolsRuntime.consecutivePlanUpdates + 1
            : 0;
      }
      if (
        event.type === "tool_execution_end" &&
        event.toolName === "update_plan" &&
        planToolsRuntime.consecutivePlanUpdates >= 8 &&
        hosted.currentTurnId
      ) {
        planToolsRuntime.stoppedPlanLoopTurn = hosted.currentTurnId;
        hosted.adapter?.stopAfterTools();
        services.sink.emit(hosted.threadId, hosted.currentTurnId, {
          type: "turn.failed",
          code: "PLAN_UPDATE_LOOP",
          message:
            "Stopped repeated plan updates without a task action. The requested task is not complete.",
        });
      }
      if (
        hosted.currentTurnId &&
        terminalAgentStopReason(event) &&
        session.pendingMessageCount > 0
      ) {
        const queue = session.clearQueue();
        hosted.recoveredQueueMessages.push(
          ...queue.steering,
          ...queue.followUp,
        );
      }
      if (hosted.currentTurnId && hosted.adapter) {
        if (
          event.type === "agent_settled" &&
          hosted.recoveredQueueMessages.length > 0
        ) {
          services.sink.emit(hosted.threadId, hosted.currentTurnId, {
            type: "queue.recovered",
            messages: hosted.recoveredQueueMessages,
          });
          hosted.recoveredQueueMessages = [];
        }
        for (let payload of hosted.adapter.adapt(event as never)) {
          if (
            payload.type === "turn.completed" &&
            services.cancelledTurns.has(
              `${hosted.threadId}\0${hosted.currentTurnId}`,
            )
          )
            payload = { ...payload, reason: "cancelled" };
          if (
            payload.type === "turn.completed" &&
            hosted.team &&
            hosted.team.status !== "completed" &&
            hosted.team.status !== "aborted"
          ) {
            hosted.deferredTurnCompletion = payload;
            continue;
          }
          if (payload.type === "tool.started") {
            const mcpTool = mcpToolByPiName.get(payload.toolName);
            if (mcpTool) {
              services.sink.emit(hosted.threadId, hosted.currentTurnId, {
                type: "mcp.tool.used",
                toolCallId: payload.toolCallId,
                serverId: mcpTool.serverId,
                serverName: mcpTool.serverName,
                toolName: mcpTool.toolName,
                agentId: "parent",
              });
            }
          }
          if (payload.type === "assistant.usage") {
            services.sink.emit(
              hosted.threadId,
              hosted.currentTurnId,
              services.promptCacheUsage(
                session.sessionId,
                payload,
                hosted.selection,
              ),
            );
            continue;
          }
          const emittedPayload =
            (payload.type === "turn.completed" ||
              payload.type === "turn.failed") &&
            services.bashExecutions.hasActiveThread(hosted.threadId)
              ? { ...payload, backgroundProcessesRunning: true }
              : payload;
          services.sink.emit(
            hosted.threadId,
            hosted.currentTurnId,
            emittedPayload,
          );
        }
      }
      services.handleContextUsageEvent(hosted, event);
    });

    services.threads.set(request.threadId, hosted);
    services.emitContextUsage(hosted, false);
    return session.sessionFile ? { sessionFile: session.sessionFile } : {};
  }

  function forkThread(
    threadId: string,
    entryId?: string,
  ): { sessionFile: string } {
    const hosted = services.threads.get(threadId);
    if (!hosted) {
      throw new Error(`Thread is not open: ${threadId}`);
    }
    if (hosted.currentTurnId) {
      throw new Error("Cannot fork a thread while a turn is active.");
    }
    if (hosted.compacting) {
      throw new Error("Cannot fork a thread while context is compacting.");
    }
    const sourceSessionFile = hosted.session.sessionFile;
    if (!sourceSessionFile) {
      throw new Error("Cannot fork a thread without a persisted Pi session.");
    }
    return {
      sessionFile: forkPiSession(sourceSessionFile, entryId),
    };
  }

  function closeThread(threadId: string): void {
    const hosted = services.threads.get(threadId);
    if (!hosted) {
      return;
    }
    if (hosted.currentTurnId) {
      throw new Error("Cannot close a thread while a turn is active.");
    }
    if (hosted.compacting) {
      throw new Error("Cannot close a thread while context is compacting.");
    }
    hosted.unsubscribe();
    for (const child of hosted.childAgents.values()) {
      services.requestChildCancellation(hosted, child);
      if (child.session) {
        services.promptCache.unregisterSession(child.session.sessionId);
      }
      child.session?.dispose();
    }
    hosted.childAgents.clear();
    services.bashExecutions.disposeThread(threadId);
    services.promptCache.unregisterSession(hosted.session.sessionId);
    hosted.session.dispose();
    services.threads.delete(threadId);
  }

  async function deleteThread(
    threadId: string,
    sessionFile?: string,
  ): Promise<void> {
    const hosted = services.threads.get(threadId);
    sessionFile ??= hosted?.session.sessionFile;
    if (hosted) {
      services.closeThread(threadId);
    }
    if (sessionFile) {
      await deletePiSessionTranscript(
        sessionFile,
        join(services.agentDir, "sessions"),
      );
    }
  }

  function requireActiveThread(threadId: string): HostedThread {
    const hosted = services.threads.get(threadId);
    if (!hosted?.currentTurnId) {
      throw new Error(`Thread has no active turn: ${threadId}`);
    }
    return hosted;
  }

  function dispose(): void {
    services.codemodeWorkers.dispose();
    for (const hosted of services.threads.values()) {
      hosted.unsubscribe();
      for (const child of hosted.childAgents.values()) {
        services.requestChildCancellation(hosted, child);
        if (child.session) {
          services.promptCache.unregisterSession(child.session.sessionId);
        }
        child.session?.dispose();
      }
      services.promptCache.unregisterSession(hosted.session.sessionId);
      hosted.session.dispose();
      services.bashExecutions.disposeThread(hosted.threadId);
    }
    services.threads.clear();
  }
  const handlers = {
    openThread,
    forkThread,
    closeThread,
    deleteThread,
    requireActiveThread,
    dispose,
  };
  return handlers;
}
