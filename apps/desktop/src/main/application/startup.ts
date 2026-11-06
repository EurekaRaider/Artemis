import { BrowserSessionHost } from "../workspace/browser-session-host.js";
import { ComputerPreviewHost } from "../computer-use/preview-host.js";
import { ComputerPreviewWindow } from "../computer-use/preview-window.js";
import { createDesktopUpdateService } from "../updates/desktop-update-service.js";
import { createDesignWorkspaceToolHandlers } from "../design/design-plugin-workspace-tools.js";
import { DesignPanelHost } from "../design/design-plugin-panel-host.js";
import { createDispatchPluginTool } from "../design/design-plugin-dispatch.js";
import {
  designPluginRevisionsRoot,
  migrateLegacyDesignPluginRevisions,
} from "../design/design-plugin-thread-data.js";
import { PanelSendEntryService } from "../design/design-plugin-send-entry.js";
import { ProviderLoginService } from "../settings/provider-login-service.js";
import { AppearanceService } from "../appearance/appearance-service.js";
import { migratePluginUserData } from "../plugins/plugin-data-migration.js";
import {
  ComputerUseRuntime,
  computerUseVerificationCatalog,
} from "../computer-use/runtime.js";
import type { OfficeRuntimeCatalog } from "../office/office-capability-updates.js";
import { ComputerUseHost } from "../computer-use/host.js";
import { computerHelperSource } from "../computer-use/helper-source.js";
import { COMPUTER_USE_CONFIG_URL } from "../computer-use/mcp-server.js";
import { applicationHost } from "../application/application-host.js";
import { imText } from "@artemis/gateway";
import { ThreadHistoryService } from "../conversation/thread-history-service.js";
import { WORKSPACE_PDF_SCHEME } from "../workspace/workspace-pdf-preview.js";
import { WORKSPACE_VIDEO_SCHEME } from "../workspace/workspace-video-preview.js";
import { WORKSPACE_HTML_SCHEME } from "../../shared/timeline-preview.js";
import { ImService } from "../im/im-service.js";
import { randomUUID } from "node:crypto";
import {
  TaskNotifications,
  registerTaskNotifications,
} from "../conversation/task-notifications.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  powerMonitor,
  net,
  safeStorage,
  session as electronSession,
  shell,
} from "electron";
import { getPlatformContract } from "@artemis/platform";
import type { ImControlIntent } from "@artemis/protocol";
import { userInputResolutionSchema } from "@artemis/protocol";
import {
  AgentCapacityController,
  currentAgentCapacityHardware,
} from "../agent/agent-capacity-controller.js";
import { AutomationScheduler } from "../automation/automation-scheduler.js";
import { AppStore } from "../settings/store.js";
import { TurnChangeSetService } from "../workspace/turn-change-set.js";
import { DiagnosticBundleService } from "../platform/diagnostic-bundle.js";
import { EncryptedSettingsStore } from "../settings/encrypted-settings-store.js";
import { ConfigurationImportService } from "../settings/configuration-import.js";
import { GlobalInstructionsStore } from "../settings/global-instructions-store.js";
import { McpClientManager } from "../mcp/mcp-client-manager.js";
import { McpConfigStore } from "../mcp/mcp-config-store.js";
import { McpOAuthStore } from "../mcp/mcp-oauth-store.js";
import { McpSecretStore } from "../mcp/mcp-secret-store.js";
import { ResourceCatalogService } from "../plugins/resource-catalog.js";
import { ArtemisPluginService } from "../plugins/artemis-plugin-service.js";
import { assertPublicOAuthBrowserUrl } from "../connectors/connector-oauth-network.js";
import { ConnectorService } from "../connectors/connector-service.js";
import { ConnectorVault } from "../connectors/connector-vault.js";
import { CONNECTOR_AUTH_META } from "../../shared/connectors.js";
import { TerminalService } from "../terminal/terminal-service.js";
import { TrustedExtensionManager } from "../plugins/trusted-extension-manager.js";
import { TrustedExtensionStore } from "../plugins/trusted-extension-store.js";
import { IPC } from "../../shared/api.js";
import { BROWSER_SESSION_PARTITION } from "../../shared/i18n/browser-locale.js";
import { resolveAppLocale } from "../../shared/i18n/locales.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "markStartupStage"
  | "applyMacDockIcon"
  | "diagnosticBundleService"
  | "store"
  | "designPanelHost"
  | "workspaceHtmlPreview"
  | "panelSendEntry"
  | "pluginDispatch"
  | "windowsSandboxHelperPath"
  | "designPluginAvailabilityGate"
  | "resolveThreadWorkspace"
  | "designArtifactWriteSink"
  | "threadHistoryService"
  | "taskNotifications"
  | "mainWindow"
  | "currentLocale"
  | "openTaskNotification"
  | "turnChangeSetService"
  | "observeTaskNotification"
  | "activeTurns"
  | "settingsStore"
  | "providerLoginService"
  | "applyAgentRuntime"
  | "imService"
  | "cancelLocalTaskTurn"
  | "cancellingTurns"
  | "recoverableTurnQueues"
  | "compactingThreads"
  | "compactionFollowUps"
  | "pendingApprovals"
  | "pendingUserInputs"
  | "pendingMultiUserInputs"
  | "startTaskTurn"
  | "emitPayload"
  | "attachmentStore"
  | "currentPlatform"
  | "agentProcess"
  | "createTaskThread"
  | "openingThreads"
  | "openedThreads"
  | "queueTurn"
  | "activeRuntimeSelection"
  | "resolveApproval"
  | "completeUserInput"
  | "completeMultiUserInputQuestion"
  | "isMultiQuestionUserInputResolution"
  | "sleepPrevention"
  | "agentCapacityController"
  | "globalInstructionsStore"
  | "syncWindowBackgroundColors"
  | "materialPreference"
  | "applyNativeTheme"
  | "languagePreference"
  | "resolvedLocalePreference"
  | "configureBrowserLocaleSession"
  | "conversationShareService"
  | "workspaceVideoPreview"
  | "workspacePdfPreview"
  | "mcpConfigStore"
  | "mcpOAuthStore"
  | "mcpSecretStore"
  | "connectorService"
  | "artemisPluginService"
  | "mcpClientManager"
  | "computerUseHost"
  | "computerUseServerId"
  | "resourceCatalogService"
  | "appearanceService"
  | "bundledArtifactPluginsPath"
  | "appearanceSystemPauseReasons"
  | "syncAppearanceMedia"
  | "browserSessionHost"
  | "isEmbeddedBrowserNavigationAllowed"
  | "computerPreviewHost"
  | "computerUseRuntime"
  | "computerUseCalls"
  | "computerPreviewWindow"
  | "configurationImportService"
  | "trustedExtensionStore"
  | "trustedExtensionManager"
  | "extensionWorkerPath"
  | "releaseUpdateManager"
  | "autoUpdater"
  | "installedApplicationPath"
  | "rollbackScriptPath"
  | "startingTurns"
  | "preparingUpdate"
  | "automationScheduler"
  | "recoveringUpdate"
  | "terminalService"
  | "createAgentHostProcess"
  | "agentCapacityRuntime"
  | "startAgentCapacityMonitoring"
  | "agentRuntimeReady"
  | "optionalCapabilitiesReady"
  | "initializeOptionalCapabilities"
  | "publishAutomationEvent"
  | "automationRunNotification"
  | "resolveModelSelection"
  | "registerIpc"
  | "createMainWindow"
  | "registerThreadLinks"
  | "shuttingDown"
  | "resumeInterruptedTurns"
  | "releaseUpdateReady"
  | "ipcMain"
