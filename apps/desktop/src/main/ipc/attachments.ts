import { uiText } from "../../shared/i18n/ui-text.js";
import { isAttachmentReference } from "@artemis/protocol";

import { dialog } from "electron";
import type { PromptAttachment, PromptImage } from "@artemis/protocol";
import { promptAttachmentsSchema, promptImageSchema } from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "mainWindow"
  | "currentLocale"
  | "attachmentStore"
  | "ipcMain"
  | "store"
  | "attachmentScope"
  | "taskSourceImages"
>;

export function registerAttachmentsIpc(services: Dependencies): void {
  const {
    currentLocale,
    attachmentStore,
    ipcMain,
    attachmentScope,
    taskSourceImages,
  } = services;

  ipcMain.handle(
    IPC.promptAttachmentsSelect,
    async (): Promise<
      import("../../shared/api.js").AttachmentImportResponse | undefined
    > => {
      if (!services.mainWindow) {
        throw new Error("Application window is not ready.");
      }
      const result = await dialog.showOpenDialog(services.mainWindow, {
        title: uiText(currentLocale(), "native.attachFiles"),
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return undefined;
      }
      return attachmentStore().importPaths(result.filePaths);
    },
  );
  ipcMain.handle(
    IPC.promptAttachmentsRead,
    async (_event, paths: unknown): Promise<PromptAttachment[]> => {
      if (
        !Array.isArray(paths) ||
        !paths.every((path) => typeof path === "string")
      ) {
        throw new Error("Dropped attachment paths are invalid.");
      }
      const result = await attachmentStore().importPaths(paths);
      if (result.errors.length) throw new Error(result.errors.join("\n"));
      return result.attachments;
    },
  );
  ipcMain.handle(IPC.promptAttachmentRetry, (_event, id: string) =>
    attachmentStore().retryImport(id),
  );
  ipcMain.handle(IPC.promptAttachmentImport, async (_event, item: unknown) => {
    const [attachment] = promptAttachmentsSchema.parse([item]);
    return attachmentStore().importInline(attachment!);
  });
  const attachmentPreparations = new Map<
    string,
    { controller: AbortController; promise: Promise<unknown> }
  >();
  ipcMain.handle(IPC.promptAttachmentPrepare, async (_event, id: string) => {
    const controller = new AbortController();
    const promise = attachmentStore().prepareDraft(id, controller.signal);
    attachmentPreparations.set(id, { controller, promise });
    try {
      return await promise;
    } finally {
      if (attachmentPreparations.get(id)?.controller === controller)
        attachmentPreparations.delete(id);
    }
  });
  ipcMain.handle(
    IPC.promptFilePreview,
    async (_event, id: string, offset = 0, threadId?: string) => {
      if (threadId !== undefined && !services.store?.getThread(threadId))
        throw new Error("Task was not found.");
      return attachmentStore().previewFile(
        id,
        offset,
        threadId === undefined ? undefined : attachmentScope(threadId),
      );
    },
  );
  ipcMain.handle(
    IPC.promptAttachmentPreview,
    async (_event, id: string, threadId?: string) => {
      if (threadId !== undefined && !services.store?.getThread(threadId))
        throw new Error("Task was not found.");
      return promptImageSchema.parse(
        await attachmentStore().preview(
          id,
          threadId === undefined ? undefined : attachmentScope(threadId),
        ),
      );
    },
  );
  ipcMain.handle(IPC.promptAttachmentCancel, async (_event, id: string) => {
    const preparation = attachmentPreparations.get(id);
    preparation?.controller.abort();
    await preparation?.promise.catch(() => undefined);
    await attachmentStore().discardDraft(id);
  });
  ipcMain.handle(
    IPC.taskSourceImageRead,
    async (
      _event,
      threadId: string,
      sourceId: string,
    ): Promise<PromptImage> => {
      if (!services.store) throw new Error("Application store is not ready.");
      const thread = services.store.getThread(String(threadId ?? ""));
      if (!thread) throw new Error("Task source was not found.");
      const source = services.store
        .getThreadEvents(thread.id)
        .map((event) => event.payload)
        .find(
          (payload) =>
            payload.type === "task.source.added" &&
            payload.kind === "image" &&
            payload.sourceId === sourceId,
        );
      if (
        !source ||
        source.type !== "task.source.added" ||
        source.kind !== "image"
      ) {
        throw new Error("Task source image was not found.");
      }
      if (source.attachment && isAttachmentReference(source.attachment)) {
        const image = await attachmentStore().preview(
          source.attachment.id,
          attachmentScope(thread.id),
        );
        return promptImageSchema.parse({
          name: source.name,
          mimeType: image.mimeType,
          data: image.data,
        });
      }
      let data: string;
      try {
        data = await taskSourceImages().read(thread.id, source.sourceId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(
            "This image preview is unavailable because the source predates local preview storage.",
          );
        }
        throw error;
      }
      return promptImageSchema.parse({
        name: source.name,
        mimeType: source.mimeType,
        data,
      });
    },
  );
}
