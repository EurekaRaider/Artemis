import { ipcRenderer } from "electron";

import { IPC } from "../../shared/ipc-channels.js";
import type { DesignApi } from "../../shared/api/design.js";
export const designBridge: DesignApi = {
  designCapabilityStatus: () => ipcRenderer.invoke(IPC.designCapabilityStatus),
  designCapabilityAvailability: () =>
    ipcRenderer.invoke(IPC.designCapabilityAvailability),
  onDesignCapabilityAvailability: (listener) => {
    const handler = (
      _event: unknown,
      payload: Parameters<typeof listener>[0],
    ) => listener(payload);
    ipcRenderer.on(IPC.designCapabilityAvailability, handler as never);
    return () => {
      ipcRenderer.removeListener(
        IPC.designCapabilityAvailability,
        handler as never,
      );
    };
  },
  checkDesignCapabilityUpdates: () =>
    ipcRenderer.invoke(IPC.designCapabilityCheckUpdates),
  installDesignCapability: () =>
    ipcRenderer.invoke(IPC.designCapabilityInstall),
  importDesignCapability: (input) =>
    ipcRenderer.invoke(IPC.designCapabilityImport, input),
  cancelDesignCapability: () => ipcRenderer.invoke(IPC.designCapabilityCancel),
  activateDesignCapability: (version) =>
    ipcRenderer.invoke(IPC.designCapabilityActivate, version),
  deactivateDesignCapability: () =>
    ipcRenderer.invoke(IPC.designCapabilityDeactivate),
  uninstallDesignCapability: (version) =>
    ipcRenderer.invoke(IPC.designCapabilityUninstall, version),
};
