import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("artemis", {
  onProjectGitChanged: () => () => {},
  registerComputerBrowser: (threadId: string, contentsId: number) =>
    ipcRenderer.invoke("fixture-register", threadId, contentsId),
  browserPreview: (threadId: string, contentsId: number, command: unknown) =>
    ipcRenderer.invoke("fixture-preview", threadId, contentsId, command),
});
