import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { TaskNotificationsApi } from "../../shared/api/task-notifications.js";
export const taskNotificationsBridge: TaskNotificationsApi = {
  reportTaskView: (input) => ipcRenderer.send(IPC.taskView, input),
  onThreadTitleUpdated(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      thread: Pick<import("@artemis/protocol").Thread, "id" | "title">,
    ) => listener(thread);
    ipcRenderer.on(IPC.threadTitleUpdated, handler);
    return () => ipcRenderer.removeListener(IPC.threadTitleUpdated, handler);
  },
  onImTaskCreated(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      thread: import("@artemis/protocol").Thread,
    ) => listener(thread);
    ipcRenderer.on(IPC.imTaskCreated, handler);
    return () => ipcRenderer.removeListener(IPC.imTaskCreated, handler);
  },
};
