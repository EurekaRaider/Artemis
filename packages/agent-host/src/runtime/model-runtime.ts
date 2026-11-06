import type { HostedThread } from "./runtime-types.js";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { personalizeArtemisOpenRouter } from "../models/openrouter-catalog.js";

import { withComposerPredictionContext } from "../context/composer-prediction.js";
import { isDeepStrictEqual } from "node:util";

import { registerVirtualModels } from "../models/virtual-models.js";

import { isExecutionMode } from "@artemis/protocol";

import { withToolHistory } from "../context/tool-history.js";

import { withAttachmentContextBudget } from "../context/attachment-context.js";

import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";

import type {
  AgentRuntimeCatalog,
  AgentRuntimeConfiguration,
  ModelSelection,
  ImControlIntent,
} from "@artemis/protocol";
import { registerArtemisBuiltinModels } from "../models/builtin-models.js";
import { generateCommitMessage as runGenerateCommitMessage } from "../sessions/commit-message.js";
import { classifyImControlIntent as runClassifyImControlIntent } from "../policy/im-control-intent.js";
import { generateTaskSummary as runGenerateTaskSummary } from "../sessions/task-summary.js";

import { toPiProviderConfig } from "../models/provider-configuration.js";

import { configureModelContextWindow } from "../context/context-window.js";

import { withPromptCacheController } from "../context/prompt-cache.js";

import { withConnectionRecovery } from "./connection-recovery.js";

