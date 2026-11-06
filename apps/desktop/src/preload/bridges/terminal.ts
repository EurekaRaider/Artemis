import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { TerminalApi } from "../../shared/api/terminal.js";
export const terminalBridge: TerminalApi = {
  openTerminal: (input) => ipcRenderer.invoke(IPC.terminalOpen, input),
  writeTerminal: (terminalId, data) =>
    ipcRenderer.invoke(IPC.terminalWrite, terminalId, data),
  resizeTerminal: (terminalId, cols, rows) =>
    ipcRenderer.invoke(IPC.terminalResize, terminalId, cols, rows),
  closeTerminal: (terminalId) =>
    ipcRenderer.invoke(IPC.terminalClose, terminalId),
  onTerminalData(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.terminalData, handler);
    return () => ipcRenderer.removeListener(IPC.terminalData, handler);
  },
  onTerminalExit(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.terminalExit, handler);
    return () => ipcRenderer.removeListener(IPC.terminalExit, handler);
  },
};
