import {
  browserPreviewCommandSchema,
  browserSessionCommandSchema,
  computerPreviewCommandSchema,
} from "@artemis/protocol";
import { type WebContents } from "electron";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "mainWindow"
  | "store"
  | "browserSessionHost"
  | "ipcMain"
  | "computerPreviewHost"
  | "computerUseHost"
>;

export function registerComputerIpc(services: Dependencies): void {
  const { ipcMain } = services;

  const assertComputerSender = (sender: Electron.WebContents) => {
    if (sender.id !== services.mainWindow?.webContents.id)
      throw new Error("Computer Use requires the Artemis window.");
  };
  ipcMain.handle(IPC.browserSession, async (event, input: unknown) => {
    assertComputerSender(event.sender);
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error("Browser requires the trusted main frame");
    const command = browserSessionCommandSchema.parse(input);
    const thread = services.store?.getThread(command.threadId);
    if (!thread || thread.archived || !services.browserSessionHost)
      throw new Error("Invalid browser task");
    return services.browserSessionHost.command(command, event.sender);
  });
  ipcMain.handle(IPC.computerPreviews, (event) => {
    assertComputerSender(event.sender);
    return services.computerPreviewHost?.states() ?? [];
  });
  ipcMain.handle(IPC.computerPreview, (event, input: unknown) => {
    assertComputerSender(event.sender);
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error("Preview requires the trusted main frame");
    services.computerPreviewHost?.command(
      computerPreviewCommandSchema.parse(input),
      event.sender,
    );
  });
  ipcMain.on(
    IPC.computerPreviewMedia,
    (event, token: unknown, message: unknown) => {
      if (
        event.senderFrame === event.sender.mainFrame &&
        typeof token === "string" &&
        typeof message === "string" &&
        message.length <= 1000
      )
        services.browserSessionHost?.previewFailed(
          event.sender,
          token,
          message,
        );
    },
  );
  ipcMain.on(
    IPC.computerPreviewReport,
    (
      event,
      token: string,
      report: { fps: number; p95Ms: number; sequence: number },
    ) => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        !report ||
        typeof report !== "object"
      )
        return;
      services.computerPreviewHost?.report(event.sender, token, report);
    },
  );
  ipcMain.handle(
    IPC.computerRegisterBrowser,
    (event, threadId: string, contentsId: number) => {
      assertComputerSender(event.sender);
      if (
        !services.store?.getThread(threadId) ||
        !Number.isSafeInteger(contentsId)
      )
        throw new Error("Invalid browser task.");
      services.computerUseHost?.registerBrowser(
        event.sender,
        threadId,
        contentsId,
      );
    },
  );
  ipcMain.handle(
    IPC.browserPreview,
    async (event, threadId: string, contentsId: number, input: unknown) => {
      assertComputerSender(event.sender);
      if (
        !services.store?.getThread(threadId) ||
        services.store.getThread(threadId)?.archived ||
        !Number.isSafeInteger(contentsId) ||
        !services.computerUseHost
      )
        throw new Error("Invalid browser task.");
      const command = browserPreviewCommandSchema.parse(input);
      services.computerUseHost.registerBrowser(
        event.sender,
        threadId,
        contentsId,
      );
      return services.computerUseHost.preview(threadId, contentsId, command);
    },
  );
  ipcMain.handle(IPC.computerState, (event) => {
    assertComputerSender(event.sender);
    return (
      services.computerUseHost?.service.status() ?? {
        version: 1,
        state: "idle",
      }
    );
  });
  ipcMain.handle(
    IPC.computerControl,
    (event, action: string, threadId: string) => {
      assertComputerSender(event.sender);
      if (action === "stop")
        services.computerUseHost?.service.stopThread(
          threadId,
          "User paused control",
        );
      else if (action === "resume")
        services.computerUseHost?.service.resumeThread(threadId);
      else if (action === "revoke-task")
        services.computerUseHost?.clearTask(
          threadId,
          "Task left Work or Codemode mode",
        );
      else throw new Error("Invalid control action.");
    },
  );
  ipcMain.handle(IPC.computerPermissions, async (event) => {
    assertComputerSender(event.sender);
    return ((await services.computerUseHost?.permissions()) ?? []).map(
      (permission) => ({
        ...permission,
        ...(permission.threadId
          ? {
              threadTitle: services.store?.getThread(permission.threadId)
                ?.title,
            }
          : {}),
      }),
    );
  });
  ipcMain.handle(IPC.computerRevokePermission, (event, id: string) => {
    assertComputerSender(event.sender);
    return services.computerUseHost?.revoke(id);
  });
}
