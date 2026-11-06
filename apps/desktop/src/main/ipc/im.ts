import { uiText } from "../../shared/i18n/ui-text.js";
import { imManagementSchema } from "@artemis/protocol";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog } from "electron";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "imService" | "ipcMain" | "mainWindow" | "currentLocale"
>;

export function registerImIpc(services: Dependencies): void {
  const { ipcMain, currentLocale } = services;

  ipcMain.handle(IPC.imStatus, async () => {
    if (!services.imService) throw new Error("IM service is not ready.");
    const status = await services.imService.status();

    return status;
  });
  ipcMain.handle(IPC.imSave, (_event, input: unknown) => {
    if (!services.imService) throw new Error("IM service is not ready.");
    return services.imService.save(input);
  });
  ipcMain.handle(IPC.imManage, async (_event, input: unknown) => {
    if (!services.imService) throw new Error("IM service is not ready.");
    const action = imManagementSchema.parse(input);
    if (action.action === "preview-legacy") {
      if (!services.mainWindow) throw new Error("Desktop window is not ready.");
      const result = await dialog.showOpenDialog(services.mainWindow, {
        title: uiText(currentLocale(), "native.legacySettings"),
        properties: ["openFile"],
        filters: [
          {
            name: uiText(currentLocale(), "native.settingsFilter"),
            extensions: ["json"],
          },
        ],
      });
      return result.canceled || !result.filePaths[0]
        ? undefined
        : services.imService.previewLegacyIm(result.filePaths[0]);
    }
    if (action.action === "export-gateway") {
      if (!services.mainWindow) throw new Error("Desktop window is not ready.");
      const result = await dialog.showSaveDialog(services.mainWindow, {
        title: uiText(currentLocale(), "native.exportGateway"),
        defaultPath: "artemis-gateway.tar.gz",
        filters: [
          {
            name: uiText(currentLocale(), "native.gatewayPackage"),
            extensions: ["tar.gz"],
          },
        ],
      });
      if (result.canceled || !result.filePath) return undefined;
      await copyFile(
        join(app.getAppPath(), "dist-electron", "artemis-gateway.tar.gz"),
        result.filePath,
      );
      return result.filePath;
    }
    return services.imService.manage(action);
  });
}
