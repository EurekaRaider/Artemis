import { ipcRenderer, webUtils } from "electron";

import { readPromptAttachmentsFromFiles } from "../prompt-attachments.js";

import { IPC } from "../../shared/ipc-channels.js";
import type { AttachmentsApi } from "../../shared/api/attachments.js";
export const attachmentsBridge: AttachmentsApi = {
  onAttachmentImportProgress(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.attachmentImportProgress, handler);
    return () =>
      ipcRenderer.removeListener(IPC.attachmentImportProgress, handler);
  },
  retryPromptAttachment: (id) =>
    ipcRenderer.invoke(IPC.promptAttachmentRetry, id),
  preparePromptAttachment: (id) =>
    ipcRenderer.invoke(IPC.promptAttachmentPrepare, id),
  selectPromptAttachments: () =>
    ipcRenderer.invoke(IPC.promptAttachmentsSelect),
  previewPromptFile: (id, offset, threadId) =>
    ipcRenderer.invoke(IPC.promptFilePreview, id, offset, threadId),
  previewPromptAttachment: (id, threadId) =>
    ipcRenderer.invoke(IPC.promptAttachmentPreview, id, threadId),
  cancelPromptAttachment: (id) =>
    ipcRenderer.invoke(IPC.promptAttachmentCancel, id),
  readPromptAttachments: async (files) => {
    const accepted: File[] = [],
      errors: string[] = [];
    let bytes = 0,
      images = 0,
      documents = 0;
    for (const file of files) {
      if (webUtils.getPathForFile(file)) {
        accepted.push(file);
        continue;
      }
      const image = file.type.startsWith("image/");
      if (
        bytes + file.size > 200 * 1024 * 1024 ||
        file.size > (image ? 10 : 100) * 1024 * 1024 ||
        (image ? images >= 20 : documents >= 10)
      ) {
        errors.push(`Attachment exceeds the message limits: ${file.name}`);
        continue;
      }
      accepted.push(file);
      bytes += file.size;
      if (image) images++;
      else documents++;
    }
    const results = await Promise.allSettled(
      accepted.map((file) =>
        readPromptAttachmentsFromFiles(
          [file],
          (file) => webUtils.getPathForFile(file),
          (paths) => ipcRenderer.invoke(IPC.promptAttachmentsRead, paths),
          (item) => ipcRenderer.invoke(IPC.promptAttachmentImport, item),
        ),
      ),
    );
    return {
      attachments: results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      ),
      errors: [
        ...errors,
        ...results.flatMap((result) =>
          result.status === "rejected" ? [String(result.reason)] : [],
        ),
      ],
    };
  },
  readTaskSourceImage: (threadId, sourceId) =>
    ipcRenderer.invoke(IPC.taskSourceImageRead, threadId, sourceId),
};
