import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { listPromptTemplates } from "@artemis/agent-host/prompt-templates";
import { IPC } from "../../shared/ipc-channels.js";
import type { ApplicationServices } from "../application/application-services.js";
export function registerPromptTemplatesIpc(
  services: Pick<
    ApplicationServices,
    "ipcMain" | "mainWindow" | "store" | "resolveThreadWorkspace"
  >,
): void {
  services.ipcMain.handle(
    IPC.promptTemplatesList,
    async (event, projectId?: string, threadId?: string) => {
      if (
        event.sender.id !== services.mainWindow?.webContents.id ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw new Error("Prompt templates require the Artemis main window.");
      let cwd: string | undefined;
      if (threadId !== undefined) {
        if (typeof threadId !== "string")
          throw new Error("Invalid task identity.");
        const thread = services.store?.getThread(threadId);
        if (!thread || thread.projectId !== projectId)
          throw new Error("Task does not belong to this project.");
        cwd = (await services.resolveThreadWorkspace(thread)).workspacePath;
      } else if (projectId !== undefined) {
        if (typeof projectId !== "string")
          throw new Error("Invalid project identity.");
        cwd = services.store?.getProject(projectId)?.path;
        if (!cwd) throw new Error("Project not found.");
      }
      return (await listPromptTemplates(getAgentDir(), cwd)).map(
        ({ content: _content, ...info }) => info,
      );
    },
  );
}
