import { ipcRenderer } from "electron";
import type {
  AgentEvent,
  AgentHostEvent,
  AutomationEvent,
} from "@artemis/protocol";

import { IPC } from "../../shared/ipc-channels.js";
import type { EventsApi } from "../../shared/api/events.js";
export const eventsBridge: EventsApi = {
  onMcpServerStatus(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.mcpServerStatus, handler);
    return () => ipcRenderer.removeListener(IPC.mcpServerStatus, handler);
  },
  onResourceInstallProgress(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.resourceInstallProgress, handler);
    return () =>
      ipcRenderer.removeListener(IPC.resourceInstallProgress, handler);
  },
  onUpdateStatus(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: Parameters<typeof listener>[0],
    ) => listener(value);
    ipcRenderer.on(IPC.updateStatus, handler);
    return () => ipcRenderer.removeListener(IPC.updateStatus, handler);
  },
  onAgentEvent(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: AgentEvent) => {
      listener(value);
    };
    ipcRenderer.on(IPC.agentEvent, handler);
    return () => ipcRenderer.removeListener(IPC.agentEvent, handler);
  },
  onAgentEvents(listener) {
    const handler = (_event: Electron.IpcRendererEvent, value: AgentEvent[]) =>
      listener(value);
    ipcRenderer.on(IPC.agentEvents, handler);
    return () => ipcRenderer.removeListener(IPC.agentEvents, handler);
  },
  onAgentActivities(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: AgentHostEvent[],
    ) => listener(value);
    ipcRenderer.on(IPC.agentActivities, handler);
    return () => ipcRenderer.removeListener(IPC.agentActivities, handler);
  },
  onAutomationEvent(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: AutomationEvent,
    ) => listener(value);
    ipcRenderer.on(IPC.automationEvent, handler);
    return () => ipcRenderer.removeListener(IPC.automationEvent, handler);
  },
  onAutomationThreadOpen(listener) {
    const handler = (_event: Electron.IpcRendererEvent, threadId: string) =>
      listener(threadId);
    ipcRenderer.on(IPC.automationThreadOpen, handler);
    return () => ipcRenderer.removeListener(IPC.automationThreadOpen, handler);
  },
  onProjectGitChanged(listener) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      context: Parameters<typeof listener>[0],
    ) => listener(context);
    ipcRenderer.on(IPC.projectGitChanged, handler);
    return () => ipcRenderer.removeListener(IPC.projectGitChanged, handler);
  },
};