import type { AgentRuntimeDependencies } from "./agent-runtime-dependencies.js";
export function createModelRuntime(
  services: Pick<
    AgentRuntimeDependencies,
    | "modelRuntimePromise"
    | "promptCache"
    | "composerPredictionTokens"
    | "handleConnectionRecovery"
    | "modelStreamIdleTimeoutMs"
    | "credentials"
    | "configurationRevision"
    | "appliedConfigurationRevision"
    | "configuration"
    | "threads"
    | "shellRuntime"
    | "registeredProviderIds"
    | "openRouterCatalogPersonalized"
    | "getModelRuntime"
    | "registeredVirtualModels"
    | "agentDir"
    | "reconcileCustomAgentChildren"
    | "refreshThreadConfiguration"
    | "configureSessionCompaction"
    | "emitContextUsage"
  >,
) {
  function getModelRuntime(): ReturnType<typeof ModelRuntime.create> {
    services.modelRuntimePromise ??= ModelRuntime.create({
      credentials: services.credentials,
      allowModelNetwork: false,
    }).then((runtime) => {
      registerArtemisBuiltinModels(runtime);
      return withConnectionRecovery(
        withComposerPredictionContext(
          withPromptCacheController(
            withToolHistory(withAttachmentContextBudget(runtime)),
            services.promptCache,
          ),
          (sessionId) =>
            sessionId
              ? services.composerPredictionTokens.get(sessionId)
              : undefined,
        ),
        (sessionId, update) =>
          services.handleConnectionRecovery(sessionId, update),
        { idleTimeoutMs: services.modelStreamIdleTimeoutMs },
      );
    });
    return services.modelRuntimePromise;
  }

  async function configure(
    configuration: AgentRuntimeConfiguration,
  ): Promise<void> {
    const configurationSettled =
      services.configurationRevision === services.appliedConfigurationRevision;
    const revision = ++services.configurationRevision;
    const {
      officeEnabled: previousOffice,
      disabledSkillFiles: _previousSkills,
      ...previous
    } = services.configuration;
    const {
      officeEnabled: nextOffice,
      disabledSkillFiles: _nextSkills,
      ...next
    } = configuration;
    if (
      configurationSettled &&
      previousOffice !== nextOffice &&
      isDeepStrictEqual(previous, next)
    ) {
      // Office tool execution reads this configuration immediately. Resource
      // loaders refresh at the existing pre-prompt gate, not across every idle
      // session during a toggle. Other configuration changes keep the full path.
      services.configuration = structuredClone(configuration);
      services.appliedConfigurationRevision = revision;
      for (const hosted of services.threads.values())
        hosted.configurationPending = true;
      return;
    }
    services.shellRuntime.configure(configuration.shell);
    services.credentials.replace(configuration.credentials);
    const resolvedConfiguration = structuredClone(configuration);
    const providers = resolvedConfiguration.providers ?? [];
    if (
      configurationSettled &&
      providers.length === 0 &&
      services.registeredProviderIds.size === 0 &&
      !resolvedConfiguration.selection &&
      !resolvedConfiguration.credentials.openrouter &&
      !services.openRouterCatalogPersonalized &&
      services.threads.size === 0
    ) {
      services.configuration = resolvedConfiguration;
      services.appliedConfigurationRevision = revision;
      return;
    }
    const modelRuntime = await services.getModelRuntime();
    if (revision !== services.configurationRevision) return;
    for (const model of services.registeredVirtualModels)
      modelRuntime.unregisterVirtualModel(model.provider, model.id);
    services.registeredVirtualModels = [];
    const nextProviderIds = new Set(providers.map((provider) => provider.id));
    for (const providerId of services.registeredProviderIds) {
      if (!nextProviderIds.has(providerId)) {
        modelRuntime.unregisterProvider(providerId);
        registerArtemisBuiltinModels(modelRuntime);
        services.registeredProviderIds.delete(providerId);
      }
    }
    // Start from a full catalog when credentials or explicit model lists change.
    modelRuntime.registerNativeProvider(openrouterProvider());
    services.openRouterCatalogPersonalized = false;
    for (const provider of providers) {
      modelRuntime.registerProvider(
        provider.id,
        toPiProviderConfig(
          provider,
          Boolean(resolvedConfiguration.credentials[provider.id]),
        ),
      );
      services.registeredProviderIds.add(provider.id);
    }
    const openRouterCredential = resolvedConfiguration.credentials.openrouter;
    const openRouter = modelRuntime.getProvider("openrouter");
    if (openRouterCredential && openRouter) {
      // Resolve through Pi so expired OAuth tokens are refreshed before listing.
      const auth = await modelRuntime
        .getAuth("openrouter", {
          signal: AbortSignal.timeout(8_000),
        })
        .catch(() => undefined);
      if (revision !== services.configurationRevision) return;
      const personalized = auth?.auth.apiKey
        ? await personalizeArtemisOpenRouter(
            openRouter,
            { type: "api_key", key: auth.auth.apiKey },
            join(services.agentDir, "openrouter-catalog"),
          )
        : undefined;
      if (revision !== services.configurationRevision) return;
      if (personalized) {
        modelRuntime.registerNativeProvider(personalized);
        services.openRouterCatalogPersonalized = true;
      }
    }
    services.registeredVirtualModels = registerVirtualModels(
      modelRuntime,
      providers,
    );
    if (
      services.openRouterCatalogPersonalized &&
      resolvedConfiguration.selection?.providerId === "openrouter" &&
      !modelRuntime.getModel(
        "openrouter",
        resolvedConfiguration.selection.modelId,
      )
    ) {
      // Keep the new account usable without silently choosing another model.
      delete resolvedConfiguration.selection;
    }
    const selection = resolvedConfiguration.selection;
    if (selection) {
      const catalogModel = modelRuntime.getModel(
        selection.providerId,
        selection.modelId,
      );
      if (!catalogModel) {
        throw new Error(
          `Configured model is unavailable: ${selection.providerId}/${selection.modelId}`,
        );
      }
      if (selection.ultraMode) {
        selection.thinkingLevel =
          getSupportedThinkingLevels(catalogModel).at(-1) ?? "off";
      }
    }
    services.configuration = resolvedConfiguration;
    services.appliedConfigurationRevision = revision;
    services.reconcileCustomAgentChildren(resolvedConfiguration.customAgents);
    for (const hosted of services.threads.values()) {
      hosted.configurationPending = true;
      // Preserve the current turn's model, prompt and resource snapshot.
      // Additive installs become visible when its next prompt starts.
      if (
        !hosted.currentTurnId &&
        !hosted.compacting &&
        (!hosted.selection ||
          modelRuntime.getModel(
            hosted.selection.providerId,
            hosted.selection.modelId,
          ))
      ) {
        await services.refreshThreadConfiguration(hosted);
      }
    }
  }

  async function refreshThreadConfiguration(
    hosted: HostedThread,
  ): Promise<void> {
    const configuration = services.configuration;
    if (hosted.selection) {
      const modelRuntime = await services.getModelRuntime();
      const threadModel = modelRuntime.getModel(
        hosted.selection.providerId,
        hosted.selection.modelId,
      );
      if (!threadModel) {
        throw new Error(
          `Thread model is unavailable: ${hosted.selection.providerId}/${hosted.selection.modelId}`,
        );
      }
      await hosted.session.setModel(
        configureModelContextWindow(threadModel, hosted.contextWindow),
      );
      hosted.session.setThinkingLevel(hosted.selection.thinkingLevel);
    }
    const refreshedMcp = await hosted.refreshMcpTools();
    if (!refreshedMcp) await hosted.resourceLoader.reload();
    hosted.session.setActiveToolsByName(
      (isExecutionMode(hosted.currentMode)
        ? hosted.executeTools
        : hosted.delegatedTools
      )
        .filter(
          (tool) =>
            tool.name !== "office_document" ||
            services.configuration.officeEnabled,
        )
        .map((tool) => tool.name)
        .concat(
          hosted.currentMode === "codemode"
            ? ["codemode"]
            : hosted.currentMode === "plan"
              ? ["submit_plan"]
              : [],
        ),
    );
    services.configureSessionCompaction(hosted.session);
    services.emitContextUsage(hosted, false);
    hosted.configurationPending = services.configuration !== configuration;
  }

  async function setThreadModel(
    threadId: string,
    selection: ModelSelection,
    contextWindow: number,
  ): Promise<void> {
    const hosted = services.threads.get(threadId);
    if (!hosted) throw new Error(`Thread is not open: ${threadId}`);
    if (hosted.currentTurnId || hosted.compacting) {
      throw new Error("Stop the active task before changing its model.");
    }
    const modelRuntime = await services.getModelRuntime();
    const catalogModel = modelRuntime.getModel(
      selection.providerId,
      selection.modelId,
    );
    if (!catalogModel) {
      throw new Error(
        `Configured model is unavailable: ${selection.providerId}/${selection.modelId}`,
      );
    }
    const normalized = structuredClone(selection);
    if (normalized.ultraMode) {
      normalized.thinkingLevel =
        getSupportedThinkingLevels(catalogModel).at(-1) ?? "off";
    }
    await hosted.session.setModel(
      configureModelContextWindow(catalogModel, contextWindow),
    );
    hosted.session.setThinkingLevel(normalized.thinkingLevel);
    hosted.selection = normalized;
    hosted.contextWindow = contextWindow;
    const activeToolNames = hosted.session.getActiveToolNames();
    await hosted.resourceLoader.reload();
    hosted.session.setActiveToolsByName(activeToolNames);
    services.configureSessionCompaction(hosted.session);
    services.emitContextUsage(hosted, false);
  }

  async function catalog(): Promise<AgentRuntimeCatalog> {
    const modelRuntime = await services.getModelRuntime();
    return {
      authoritativeProviderIds: services.openRouterCatalogPersonalized
        ? ["openrouter"]
        : [],
      models: modelRuntime.getModels().map((model) => {
        const thinkingLevels = getSupportedThinkingLevels(model);
        return {
          providerId: model.provider,
          modelId: model.id,
          name: model.name,
          reasoning: model.reasoning,
          thinkingLevels,
          highestThinkingLevel: thinkingLevels.at(-1) ?? "off",
          contextWindow: model.contextWindow,
          configured: modelRuntime.hasConfiguredAuth(model.provider),
        };
      }),
      ...(services.configuration.selection
        ? { selection: structuredClone(services.configuration.selection) }
        : {}),
    };
  }

  async function generateCommitMessage(
    diff: string,
    selection: ModelSelection | undefined,
    locale: string,
  ): Promise<string> {
    return runGenerateCommitMessage(
      await services.getModelRuntime(),
      selection ?? services.configuration.selection,
      diff,
      locale,
    );
  }

  async function classifyImControlIntent(
    taskTitle: string,
    message: string,
    selection?: ModelSelection,
  ): Promise<ImControlIntent> {
    return runClassifyImControlIntent(
      await services.getModelRuntime(),
      selection ?? services.configuration.selection,
      taskTitle,
      message,
    );
  }

  async function generateTaskSummary(
    title: string,
    selection: ModelSelection | undefined,
    locale: string,
  ): Promise<string> {
    return runGenerateTaskSummary(
      await services.getModelRuntime(),
      selection ?? services.configuration.selection,
      title,
      locale,
    );
  }
  const handlers = {
    getModelRuntime,
    configure,
    refreshThreadConfiguration,
    setThreadModel,
    catalog,
    generateCommitMessage,
    classifyImControlIntent,
    generateTaskSummary,
  };
  return handlers;
}
