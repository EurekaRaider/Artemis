import { createHash } from "node:crypto";
import { AttachmentStore } from "../conversation/attachment-store.js";
import { join } from "node:path";
import { app } from "electron";
import { TaskSourceImageStore } from "../conversation/task-source-images.js";
import { MemoryStore } from "../memory/memory-store.js";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "attachmentStoreInstance"
  | "mainWindow"
  | "imService"
  | "taskSourceImageStore"
  | "memoryStores"
>;
export function createAttachmentRuntime(services: Dependencies) {
  const { memoryStores } = services;
  function attachmentStore(): AttachmentStore {
    return (services.attachmentStoreInstance ??= new AttachmentStore(
      join(app.getPath("userData"), "attachments"),
      (progress) =>
        services.mainWindow?.webContents.send(
          IPC.attachmentImportProgress,
          progress,
        ),
    ));
  }

  function attachmentScope(threadId: string): string {
    const profile = services.imService?.profile(threadId);
    return profile
      ? `${threadId}_${createHash("sha256")
          .update(JSON.stringify(profile.security ?? profile))
          .digest("hex")}`
      : threadId;
  }

  function taskSourceImages(): TaskSourceImageStore {
    services.taskSourceImageStore ??= new TaskSourceImageStore(
      join(app.getPath("userData"), "task-source-images"),
    );
    return services.taskSourceImageStore;
  }

  function memoryStore(path: string, maxBytes: number): MemoryStore {
    let existing = memoryStores.get(path);
    if (!existing) {
      existing = new MemoryStore(path, { maxBytes });
      memoryStores.set(path, existing);
    }
    return existing;
  }
  return { attachmentStore, attachmentScope, taskSourceImages, memoryStore };
}
