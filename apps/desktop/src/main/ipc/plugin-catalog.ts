import { uiText } from "../../shared/i18n/ui-text.js";
import { basename } from "node:path";
import { dialog } from "electron";
import { mainText } from "../settings/i18n.js";
import {
  IPC,
  type ArtemisPluginMarketplace,
  type ArtemisPluginMarketplaceState,
  type ArtemisPluginPreview,
  type InstalledArtemisPlugin,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "artemisPluginService"
  | "pluginsWithHookState"
  | "ipcMain"
  | "mainWindow"
  | "currentLocale"
  | "restoreResourceDialogFocus"
  | "resourceInstallOperationId"
  | "publishResourceInstallProgress"
>;

export function registerPluginCatalogIpc(services: Dependencies): void {
  const {
    pluginsWithHookState,
    ipcMain,
    currentLocale,
    restoreResourceDialogFocus,
    resourceInstallOperationId,
    publishResourceInstallProgress,
  } = services;

  ipcMain.handle(
    IPC.resourcePluginList,
    async (): Promise<InstalledArtemisPlugin[]> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return pluginsWithHookState();
    },
  );
  ipcMain.handle(
    IPC.resourcePluginInspectLocal,
    async (event): Promise<ArtemisPluginPreview | undefined> => {
      if (!services.artemisPluginService || !services.mainWindow) {
        throw new Error("Plugin service is not ready.");
      }
      const selection = await dialog.showOpenDialog(services.mainWindow, {
        properties: ["openDirectory"],
        title: mainText(currentLocale(), "selectLocalPlugin"),
      });
      restoreResourceDialogFocus(event.sender);
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) return undefined;
      return services.artemisPluginService.inspectLocal(selectedPath);
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceLoad,
    async (
      event,
      urlInput: string,
      operationIdInput: string,
      refreshInput?: boolean,
    ): Promise<ArtemisPluginMarketplace> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = String(urlInput ?? "").trim();
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId,
          percent,
        });
      publish(5);
      return services.artemisPluginService.loadGitMarketplace(
        resourceId,
        (percent) => publish(10 + percent * 0.9),
        refreshInput === true,
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceList,
    async (
      _event,
      sourceIdInput?: string,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      return services.artemisPluginService.listMarketplaces(
        typeof sourceIdInput === "string" && sourceIdInput.trim()
          ? sourceIdInput.trim()
          : undefined,
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceTrust,
    async (_event, urlInput: string) => {
      if (!services.artemisPluginService)
        throw new Error("Plugin service is not ready.");
      return services.artemisPluginService.inspectMarketplaceTrust(
        String(urlInput ?? "").trim(),
      );
    },
  );
  ipcMain.handle(IPC.resourcePluginMarketplaceInspectOffline, async (event) => {
    if (!services.artemisPluginService || !services.mainWindow) {
      throw new Error("Plugin service is not ready.");
    }
    const selection = await dialog.showOpenDialog(services.mainWindow, {
      properties: ["openFile", "openDirectory"],
      filters: [
        {
          name: uiText(currentLocale(), "native.offlineMarketplace"),
          extensions: ["gz", "tgz"],
        },
      ],
      title: uiText(currentLocale(), "native.selectOfflineMarketplace"),
    });
    restoreResourceDialogFocus(event.sender);
    const path = selection.filePaths[0];
    if (selection.canceled || !path) return undefined;
    return {
      path,
      trust:
        await services.artemisPluginService.inspectOfflineMarketplace(path),
    };
  });
  ipcMain.handle(
    IPC.resourcePluginMarketplaceAddOffline,
    async (
      event,
      pathInput: string,
      operationIdInput: string,
      signingKeyFingerprintInput: string,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const path = String(pathInput ?? "").trim();
      const fingerprint = String(signingKeyFingerprintInput ?? "").trim();
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = basename(path) || "offline marketplace";
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId,
          percent,
        });
      return services.artemisPluginService.addOfflineMarketplace(
        path,
        fingerprint,
        publish,
      );
    },
  );
  ipcMain.handle(
    IPC.resourcePluginMarketplaceAdd,
    async (
      event,
      urlInput: string,
      operationIdInput: string,
      signingKeyFingerprintInput?: string,
    ): Promise<ArtemisPluginMarketplaceState> => {
      if (!services.artemisPluginService) {
        throw new Error("Plugin service is not ready.");
      }
      const operationId = resourceInstallOperationId(operationIdInput);
      const resourceId = String(urlInput ?? "").trim();
      const publish = (percent: number) =>
        publishResourceInstallProgress(event.sender, {
          operationId,
          kind: "plugin",
          resourceId,
          percent,
        });
      publish(5);
      const signingKeyFingerprint = String(
        signingKeyFingerprintInput ?? "",
      ).trim();
      return services.artemisPluginService.addMarketplace(
        resourceId,
        (percent) => publish(10 + percent * 0.9),
        signingKeyFingerprint || undefined,
      );
    },
  );
}
