import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("issuer", {
  action: (name: string, input?: unknown) =>
    ipcRenderer.invoke("issuer:action", name, input),
});
