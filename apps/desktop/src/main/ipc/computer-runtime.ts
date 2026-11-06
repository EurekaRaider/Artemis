import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "computerUseRuntime" | "artemisPluginService" | "ipcMain"
>;

export function registerComputerRuntimeIpc(services: Dependencies): void {
  const { ipcMain } = services;

  ipcMain.handle(IPC.computerRuntimeStatus, async () => {
    if (!services.computerUseRuntime) return undefined;
    const status = await services.computerUseRuntime.status();
    const legacy = (await services.artemisPluginService?.listInstalled())?.some(
      (plugin) => plugin.source.kind === "builtin",
    );
    return {
      ...status,
      migrationRequired: Boolean(legacy && !status.activeVersion),
    };
  });
  ipcMain.handle(IPC.computerRuntimeCheck, async () => {
    await services.computerUseRuntime?.check();
    return services.computerUseRuntime?.status();
  });
  ipcMain.handle(IPC.computerRuntimeCancel, () => {
    services.computerUseRuntime?.cancel();
  });
}
