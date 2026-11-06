import { isExecutionMode } from "@artemis/protocol";
import { readFile, stat } from "node:fs/promises";
import { dialog } from "electron";
import { writeWorkspaceFile } from "../workspace/workspace-text-file.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "store"
  | "resolveThreadWorkspace"
  | "getOfficeWorkbench"
  | "ipcMain"
  | "installOfficeSuite"
  | "applyAgentRuntime"
>;

export function registerOfficeIpc(services: Dependencies): void {
  const {
    resolveThreadWorkspace,
    getOfficeWorkbench,
    ipcMain,
    installOfficeSuite,
    applyAgentRuntime,
  } = services;

  ipcMain.handle(
    IPC.officeOpen,
    async (_event, threadId: string, path: string) => {
      const thread = services.store?.getThread(threadId);
      if (!thread || thread.archived) throw new Error("Active task not found");
      // Opening starts an engine and writes a working copy, even for preview.
      if (!isExecutionMode(thread.mode))
        throw new Error(`${thread.mode} mode rejects Office sessions`);
      const context = await resolveThreadWorkspace(thread);
      const workbench = await getOfficeWorkbench();
      const current = services.store?.getThread(threadId);
      if (!current || current.archived)
        throw new Error("Active task not found");
      return workbench.sessions.openFile(String(path ?? ""), {
        workspacePath: context.workspacePath,
        threadId,
        mode: current.mode,
      });
    },
  );
  ipcMain.handle(
    IPC.officeSnapshot,
    async (_event, threadId: string, sessionId: string) => {
      if (
        !services.store?.getThread(threadId) ||
        services.store.getThread(threadId)?.archived
      )
        throw new Error("Active task not found");
      return (await getOfficeWorkbench()).sessions.snapshotForUi(
        sessionId,
        threadId,
      );
    },
  );
  ipcMain.handle(
    IPC.officeEdit,
    async (
      _event,
      threadId: string,
      request: import("@artemis/protocol").ArtifactSessionRequest,
    ) => {
      const thread = services.store?.getThread(threadId);
      if (!thread || thread.archived) throw new Error("Active task not found");
      if (!isExecutionMode(thread.mode))
        throw new Error(`${thread.mode} mode rejects Office sessions`);
      const context = await resolveThreadWorkspace(thread);
      const workbench = await getOfficeWorkbench();
      const current = services.store?.getThread(threadId);
      if (!current || current.archived)
        throw new Error("Active task not found");
      return workbench.sessions.executeFromUi(request, {
        threadId,
        workspacePath: context.workspacePath,
        mode: current.mode,
      });
    },
  );
  ipcMain.handle(
    IPC.workspaceCsvSave,
    async (
      _event,
      threadId: string,
      path: string,
      content: string,
      expectedContent: string,
    ) => {
      const thread = services.store?.getThread(threadId);
      if (!thread || thread.archived) throw new Error("Active task not found");
      if (!isExecutionMode(thread.mode))
        throw new Error(`${thread.mode} mode rejects CSV edits`);
      if (
        typeof path !== "string" ||
        !/\.csv$/iu.test(path) ||
        typeof content !== "string" ||
        typeof expectedContent !== "string"
      )
        throw new Error("Invalid CSV save request");
      const context = await resolveThreadWorkspace(thread);
      const current = services.store?.getThread(threadId);
      if (!current || current.archived || !isExecutionMode(current.mode))
        throw new Error("CSV editing is no longer allowed");
      return writeWorkspaceFile(
        context.workspacePath,
        path,
        content,
        expectedContent,
      );
    },
  );
  ipcMain.handle(
    IPC.officePreview,
    async (_event, threadId: string, sessionId: string, assetId: string) => {
      if (
        !services.store?.getThread(threadId) ||
        services.store.getThread(threadId)?.archived
      )
        throw new Error("Active task not found");
      const sessions = (await getOfficeWorkbench()).sessions;
      const path = await sessions.previewPath(sessionId, threadId, assetId);
      if ((await stat(path)).size > 64 * 1024 * 1024)
        throw new Error("Office preview exceeds size limit");
      const snapshot = await sessions.snapshotForUi(sessionId, threadId);
      if (snapshot.preview?.assetId !== assetId)
        throw new Error("Office preview changed; refresh the snapshot");
      return {
        data: (await readFile(path)).toString("base64"),
        version: snapshot.preview.version,
      };
    },
  );
  ipcMain.handle(IPC.officeCapabilityStatus, async () => {
    return (await getOfficeWorkbench()).status();
  });
  ipcMain.handle(IPC.officeCapabilityCheckUpdates, async () => {
    await (await getOfficeWorkbench()).updates.check();
  });
  ipcMain.handle(IPC.officeCapabilityInstall, installOfficeSuite);
  ipcMain.handle(IPC.officeCapabilityImport, async () => {
    const selected = await dialog.showOpenDialog({
      title: "Import Office offline pack",
      properties: ["openFile"],
      filters: [
        { name: "Office offline pack", extensions: ["artemis-office"] },
      ],
    });
    if (selected.canceled || !selected.filePaths[0]) return;
    await (
      await getOfficeWorkbench()
    ).packs.installOffline(selected.filePaths[0]);
    await applyAgentRuntime();
  });
  ipcMain.handle(IPC.officeCapabilityCancel, async () =>
    (await getOfficeWorkbench()).packs.cancel(),
  );
  ipcMain.handle(
    IPC.officeCapabilityActivate,
    async (_event, version: string) => {
      await (await getOfficeWorkbench()).packs.activate(version);
      await applyAgentRuntime();
    },
  );
  ipcMain.handle(IPC.officeCapabilityDeactivate, async () => {
    await (await getOfficeWorkbench()).packs.deactivate();
    await applyAgentRuntime();
  });
  ipcMain.handle(
    IPC.officeCapabilityUninstall,
    async (_event, version?: string) => {
      await (await getOfficeWorkbench()).packs.uninstall(version);
      await applyAgentRuntime();
    },
  );
}
