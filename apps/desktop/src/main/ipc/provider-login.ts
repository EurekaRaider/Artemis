import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "mainWindow" | "providerLoginService" | "ipcMain"
>;

export function registerProviderLoginIpc(services: Dependencies): void {
  const { ipcMain } = services;

  const userLogin = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== services.mainWindow?.webContents ||
      !services.providerLoginService
    )
      throw new Error("Provider login is only available to the desktop user.");
    return services.providerLoginService;
  };
  ipcMain.handle(IPC.providerLoginOptions, (event) =>
    userLogin(event).providers(),
  );
  ipcMain.handle(
    IPC.providerLoginStart,
    (event, providerId: string, type: "api_key" | "oauth") =>
      userLogin(event).start(providerId, type),
  );
  ipcMain.handle(IPC.providerLoginStatus, (event, id: string) =>
    userLogin(event).status(id),
  );
  ipcMain.handle(
    IPC.providerLoginAnswer,
    (event, id: string, promptId: string, value: string) =>
      userLogin(event).answer(id, promptId, value),
  );
  ipcMain.handle(IPC.providerLoginCancel, (event, id: string) =>
    userLogin(event).cancel(id),
  );
}
