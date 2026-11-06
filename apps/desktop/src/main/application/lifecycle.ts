import { app, dialog, shell } from "electron";
import { externalHttpUrl } from "../workspace/navigation-policy.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "workspaceVideoPreview"
  | "workspaceHtmlPreview"
  | "computerUseHost"
  | "computerPreviewHost"
  | "browserSessionHost"
  | "mainWindow"
  | "diagnosticBundleService"
  | "providerLoginService"
  | "conversationShareService"
  | "computerPreviewWindow"
  | "endingHookSessions"
  | "shuttingDown"
  | "automationScheduler"
  | "pluginDispatch"
  | "designPanelHost"
  | "cancelTaskTurn"
  | "activeTurns"
  | "hooksService"
  | "mcpClientManager"
  | "imService"
  | "endHookSession"
  | "openedThreads"
  | "officeWorkbench"
  | "hookSessionsEnded"
  | "releaseUpdateManager"
  | "sleepPrevention"
  | "pendingUserInputs"
  | "pendingMultiUserInputs"
  | "stopAgentCapacityMonitoring"
  | "terminalService"
  | "trustedExtensionManager"
  | "packagedNodePtyRuntime"
  | "packagedNodePtyRuntimeReady"
  | "agentProcess"
  | "appearanceService"
  | "threadHistoryService"
  | "store"
>;

export function installApplicationLifecycle(services: Dependencies): void {
  const {
    workspaceVideoPreview,
    workspaceHtmlPreview,
    cancelTaskTurn,
    activeTurns,
    endHookSession,
    openedThreads,
    sleepPrevention,
    pendingUserInputs,
    pendingMultiUserInputs,
    stopAgentCapacityMonitoring,
  } = services;
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const linkUrl = externalHttpUrl(url);
      if (linkUrl) {
        void shell.openExternal(linkUrl);
      }
      return { action: "deny" };
    });
  });
  app.on("render-process-gone", (_event, _contents, details) => {
    if (_contents === services.mainWindow?.webContents) {
      workspaceVideoPreview.clear();
      workspaceHtmlPreview.clear();
      services.computerUseHost?.service.stopAll("Artemis renderer stopped");
      services.computerUseHost?.native.dispose();
      services.computerPreviewHost?.dispose();
      services.browserSessionHost?.removeContents(_contents);
    }
    services.diagnosticBundleService?.record({
      source: "renderer",
      severity: details.reason === "clean-exit" ? "info" : "fatal",
      message: `Renderer process ended: ${details.reason}; exit code ${details.exitCode}.`,
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
  app.on("before-quit", (event) => {
    services.providerLoginService?.cancel();
    services.conversationShareService?.dispose();
    services.computerUseHost?.dispose();
    services.computerPreviewHost?.dispose();
    services.computerPreviewWindow?.dispose();
    services.browserSessionHost?.dispose();
    if (
      !services.hookSessionsEnded &&
      (openedThreads.size || services.officeWorkbench || services.mainWindow)
    ) {
      event.preventDefault();
      if (!services.endingHookSessions) {
        services.endingHookSessions = true;
        void (async () => {
          if (
            services.mainWindow &&
            !services.mainWindow.webContents.isDestroyed()
          )
            await services.mainWindow.webContents.executeJavaScript(
              "window.artemisFlushWorkspaceEdits?.()",
            );
          services.shuttingDown = true;
          services.automationScheduler?.stop();
          services.pluginDispatch?.dispose();
          services.designPanelHost?.disposeAll();
          await Promise.allSettled([...activeTurns.keys()].map(cancelTaskTurn));
          services.hooksService?.dispose();
          await Promise.allSettled([
            services.mcpClientManager?.dispose(),
            services.imService?.quiesce(),
            ...[...openedThreads].map((id) => endHookSession(id)),
            services.officeWorkbench?.then(async (workbench) => {
              workbench.packs.cancel();
              await workbench.sessions.dispose();
            }),
          ]);
          services.hookSessionsEnded = true;
          app.quit();
        })().catch((error: unknown) => {
          services.endingHookSessions = false;
          services.shuttingDown = false;
          dialog.showErrorBox("Document save failed", String(error));
        });
      }
      return;
    }
    services.releaseUpdateManager?.stopAutomaticChecks();
    services.shuttingDown = true;
    sleepPrevention.dispose();
    for (const pending of pendingUserInputs.cancelWhere(() => true)) {
      if (pending.value.timeout !== undefined) {
        clearTimeout(pending.value.timeout);
      }
    }
    for (const pending of pendingMultiUserInputs.cancelWhere(() => true)) {
      for (const timeout of pending.value.timeouts.values()) {
        clearTimeout(timeout);
      }
    }
    services.automationScheduler?.stop();
    stopAgentCapacityMonitoring();
    services.terminalService?.dispose();
    services.pluginDispatch?.dispose();
    services.designPanelHost?.disposeAll();
    services.trustedExtensionManager?.dispose();
    services.hooksService?.dispose();
    if (services.packagedNodePtyRuntimeReady) {
      void services.packagedNodePtyRuntimeReady.then(
        () => services.packagedNodePtyRuntime?.dispose(),
        () => undefined,
      );
    }
    void services.mcpClientManager?.dispose();
    services.agentProcess?.dispose();
  });
  app.on("will-quit", () => {
    void services.appearanceService?.dispose();
    services.imService?.stop();
    services.threadHistoryService?.close();
    services.store?.close();
  });
}
