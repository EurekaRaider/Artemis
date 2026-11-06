import { getPlatformContract } from "@artemis/platform";
import { IPC, type TerminalOpenInput } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "terminalService"
  | "settingsStore"
  | "resolveThreadWorkspace"
  | "ensureNodePtyRuntime"
  | "ipcMain"
>;

export function registerTerminalIpc(services: Dependencies): void {
  const { resolveThreadWorkspace, ensureNodePtyRuntime, ipcMain } = services;

  ipcMain.handle(IPC.terminalOpen, async (_event, input: TerminalOpenInput) => {
    if (
      !services.store ||
      !services.terminalService ||
      !services.settingsStore
    ) {
      throw new Error("Terminal service is not ready.");
    }
    const thread = services.store.getThread(input.threadId);
    if (!thread || thread.archived) {
      throw new Error("Active task not found.");
    }
    const [context, shellConfiguration] = await Promise.all([
      resolveThreadWorkspace(thread),
      services.settingsStore.shellRuntimeConfiguration(),
      ensureNodePtyRuntime(),
    ]);
    const contract = getPlatformContract();
    return services.terminalService.open({
      threadId: thread.id,
      workspacePath: context.workspacePath,
      shell: contract.shell,
      windowsPreference: shellConfiguration.windowsPreference,
      cols: input.cols,
      rows: input.rows,
    });
  });
  ipcMain.handle(
    IPC.terminalWrite,
    (_event, terminalId: string, data: string) => {
      services.terminalService?.write(terminalId, data);
    },
  );
  ipcMain.handle(
    IPC.terminalResize,
    (_event, terminalId: string, cols: number, rows: number) => {
      services.terminalService?.resize(terminalId, cols, rows);
    },
  );
  ipcMain.handle(IPC.terminalClose, (_event, terminalId: string) => {
    services.terminalService?.close(terminalId);
  });
}
