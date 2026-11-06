import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "requireAppearanceSender" | "ipcMain"
>;

export function registerAppearanceIpc(services: Dependencies): void {
  const { requireAppearanceSender, ipcMain } = services;

  ipcMain.handle(IPC.appearanceGet, (event) =>
    requireAppearanceSender(event).state(),
  );
  ipcMain.handle(IPC.appearanceResolve, (event, selection: unknown) =>
    requireAppearanceSender(event).resolve(event.sender.id, selection),
  );
  ipcMain.handle(IPC.appearanceRelease, (event, leaseId: unknown) => {
    const service = requireAppearanceSender(event);
    if (typeof leaseId !== "string" || leaseId.length > 80)
      throw new Error("Invalid skin resource lease.");
    return service.release(event.sender.id, leaseId);
  });
  ipcMain.handle(IPC.appearanceSelect, (event, selection: unknown) =>
    requireAppearanceSender(event).select(selection),
  );
}
