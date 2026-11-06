import type { Automation, AutomationRun } from "@artemis/protocol";
import { IPC, type SaveAutomationInput } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "ipcMain"
  | "saveAutomation"
  | "setAutomationEnabled"
  | "authorizeAutomation"
  | "automationDeleted"
  | "automationScheduler"
>;

export function registerAutomationsIpc(services: Dependencies): void {
  const {
    ipcMain,
    saveAutomation,
    setAutomationEnabled,
    authorizeAutomation,
    automationDeleted,
  } = services;

  ipcMain.handle(
    IPC.automationList,
    (_event, projectId?: string): Automation[] => {
      if (!services.store) throw new Error("Application store is not ready.");
      if (
        projectId !== undefined &&
        (typeof projectId !== "string" || !projectId.trim())
      ) {
        throw new Error("Automation project ID is invalid.");
      }
      return services.store.listAutomations(projectId);
    },
  );
  ipcMain.handle(
    IPC.automationRunList,
    (_event, automationId: string, limit?: number): AutomationRun[] => {
      if (!services.store) throw new Error("Application store is not ready.");
      if (typeof automationId !== "string" || !automationId.trim()) {
        throw new Error("Automation ID is invalid.");
      }
      return services.store.listAutomationRuns(automationId, limit);
    },
  );
  ipcMain.handle(
    IPC.automationSave,
    (_event, input: SaveAutomationInput): Promise<Automation> =>
      saveAutomation(input),
  );
  ipcMain.handle(
    IPC.automationEnable,
    (_event, id: string, enabled: boolean): Promise<Automation> => {
      if (typeof id !== "string" || typeof enabled !== "boolean") {
        throw new Error("Automation enable request is invalid.");
      }
      return setAutomationEnabled(id, enabled);
    },
  );
  ipcMain.handle(
    IPC.automationAuthorize,
    (_event, id: string): Promise<Automation | undefined> => {
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Automation ID is invalid.");
      }
      return authorizeAutomation(id);
    },
  );
  ipcMain.handle(IPC.automationDelete, async (_event, id: string) => {
    if (!services.store) throw new Error("Application store is not ready.");
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Automation ID is invalid.");
    }
    if (services.store.hasActiveAutomationRun(id)) {
      throw new Error("Stop the active scheduled task before deleting it.");
    }
    services.store.softDeleteAutomation(id);
    automationDeleted(id);
    await services.automationScheduler?.refresh();
  });
  ipcMain.handle(
    IPC.automationRunNow,
    (_event, id: string): Promise<AutomationRun> => {
      if (!services.automationScheduler) {
        throw new Error("Automation scheduler is not ready.");
      }
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Automation ID is invalid.");
      }
      return services.automationScheduler.runNow(id);
    },
  );
}