>;

export function startApplication(services: Dependencies): void {
  const {
    markStartupStage,
    applyMacDockIcon,
    workspaceHtmlPreview,
    windowsSandboxHelperPath,
    resolveThreadWorkspace,
    currentLocale,
    openTaskNotification,
    observeTaskNotification,
    activeTurns,
    applyAgentRuntime,
    cancelLocalTaskTurn,
    cancellingTurns,
    recoverableTurnQueues,
    compactingThreads,
    compactionFollowUps,
    pendingApprovals,
    pendingUserInputs,
    pendingMultiUserInputs,
    startTaskTurn,
    emitPayload,
    attachmentStore,
    currentPlatform,
    createTaskThread,
    openingThreads,
    openedThreads,
    queueTurn,
    resolveApproval,
    completeUserInput,
    completeMultiUserInputQuestion,
    isMultiQuestionUserInputResolution,
    sleepPrevention,
    syncWindowBackgroundColors,
    applyNativeTheme,
    configureBrowserLocaleSession,
    workspaceVideoPreview,
    workspacePdfPreview,
    bundledArtifactPluginsPath,
    appearanceSystemPauseReasons,
    syncAppearanceMedia,
    isEmbeddedBrowserNavigationAllowed,
    extensionWorkerPath,
    autoUpdater,
    installedApplicationPath,
    rollbackScriptPath,
    startingTurns,
    createAgentHostProcess,
    startAgentCapacityMonitoring,
    initializeOptionalCapabilities,
    publishAutomationEvent,
    automationRunNotification,
    resolveModelSelection,
    registerIpc,
    createMainWindow,
    registerThreadLinks,
    resumeInterruptedTurns,
    ipcMain,
  } = services;

  void app
    .whenReady()
    .then(async () => {
      markStartupStage("app-ready");
      applyMacDockIcon();
      const platform = getPlatformContract();
      if (!platform.supported) {
        dialog.showErrorBox(
          "Unsupported platform",
          `Artemis slice 1 does not support ${process.platform}/${process.arch}.`,
        );
      }

      services.diagnosticBundleService = new DiagnosticBundleService(
        join(app.getPath("userData"), "diagnostics", "events.json"),
        [app.getPath("home"), app.getPath("userData"), app.getPath("temp")],
      );
      markStartupStage("diagnostics-ready");
      services.store = new AppStore(
        join(app.getPath("userData"), "artemis.sqlite"),
      );

      // S1 design-plugin panel host: sandboxed WebContentsView per (thread,
      // panelId). Catalog points at the first-party package root for now; the
      // installed-revision view replaces this when the trust chain lands.
      services.designPanelHost = new DesignPanelHost();
      services.designPanelHost.setCatalogRoot(
        join(app.getAppPath(), "resources", "design-plugins"),
      );
      // 项目 HTML 预览（URL-load）：面板 session 不共享 defaultSession 的协议
      // 处理器，由 panel host 逐 session 注册 artemis-preview。
      services.designPanelHost.setPreviewResponder((request) =>
        workspaceHtmlPreview.respond(request),
      );
      // 沙箱预览内的页面导航（桥拦不住的 location.href 类）兜底同步：租约
      // 服务了目录内兄弟 HTML 时把工作区相对路径推给面板——面板用它同步
      // 文件 tab，并在进入注释/标记拾取时按"当前页"重建带桥传输（OD 的
      // 拾取模式换传输重建语义）。
      workspaceHtmlPreview.onHtmlResourceServed = (
        leaseHostname,
        path,
        threadId,
      ) => {
        services.designPanelHost?.pushProjectNavigated(
          threadId,
          "workspace",
          path,
        );
      };
      // S3 host send entry: panel candidates enter the ledger here and are
      // consumed exactly once via one-time credentials.
      services.panelSendEntry = new PanelSendEntryService(services.store);
      // Crash-window recovery (§9.3): rows stuck in dispatching/running from a
      // previous run are outcome-unknown — marked, never blindly re-sent.
      {
        let recoveredSubmissions = 0;
        for (const row of services.store.listThreads()) {
          recoveredSubmissions +=
            services.panelSendEntry.recoverInterruptedSubmissions(row.id);
        }
        if (recoveredSubmissions > 0) {
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `Marked ${recoveredSubmissions} plugin prompt submission(s) outcome-unknown after restart.`,
          });
        }
      }
      // S2 trusted dispatch: every plugin tool call from a restricted thread
      // lands here; the trust chain (revision hash + grant + mode) is enforced
      // in the main process before any runtime spawn.
      services.pluginDispatch = createDispatchPluginTool({
        store: services.store,
        windowsHelperPath:
          process.platform === "win32" ? windowsSandboxHelperPath() : undefined,
        revisionsRoot: designPluginRevisionsRoot(app.getPath("userData")),
        scratchRoot: join(app.getPath("userData"), "plugin-scratch"),
        // 卸载设计插件后拒绝一切工具调用：修订残留不等于插件可用。
        availabilityGate: async (input: { threadId: string }) =>
          (await services.designPluginAvailabilityGate?.(input.threadId)) ??
          null,
        // 路径化写入工具（write_page/apply_edit）的宿主执行：runtime 沙箱
        // 只写 scratch——包含校验 + 薄快照在这里做，Plan 门禁由工具调用的
        // mode 检查承担（dispatch 前置）。
        ...createDesignWorkspaceToolHandlers({
          getThread: (id) => services.store?.getThread(id),
          resolveWorkspace: resolveThreadWorkspace,
        }),
        // apply_edit/undo/restore 之后的自动刷新：经 sink 触发面板快照推送
        // （sink 由 registerIpc 安装，debounce 合并一回合内的多次写入）。
        onArtifactWrite: ({ threadId }) => {
          services.designArtifactWriteSink?.(threadId);
        },
        loadPublishedManifest: async (input) => {
          const revisionRoot = join(
            designPluginRevisionsRoot(app.getPath("userData")),
            input.installationId,
            input.contentHash,
          );
          const manifestPath = join(revisionRoot, "artemis.plugin.json");
          try {
            const bytes = await readFile(manifestPath, "utf8");
            const manifest = JSON.parse(bytes) as {
              tools: Array<{ name: string; effect: string }>;
              runtime: { entry: string };
            };
            return {
              tools: manifest.tools,
              runtimeEntry: join(revisionRoot, manifest.runtime.entry),
              revisionRoot,
            };
          } catch {
            return undefined;
          }
        },
      });
      markStartupStage("database-ready");
      services.threadHistoryService = new ThreadHistoryService(
        join(app.getPath("userData"), "artemis.sqlite"),
      );
      services.taskNotifications = new TaskNotifications({
        store: services.store,
        window: () => services.mainWindow,
        locale: currentLocale,
        open: openTaskNotification,
        disabled: applicationHost.notificationsEnabled === false,
        report: (error) =>
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `Task notification: ${String(error)}`,
          }),
      });
      if (applicationHost.notificationsEnabled !== false)
        await registerTaskNotifications().catch((error) => {
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "warning",
            message: `Task notification registration: ${String(error)}`,
          });
        });
      // Boot sweep (D#152): pending invocation records are crash remnants —
      // they can never legitimately survive a restart. Mark them
      // outcome-unknown so they are never silently re-dispatched.
      const staleInvocations =
        services.store.markStalePendingCustomAgentInvocations();
      if (staleInvocations > 0) {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `Marked ${staleInvocations} stale custom-agent invocation(s) outcome-unknown after restart.`,
        });
      }
      services.turnChangeSetService = new TurnChangeSetService(
        join(app.getPath("userData"), "turn-changes"),
        services.store,
      );
      for (const event of services.store.recoverInterruptedThreads()) {
        observeTaskNotification(event);
        if (event.turnId && event.payload.type === "turn.activity")
          activeTurns.set(event.threadId, event.turnId);
      }
      services.store.recoverInterruptedAutomationRuns();
      services.settingsStore = new EncryptedSettingsStore(
        join(app.getPath("userData"), "settings.json"),
        safeStorage,
      );
      services.providerLoginService = new ProviderLoginService(
        services.settingsStore,
        applyAgentRuntime,
      );
      services.imService = new ImService(
        app.getPath("userData"),
        safeStorage,
        {
          locale: currentLocale,
          cancelDelegationContinuation: async (id, waitIds) => {
            const turnId = activeTurns.get(id);
            if (turnId && waitIds.includes(turnId) && !cancellingTurns.has(id))
              await cancelLocalTaskTurn(id);
          },
          resumeDelegation: async (id, text, mode, continuationId, local) => {
            // The deterministic turn ID is committed with the turn checkpoint. A
            // crash after dispatch but before IM acknowledgement cannot duplicate it.
            if (
              services
                .store!.getThreadEvents(id)
                .some((event) => event.turnId === continuationId)
            )
              return true;
            const queue = recoverableTurnQueues.snapshot(id);
            if (
              activeTurns.has(id) ||
              compactingThreads.has(id) ||
              cancellingTurns.has(id) ||
              queue.steering.length ||
              queue.followUp.length ||
              compactionFollowUps.snapshot(id).followUp.length ||
              pendingApprovals.hasWhere((p) => p.request.threadId === id) ||
              pendingUserInputs.hasWhere((p) => p.request.threadId === id) ||
              pendingMultiUserInputs.hasWhere((p) => p.request.threadId === id)
            )
              return false;
            await startTaskTurn(
              { threadId: id, text, mode, attachments: [] },
              {
                origin: local ? "desktop" : "im",
                delegationContinuationId: continuationId,
                displayText: imText(currentLocale(), "resumeDelegation"),
              },
            );
            return true;
          },
          groupActivity: (id, taskId, phase) => {
            const thread = services.store!.getThread(id);
            if (!thread) return;
            if (phase === "assigned" && thread.archived) {
              const restored = services.store!.updateThread(id, {
                archived: false,
              });
              services.mainWindow?.webContents.send(
                IPC.imTaskCreated,
                restored,
              );
            }
            emitPayload(id, undefined, {
              type: "im.group.activity",
              taskId,
              phase,
            });
          },
          updateGroup: (id, title) => {
            const thread = services.store!.getThread(id);
            if (thread && thread.title !== title) {
              const updated = services.store!.updateThread(id, { title });
              services.mainWindow?.webContents.send(IPC.imTaskCreated, updated);
            }
          },
          importAttachments: (paths) =>
            Promise.all(
              paths.map((path) => attachmentStore().importPath(path)),
            ),
          projects: () =>
            services.store!.snapshot(
              currentLocale(),
              currentPlatform(),
              getPlatformContract().sandbox,
              { includeEvents: false },
            ).projects,
          threads: () => services.store!.listThreads(),
          thread: (id) => services.store!.getThread(id),
          events: (id) => services.store!.getThreadEvents(id),
          ready: () => !!services.store && !!services.agentProcess,
          create: async (id, projectId, mode, title) => {
            const existing = services.store!.getThread(id);
            if (existing) return existing;
            const thread = await createTaskThread(
              { ...(projectId ? { projectId } : {}), mode, target: "local" },
              title,
              id,
            );
            if (!thread) throw new Error("Task was not created.");
            services.mainWindow?.webContents.send(IPC.imTaskCreated, thread);
            return thread;
          },
          close: async (id) => {
            await openingThreads.get(id);
            if (openedThreads.has(id) && services.agentProcess) {
              await services.agentProcess.request({
                type: "thread.close",
                requestId: randomUUID(),
                threadId: id,
              });
              openedThreads.delete(id);
            }
          },
          start: async (
            id,
            text,
            mode,
            attachments,
            displayText,
            titleContext,
          ) => {
            await startTaskTurn(
              { threadId: id, text, mode, attachments },
              {
                origin: "im",
                displayText: displayText ?? text,
                ...(titleContext ? { titleContext } : {}),
              },
            );
          },
          queue: async (id, text, attachments, displayText) => {
            await queueTurn(
              "turn.follow-up",
              {
                threadId: id,
                text,
                attachments,
              },
              false,
              displayText,
            );
          },
          classifyControlIntent: async (id, text) => {
            const thread = services.store?.getThread(id);
            const process = services.agentProcess;
            if (!thread || thread.archived || !process) return "message";
            const turnId = activeTurns.get(id);
            const selection =
              thread.modelSelection ?? services.activeRuntimeSelection;
            const intent = await process.request<ImControlIntent>(
              {
                type: "im.classify-control-intent",
                requestId: randomUUID(),
                taskTitle: thread.title,
                message: text,
                ...(selection ? { selection } : {}),
              },
              10_000,
            );
            const latest = services.store?.getThread(id);
            // A slow classification must not stop a replacement turn or session.
            return services.agentProcess === process &&
              !!latest &&
              !latest.archived &&
              activeTurns.get(id) === turnId &&
              (turnId !== undefined || latest.updatedAt === thread.updatedAt) &&
              (intent === "cancel-current" || intent === "new-task")
              ? intent
              : "message";
          },
          cancel: async (id) => {
            await cancelLocalTaskTurn(id);
          },
          approve: resolveApproval,
          answer: (resolution) => {
            const parsed = userInputResolutionSchema.parse(resolution);
            if (isMultiQuestionUserInputResolution(parsed)) {
              completeMultiUserInputQuestion(
                parsed.requestId,
                parsed.nonce,
                parsed.questionId,
                "user",
                parsed.skipped
                  ? { skipped: true }
                  : parsed.customAnswer !== undefined
                    ? { customAnswer: parsed.customAnswer }
                    : parsed.selectedOptionLabel !== undefined
                      ? { selectedOptionLabel: parsed.selectedOptionLabel }
                      : {},
              );
            } else completeUserInput(parsed, "user");
          },
        },
        process.platform === "win32" ? windowsSandboxHelperPath() : undefined,
        {
          executable: join(
            app.isPackaged
              ? join(process.resourcesPath, "slack-cli")
              : join(
                  app.getAppPath(),
                  "..",
                  "..",
                  "artifacts",
                  "slack-cli",
                  `${process.platform}-${process.arch}`,
                ),
            process.platform === "win32" ? "slack.exe" : "slack",
          ),
          hook: join(import.meta.dirname, "slack-cli-hook.cjs"),
          nodeExecutable: process.execPath,
        },
      );
      services.imService.start();
      sleepPrevention.setEnabled(
        await services.settingsStore.preventSleepPreference(),
      );
      const systemMemory = process.getSystemMemoryInfo();
      services.agentCapacityController = new AgentCapacityController(
        await services.settingsStore.agentConcurrencyPreference(),
        currentAgentCapacityHardware(systemMemory),
      );
      services.diagnosticBundleService.record({
        source: "main",
        severity: "info",
        message: `Agent concurrency startup limit ${services.agentCapacityController.limit}.`,
      });
      services.globalInstructionsStore = new GlobalInstructionsStore(
        join(app.getPath("userData"), "AGENTS.md"),
      );
      nativeTheme.on("updated", syncWindowBackgroundColors);
      await applicationHost.configureSettings?.();
      services.materialPreference =
        await services.settingsStore.materialPreference();
      applyNativeTheme(await services.settingsStore.themePreference());
      services.languagePreference =
        await services.settingsStore.languagePreference();
      services.resolvedLocalePreference = resolveAppLocale(
        services.languagePreference,
        app.getPreferredSystemLanguages(),
      );
      markStartupStage("core-state-ready");
      configureBrowserLocaleSession();
      electronSession.defaultSession.protocol.handle(
        WORKSPACE_HTML_SCHEME,
        (request) =>
          services.conversationShareService?.respond(request) ??
          workspaceHtmlPreview.respond(request),
      );
      // The right-panel webview needs the same revocable, sandboxed HTML handler.
      electronSession
        .fromPartition(BROWSER_SESSION_PARTITION)
        .protocol.handle(WORKSPACE_HTML_SCHEME, (request) =>
          workspaceHtmlPreview.respond(request),
        );
      // Media playback remains available only to timeline frames.
      electronSession.defaultSession.protocol.handle(
        WORKSPACE_VIDEO_SCHEME,
        (request) => workspaceVideoPreview.respond(request),
      );
      electronSession
        .fromPartition(BROWSER_SESSION_PARTITION)
        .protocol.handle(WORKSPACE_PDF_SCHEME, (request) =>
          workspacePdfPreview.respond(request),
        );
      await applicationHost.workspaceReady?.();
      // Frees the plugins/ namespace (S1 revisions lived under it) before the
      // native plugin-format migration claims it as its destination.
      await migrateLegacyDesignPluginRevisions(app.getPath("userData"));
      await migratePluginUserData(
        app.getPath("userData"),
        join(app.getPath("home"), ".pi", "agent", "skills"),
      );
      services.mcpConfigStore = new McpConfigStore(
        join(app.getPath("userData"), "mcp.json"),
      );
      await applicationHost.resourcesReady?.();
      services.mcpOAuthStore = new McpOAuthStore(
        join(app.getPath("userData"), "mcp-oauth.json"),
        safeStorage,
      );
      services.mcpSecretStore = new McpSecretStore(
        join(app.getPath("userData"), "mcp-secrets.json"),
        safeStorage,
      );
      services.connectorService = new ConnectorService({
        vault: new ConnectorVault(
          join(app.getPath("userData"), "connector-credentials-v1.json"),
          safeStorage,
        ),
        openExternal: async (url, signal) => {
          await assertPublicOAuthBrowserUrl(url);
          signal?.throwIfAborted();
          await shell.openExternal(url);
        },
        configs: async () => (await services.mcpConfigStore?.list()) ?? [],
        assertTrusted: async (config) => {
          if (!services.artemisPluginService)
            throw new Error("Plugin service is not ready.");
          return services.artemisPluginService.assertConnectorTrusted(config);
        },
        connectMcp: async (config, authentication) => {
          if (!services.mcpClientManager)
            throw new Error("MCP service is not ready.");
          const status = await services.mcpClientManager.connect(
            config,
            authentication,
            authentication?.authorizationCode
              ? { startupTimeoutMs: 300000 }
              : undefined,
          );
          if (status.state !== "connected")
            throw new Error(
              "Connector connection failed. Check service availability and permissions.",
            );
        },
        disconnectMcp: async (id) => {
          await services.mcpClientManager?.disconnect(id);
        },
        checkMailbox: async (config, context) => {
          if (!services.mcpClientManager || config.transport !== "stdio")
            throw new Error("Mailbox connector is unavailable.");
          const status = await services.mcpClientManager.connect(config);
          if (status.state !== "connected")
            throw new Error("Mailbox runtime is unavailable.");
          const result = await services.mcpClientManager.call(
            config.id,
            "mail_check_connection",
            {},
            config.workspacePath,
            "work",
            { [CONNECTOR_AUTH_META]: context },
          );
          if (result.isError)
            throw new Error(
              "Mailbox connection failed. Check the authorization code and IMAP/SMTP settings.",
            );
        },
      });
      await services.connectorService.migrateLegacyConnections();
      services.mcpClientManager = new McpClientManager(
        process.platform,
        process.platform === "win32" ? windowsSandboxHelperPath() : undefined,
        undefined,
        undefined,
        async (config) => {
          if (!services.artemisPluginService)
            throw new Error("Plugin service is not ready.");
          return services.artemisPluginService.mcpRuntimeReadOnlyPaths(config);
        },
      );
      services.mcpClientManager.onStatusChange((status) => {
        if (
          status.config.id === services.computerUseServerId &&
          status.state !== "connected"
        )
          services.computerUseHost?.disable("Computer Use connection changed");
        if (!services.mainWindow?.isDestroyed())
          services.mainWindow?.webContents.send(
            IPC.mcpServerStatus,
            status.config.id === services.computerUseServerId &&
              status.config.transport === "streamable-http"
              ? {
                  ...status,
                  config: { ...status.config, url: COMPUTER_USE_CONFIG_URL },
                }
              : status,
          );
      });
      services.resourceCatalogService = new ResourceCatalogService(
        join(app.getPath("home"), ".pi", "agent", "skills"),
      );
      services.artemisPluginService = new ArtemisPluginService({
        skillsRoot: join(app.getPath("home"), ".pi", "agent", "skills"),
        pluginsRoot: join(app.getPath("userData"), "plugins"),
        designRevisionsRoot: designPluginRevisionsRoot(app.getPath("userData")),
        marketplacesRoot: join(app.getPath("userData"), "plugin-marketplaces"),
        marketplaceStatePath: join(
          app.getPath("userData"),
          "plugin-marketplaces.json",
        ),
        statePath: join(app.getPath("userData"), "plugins.json"),
        mcpWorkspaceRoot: join(app.getPath("userData"), "mcp-workspaces"),
        mcpStore: services.mcpConfigStore,
        beforeSnapshotChange: async (pluginId) => {
          await services.appearanceService?.beforePluginChange(pluginId);
        },
        afterSnapshotChange: async () => {
          await services.appearanceService
            ?.refresh()
            .catch((error) =>
              console.error("Appearance refresh failed", error),
            );
        },
        bundledArtifactRoot: bundledArtifactPluginsPath(),
        computerUseRoot: join(
          dirname(bundledArtifactPluginsPath()),
          "computer-use",
        ),
        computerUseManagedRuntime: true,
        fetcher: (url, init) => net.fetch(url, init),
      });
      services.appearanceService = new AppearanceService({
        plugins: services.artemisPluginService,
        getSelection: () => services.settingsStore!.skinSelection(),
        saveSelection: (selection) =>
          services.settingsStore!.setSkinSelection(selection),
        getTheme: () => services.settingsStore!.themePreference(),
        changed: (state) => {
          if (
            services.mainWindow &&
            !services.mainWindow.webContents.isDestroyed()
          )
            services.mainWindow.webContents.send(IPC.appearanceChanged, state);
        },
      });
      await services.appearanceService.refresh();
      electronSession.defaultSession.protocol.handle(
        "artemis-skin",
        (request) => services.appearanceService!.respond(request),
      );
      powerMonitor.on("suspend", () => {
        appearanceSystemPauseReasons.add("sleep");
        syncAppearanceMedia();
      });
      powerMonitor.on("lock-screen", () => {
        appearanceSystemPauseReasons.add("lock");
        syncAppearanceMedia();
      });
      powerMonitor.on("resume", () => {
        appearanceSystemPauseReasons.delete("sleep");
        syncAppearanceMedia();
      });
      powerMonitor.on("unlock-screen", () => {
        appearanceSystemPauseReasons.delete("lock");
        syncAppearanceMedia();
      });
      for (const warning of await services.artemisPluginService.upgradeMigratedBundledPlugins())
        console.warn(warning);
      services.browserSessionHost = new BrowserSessionHost({
        navigationAllowed: isEmbeddedBrowserNavigationAllowed,
        register: (contents, threadId) =>
          services.computerUseHost?.registerOwnedBrowser(contents, threadId),
        present: (contentsId, presentation) =>
          services.computerUseHost?.presentBrowser(contentsId, presentation),
        input: async (threadId, contentsId, input) => {
          if (services.computerUseHost)
            await services.computerUseHost.humanInput(
              threadId,
              contentsId,
              input,
            );
        },
        changed: (snapshot) => {
          if (services.mainWindow && !services.mainWindow.isDestroyed())
            services.mainWindow.webContents.send(IPC.browserSession, snapshot);
        },
        closed: (contents) =>
          services.computerPreviewHost?.closeTarget(`browser:${contents.id}`),
        workspaceDocument: async (threadId, path) => {
          if (/\.html?$/iu.test(path))
            return (await workspaceHtmlPreview.open(threadId, path)).url;
          if (/\.pdf$/iu.test(path))
            return workspacePdfPreview.open(threadId, path);
          throw new Error("Browser workspace preview requires HTML or PDF");
        },
        releaseDocument: (threadId, url) =>
          workspaceHtmlPreview.release(threadId, url),
        takeover: (threadId, contentsId) =>
          services.computerUseHost?.service.stopTargets(
            (target) => target.id === `browser:${contentsId}`,
            threadId,
            "User took control",
          ),
      });
      if (process.platform === "darwin" || process.platform === "win32") {
        const computerResources = join(
          dirname(bundledArtifactPluginsPath()),
          "computer-use",
        );
        const catalog = JSON.parse(
          await readFile(join(computerResources, "catalog.json"), "utf8"),
        ) as OfficeRuntimeCatalog;
        services.computerUseRuntime = new ComputerUseRuntime({
          userData: app.getPath("userData"),
          catalog: computerUseVerificationCatalog(
            catalog,
            process.env.ARTEMIS_COMPUTER_USE_CANDIDATE_VERSION,
          ),
          hostVersion: app.getVersion(),
          fetch: (url, init) =>
            net.fetch(url instanceof URL ? url.toString() : url, init),
          activated: () => applyAgentRuntime(),
          busy: () =>
            Boolean(services.computerUseHost?.service.hasTargets()) ||
            services.computerUseCalls > 0,
          stopHelper: async () => {
            await services.computerUseHost?.native.close();
          },
          commitPlugin: async (root, version) => {
            await services.artemisPluginService!.installComputerUseFromRoot(
              root,
              version,
            );
          },
        });
        const acquireComputerHelper = computerHelperSource(
          {
            isPackaged: app.isPackaged,
            appPath: app.getAppPath(),
            platform: process.platform,
          },
          () => services.computerUseRuntime!.helper(),
        );
        services.computerUseHost = new ComputerUseHost({
          helperPath: acquireComputerHelper,
          permissionsPath: join(
            app.getPath("userData"),
            "computer-use-permissions.json",
          ),
          window: () => services.mainWindow,
          locale: currentLocale,
          browsers: services.browserSessionHost!,
          stateChanged: (state) => services.computerPreviewHost?.update(state),
          idle: () => {
            void services.computerUseRuntime
              ?.finishUpdate()
              .catch((error) =>
                console.error("Computer Use activation failed", error),
              );
          },
        });
        services.computerPreviewHost = new ComputerPreviewHost({
          driver: services.computerUseHost.native,
          acquire: acquireComputerHelper,
          browsers: services.browserSessionHost!,
          authorized: (threadId, targetId) =>
            services.computerUseHost?.service.previewTarget(threadId, targetId),
          publish: (states) => {
            if (services.mainWindow && !services.mainWindow.isDestroyed())
              services.mainWindow.webContents.send(
                IPC.computerPreviews,
                states,
              );
            services.computerPreviewWindow?.update(states);
          },
          expand: (state) => {
            if (services.mainWindow && !services.mainWindow.isDestroyed()) {
              services.mainWindow.show();
              services.mainWindow.focus();
              services.mainWindow.webContents.send(
                IPC.computerPreviewExpand,
                state,
              );
            }
          },
        });
        services.computerPreviewWindow = new ComputerPreviewWindow({
          main: () => services.mainWindow,
          host: () => services.computerPreviewHost,
          locale: currentLocale,
        });
        await services.computerUseRuntime
          .initialize()
          .catch((error) =>
            console.error("Computer Use recovery failed", error),
          );
      }
      services.configurationImportService = new ConfigurationImportService({
        homePath: app.getPath("home"),
        skillsPath: join(app.getPath("home"), ".pi", "agent", "skills"),
        mcpWorkspaceRoot: join(app.getPath("userData"), "mcp-workspaces"),
        globalInstructions: services.globalInstructionsStore,
      });
      services.trustedExtensionStore = new TrustedExtensionStore(
        join(app.getPath("userData"), "trusted-extensions.json"),
      );
      services.trustedExtensionManager = new TrustedExtensionManager(
        process.platform,
        process.platform === "win32" ? windowsSandboxHelperPath() : undefined,
        extensionWorkerPath(),
      );
      services.releaseUpdateManager = await createDesktopUpdateService({
        updater: autoUpdater,
        version: app.getVersion(),
        packaged: app.isPackaged,
        platform: process.platform,
        userData: app.getPath("userData"),
        home: app.getPath("home"),
        resources: process.resourcesPath,
        executable: process.execPath,
        application: installedApplicationPath(),
        rollbackScript: rollbackScriptPath(),
        environment: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key, value]) =>
              key.startsWith("ARTEMIS_UPDATE_") && value !== undefined,
          ),
        ),
        onStatus: (status) =>
          services.mainWindow?.webContents.send(IPC.updateStatus, status),
        prepareToQuit: async () => {
          if (activeTurns.size || startingTurns.size)
            throw new Error(
              "Finish or stop running tasks before installing an update.",
            );
          services.preparingUpdate = true;
          services.automationScheduler?.stop();
          if (
            !services.mainWindow ||
            services.mainWindow.webContents.isDestroyed()
          )
            throw new Error(
              "Cannot verify unsaved edits without the main window.",
            );
          await services.mainWindow.webContents.executeJavaScript(
            "window.artemisFlushWorkspaceEdits()",
          );
        },
        cancelPreparation: () => {
          services.preparingUpdate = false;
          if (!services.recoveringUpdate) services.automationScheduler?.start();
        },
        quit: () => app.quit(),
      });
      services.terminalService = new TerminalService(process.platform, {
        onData(terminalId, data) {
          services.mainWindow?.webContents.send(IPC.terminalData, {
            terminalId,
            data,
          });
        },
        onExit(event) {
          services.mainWindow?.webContents.send(IPC.terminalExit, event);
        },
      });
      services.agentProcess = createAgentHostProcess();
      services.agentCapacityRuntime = {
        active: 0,
        activeParents: 0,
        waiting: 0,
        queued: 0,
        limit: services.agentCapacityController.limit,
      };
      startAgentCapacityMonitoring();
      services.agentRuntimeReady = applyAgentRuntime();
      services.optionalCapabilitiesReady = services.agentRuntimeReady.then(
        async () => {
          try {
            await initializeOptionalCapabilities();
          } catch (error) {
            services.diagnosticBundleService?.record({
              source: "main",
              severity: "error",
              message: `Optional capabilities did not finish initializing: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          }
        },
      );
      void services.optionalCapabilitiesReady.catch((error) => {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "fatal",
          message: `Agent runtime did not finish initializing: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      });
      services.automationScheduler = new AutomationScheduler({
        store: services.store,
        onEvent: publishAutomationEvent,
        notify: automationRunNotification,
        launch: async (automation, run, linkThread) => {
          const modelSettings = automation.modelSelection
            ? await resolveModelSelection(
                automation.modelSelection,
                automation.modelSelection,
              )
            : undefined;
          const scheduledLabel = new Intl.DateTimeFormat(currentLocale(), {
            dateStyle: "short",
            timeStyle: "short",
            ...(automation.schedule.kind === "interval"
              ? {}
              : { timeZone: automation.schedule.timeZone }),
          }).format(new Date(run.scheduledFor));
          const thread = await createTaskThread(
            {
              projectId: automation.projectId,
              mode: automation.mode,
              target: automation.target,
            },
            `${automation.name} · ${scheduledLabel}`,
          );
          if (!thread) {
            throw new Error("Scheduled task creation was cancelled.");
          }
          linkThread(thread.id);
          if (modelSettings) {
            services.store!.updateThread(thread.id, {
              modelSelection: modelSettings.selection,
              contextWindow: modelSettings.contextWindow,
            });
          }
          await startTaskTurn({
            threadId: thread.id,
            text: automation.prompt,
            mode: automation.mode,
          });
        },
      });
      registerIpc();
      // Hosts can finish initialization once the IPC services are registered.
      await applicationHost.beforeWindowCreated?.();
      services.mainWindow = createMainWindow();
      registerThreadLinks();
      markStartupStage("window-created");
      void services.optionalCapabilitiesReady
        .then(() => {
          if (applicationHost.resumeInterruptedTurns === false) return;
          return resumeInterruptedTurns();
        })
        .catch((error) => {
          if (services.shuttingDown) return;
          for (const [threadId, turnId] of [...activeTurns]) {
            emitPayload(threadId, turnId, {
              type: "turn.failed",
              code: "HOST_RESTART",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
      services.releaseUpdateReady = services.releaseUpdateManager.initialize();
      void services.releaseUpdateReady.then(
        () => markStartupStage("update-ready"),
        (error) => {
          services.diagnosticBundleService?.record({
            source: "main",
            severity: "error",
            message: `Update recovery did not finish initializing: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        },
      );
      if (!services.recoveringUpdate) services.automationScheduler.start();
      const markUpdateHealthy = (event: Electron.IpcMainEvent) => {
        if (
          event.sender !== services.mainWindow?.webContents ||
          event.senderFrame !== services.mainWindow.webContents.mainFrame
        )
          return;
        ipcMain.removeListener(IPC.rendererReady, markUpdateHealthy);
        void services.releaseUpdateReady
          .then(async () => {
            await services.agentProcess?.request(
              { type: "runtime.concurrency.status", requestId: randomUUID() },
              15000,
            );
            if (
              !services.store ||
              !services.agentProcess ||
              !services.mainWindow
            )
              throw new Error("Application services are not healthy");
            const rendered =
              await services.mainWindow.webContents.executeJavaScript(
                "Boolean(window.artemis && document.getElementById('root')?.children.length)",
              );
            if (!rendered) throw new Error("Renderer is not ready");
            await services.releaseUpdateManager?.markHealthy();
            if (services.recoveringUpdate) {
              services.recoveringUpdate = false;
              services.automationScheduler?.start();
            }
            services.releaseUpdateManager?.startAutomaticChecks((error) => {
              services.diagnosticBundleService?.record({
                source: "main",
                severity: "warning",
                message: `Background update check failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
            });
          })
          .catch(() => undefined);
      };
      ipcMain.on(IPC.rendererReady, markUpdateHealthy);

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          services.mainWindow = createMainWindow();
        }
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Artemis startup failed.", error);
      if (applicationHost.showStartupErrors !== false) {
        dialog.showErrorBox("Artemis failed to start", message);
      }
      app.exit(1);
    });
}
