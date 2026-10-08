import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../../src/shared/api.js";
import {
  bindPreviewCanvas,
  unbindPreviewCanvas,
} from "../../src/preload/preview-textures.js";
contextBridge.exposeInMainWorld("artemis", {
  onProjectGitChanged: () => () => {},
  registerComputerBrowser: (threadId: string, contentsId: number) =>
    ipcRenderer.invoke("fixture-register", threadId, contentsId),
  browserPreview: (threadId: string, contentsId: number, command: unknown) =>
    ipcRenderer.invoke("fixture-preview", threadId, contentsId, command),
  browserSession: (command: unknown) =>
    ipcRenderer.invoke(IPC.browserSession, command),
  onBrowserSession: (listener: (snapshot: unknown) => void) => {
    const receive = (_event: unknown, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on(IPC.browserSession, receive);
    return () => ipcRenderer.removeListener(IPC.browserSession, receive);
  },
  bindPreviewCanvas,
  unbindPreviewCanvas,
});
