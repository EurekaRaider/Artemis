import { shell } from "electron";
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  readWorkspaceImage,
  readWorkspaceTextFile,
  writeWorkspaceFile,
} from "../workspace/workspace-text-file.js";
import {
  IPC,
  type WorkspaceDirectoryEntry,
  type WorkspaceFileContent,
  type WorkspaceFileLink,
  type WorkspaceImageFile,
  type WorkspaceTextFile,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "resolveThreadWorkspace"
  | "ipcMain"
  | "linkedWorkspaceFile"
  | "launchWorkspaceFile"
>;

export function registerWorkspaceFilesIpc(services: Dependencies): void {
  const {
    resolveThreadWorkspace,
    ipcMain,
    linkedWorkspaceFile,
    launchWorkspaceFile,
  } = services;

  ipcMain.handle(
    IPC.workspaceTextFileRead,
    async (
      _event,
      threadId: string,
      path: string,
    ): Promise<WorkspaceTextFile> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return readWorkspaceTextFile(context.workspacePath, String(path ?? ""));
    },
  );
  ipcMain.handle(
    IPC.workspaceImageRead,
    async (
      _event,
      threadId: string,
      markdownPath: string,
      href: string,
    ): Promise<WorkspaceImageFile> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return readWorkspaceImage(
        context.workspacePath,
        String(markdownPath ?? ""),
        String(href ?? ""),
      );
    },
  );
  ipcMain.handle(
    IPC.workspaceDirectoryList,
    async (
      _event,
      threadId: string,
      path: string,
    ): Promise<WorkspaceDirectoryEntry[]> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return listWorkspaceDirectory(context.workspacePath, String(path ?? ""));
    },
  );
  ipcMain.handle(
    IPC.workspaceFileRead,
    async (
      _event,
      threadId: string,
      path: string,
    ): Promise<WorkspaceFileContent> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }
      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return readWorkspaceFile(context.workspacePath, String(path ?? ""));
    },
  );
  ipcMain.handle(
    IPC.workspaceFileWrite,
    async (
      _event,
      threadId: string,
      path: string,
      content: string,
    ): Promise<WorkspaceFileContent> => {
      if (!services.store) {
        throw new Error("Application store is not ready.");
      }

      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread || thread.archived) {
        throw new Error("Active task not found.");
      }
      const context = await resolveThreadWorkspace(thread);
      return writeWorkspaceFile(
        context.workspacePath,
        String(path ?? ""),
        String(content ?? ""),
      );
    },
  );
  ipcMain.handle(
    IPC.workspaceFileLinkInspect,
    async (
      _event,
      threadId: string,
      href: string,
    ): Promise<WorkspaceFileLink> => {
      const { absolutePath: _absolutePath, ...file } =
        await linkedWorkspaceFile(threadId, href);
      return file;
    },
  );
  ipcMain.handle(
    IPC.workspaceFileReveal,
    async (_event, threadId: string, path: string): Promise<void> => {
      const file = await linkedWorkspaceFile(threadId, path);
      shell.showItemInFolder(file.absolutePath);
    },
  );
  ipcMain.handle(
    IPC.workspaceFileRun,
    async (_event, threadId: string, path: string): Promise<void> => {
      await launchWorkspaceFile(await linkedWorkspaceFile(threadId, path));
    },
  );
}
