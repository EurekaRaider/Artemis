import { app, dialog } from "electron";
import { getPlatformContract } from "@artemis/platform";
import { mainText } from "../settings/i18n.js";
import { IPC, type RendererDiagnostic } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "releaseUpdateManager"
  | "releaseUpdateReady"
  | "ipcMain"
  | "diagnosticBundleService"
  | "store"
  | "mainWindow"
  | "currentLocale"
  | "currentPlatform"
  | "activeTurns"
  | "agentConcurrencyStatus"
>;

export function registerUpdatesDiagnosticsIpc(services: Dependencies): void {
  const {
    ipcMain,
    currentLocale,
    currentPlatform,
    activeTurns,
    agentConcurrencyStatus,
  } = services;

  ipcMain.handle(IPC.updateCheck, async () => {
    if (!services.releaseUpdateManager) {
      throw new Error("Update service is not ready.");
    }
    await services.releaseUpdateReady;
    return services.releaseUpdateManager.check();
  });
  ipcMain.handle(IPC.updateDownload, async () => {
    if (!services.releaseUpdateManager)
      throw new Error("Update service is not ready.");
    await services.releaseUpdateReady;
    return services.releaseUpdateManager.download();
  });
  ipcMain.handle(IPC.updateInstall, async () => {
    if (!services.releaseUpdateManager) {
      throw new Error("Update service is not ready.");
    }
    await services.releaseUpdateReady;
    await services.releaseUpdateManager.install();
  });
  ipcMain.handle(
    IPC.diagnosticsExport,
    async (): Promise<string | undefined> => {
      if (
        !services.diagnosticBundleService ||
        !services.store ||
        !services.mainWindow
      ) {
        throw new Error("Diagnostic service is not ready.");
      }
      const result = await dialog.showSaveDialog(services.mainWindow, {
        title: mainText(currentLocale(), "exportDiagnostics"),
        defaultPath: `Artemis-diagnostics-${new Date()
          .toISOString()
          .replaceAll(":", "-")}.json.gz`,
        filters: [{ name: "Gzip JSON", extensions: ["gz"] }],
      });
      if (result.canceled || !result.filePath) return undefined;
      const contract = getPlatformContract();
      const snapshot = services.store.snapshot(
        currentLocale(),
        currentPlatform(),
        {
          available: contract.sandbox.available,
          implementation: contract.sandbox.implementation,
        },
      );
      await services.diagnosticBundleService.exportBundle(result.filePath, {
        appVersion: app.getVersion(),
        platform: process.platform,
        architecture: process.arch,
        locale: currentLocale(),
        projectCount: snapshot.projects.length,
        threadCount: snapshot.threads.length,
        activeTurnCount: activeTurns.size,
        agentConcurrency: await agentConcurrencyStatus(),
      });
      return result.filePath;
    },
  );
  ipcMain.on(
    IPC.diagnosticsRendererError,
    (event, input: RendererDiagnostic) => {
      if (
        event.sender.id !== services.mainWindow?.webContents.id ||
        !input ||
        !["error", "unhandled-rejection"].includes(input.kind) ||
        typeof input.message !== "string" ||
        Buffer.byteLength(input.message, "utf8") > 32 * 1024 ||
        (input.stack !== undefined &&
          (typeof input.stack !== "string" ||
            Buffer.byteLength(input.stack, "utf8") > 64 * 1024))
      ) {
        return;
      }
      services.diagnosticBundleService?.record({
        source: "renderer",
        severity: "error",
        message: input.message,
        ...(input.stack ? { stack: input.stack } : {}),
      });
    },
  );
}
