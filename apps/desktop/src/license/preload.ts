import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("license", {
  onStatus: (listener: (status: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: unknown) =>
      listener(status);
    ipcRenderer.on("license:changed", handler);
    return () => ipcRenderer.removeListener("license:changed", handler);
  },
  status: () => ipcRenderer.invoke("license:status"),
  activate: (token: string) => ipcRenderer.invoke("license:activate", token),
  copyDevice: () => ipcRenderer.invoke("license:copy-device"),
  importFile: () => ipcRenderer.invoke("license:import"),
  recovery: () => ipcRenderer.invoke("license:recovery-request"),
  recover: (token: string) => ipcRenderer.invoke("license:recover", token),
  quit: () => ipcRenderer.invoke("license:quit"),
});
