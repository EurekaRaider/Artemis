import { uiText } from "../../shared/i18n/ui-text.js";
import { dialog } from "electron";
import { mainText } from "../settings/i18n.js";
import { IPC, type SettingsSnapshot } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "trustedExtensionStore"
  | "mainWindow"
  | "currentLocale"
  | "resetAgentThreadsForToolChange"
  | "refreshTrustedExtensions"
  | "applyAgentRuntime"
  | "getSettingsSnapshot"
  | "ipcMain"
>;

export function registerExtensionsIpc(services: Dependencies): void {
  const {
    currentLocale,
    resetAgentThreadsForToolChange,
    refreshTrustedExtensions,
    applyAgentRuntime,
    getSettingsSnapshot,
    ipcMain,
  } = services;

  ipcMain.handle(
    IPC.extensionTrust,
    async (): Promise<SettingsSnapshot | undefined> => {
      if (!services.trustedExtensionStore || !services.mainWindow) {
        throw new Error("Trusted extension service is not ready.");
      }
      const selection = await dialog.showOpenDialog(services.mainWindow, {
        properties: ["openFile"],
        title: mainText(currentLocale(), "selectPiExtension"),
        filters: [
          {
            name: uiText(currentLocale(), "native.extensionFilter"),
            extensions: ["js", "mjs", "cjs", "ts", "mts", "cts"],
          },
        ],
      });
      const selectedPath = selection.filePaths[0];
      if (selection.canceled || !selectedPath) return undefined;
      await resetAgentThreadsForToolChange();
      await services.trustedExtensionStore.trust(selectedPath);
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionRetrust,
    async (_event, extensionId: string): Promise<SettingsSnapshot> => {
      if (!services.trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      const config = (await services.trustedExtensionStore.list()).find(
        (candidate) => candidate.id === extensionId,
      );
      if (!config) throw new Error("Trusted extension was not found.");
      await services.trustedExtensionStore.trust(config.path, {
        name: config.name,
        allowNetwork: config.allowNetwork,
      });
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionEnable,
    async (
      _event,
      extensionId: string,
      enabled: boolean,
    ): Promise<SettingsSnapshot> => {
      if (!services.trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      await services.trustedExtensionStore.setEnabled(
        extensionId,
        Boolean(enabled),
      );
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionNetwork,
    async (
      _event,
      extensionId: string,
      allowNetwork: boolean,
    ): Promise<SettingsSnapshot> => {
      if (!services.trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      await services.trustedExtensionStore.setAllowNetwork(
        extensionId,
        Boolean(allowNetwork),
      );
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
  ipcMain.handle(
    IPC.extensionRemove,
    async (_event, extensionId: string): Promise<SettingsSnapshot> => {
      if (!services.trustedExtensionStore) {
        throw new Error("Trusted extension service is not ready.");
      }
      await resetAgentThreadsForToolChange();
      await services.trustedExtensionStore.remove(extensionId);
      await refreshTrustedExtensions();
      await applyAgentRuntime();
      return getSettingsSnapshot();
    },
  );
}
