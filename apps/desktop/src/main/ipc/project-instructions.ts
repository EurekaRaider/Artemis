import { ProjectInstructions } from "../workspace/project-instructions.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  "store" | "mainWindow" | "ipcMain"
>;

export function registerProjectInstructionsIpc(services: Dependencies): void {
  const { ipcMain } = services;

  const projectInstructions = new ProjectInstructions((id) =>
    services.store?.getProject(id),
  );
  const assertInstructionsSender = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender.id !== services.mainWindow?.webContents.id ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Project instructions require the Artemis main window.");
  };
  ipcMain.handle(IPC.projectInstructionsRead, (event, ...args: unknown[]) => {
    assertInstructionsSender(event);
    if (args.length !== 1) throw new Error("Expected a project identity only.");
    return projectInstructions.read(args[0]);
  });
  ipcMain.handle(IPC.projectInstructionsWrite, (event, ...args: unknown[]) => {
    assertInstructionsSender(event);
    if (args.length !== 2)
      throw new Error("Expected a project identity and content only.");
    return projectInstructions.write(args[0], args[1]);
  });
}
