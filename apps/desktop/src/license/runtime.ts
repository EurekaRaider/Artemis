import { ipcMain } from "electron";
import type { LicenseService } from "./service.js";

let service: LicenseService | undefined;
let locked = false;
let onInvalid: () => void = () => {};
let shutdown: () => Promise<void> = async () => {};
export function setLicenseShutdown(callback: () => Promise<void>): void {
  shutdown = callback;
}
export function stopLicensedRuntime(): Promise<void> {
  locked = true;
  return shutdown();
}
export function setLicenseService(
  value: LicenseService,
  invalidate: () => void,
): void {
  service = value;
  onInvalid = invalidate;
}
export function assertLicense(): void {
  if (locked || !service) throw new Error("LICENSE_REQUIRED");
  try {
    service.assertValid();
  } catch (error) {
    locked = true;
    onInvalid();
    throw error;
  }
}
export function canRunLicensed(): boolean {
  try {
    assertLicense();
    return true;
  } catch {
    return false;
  }
}
export function suppressLicenseResume(): boolean {
  return service?.suppressResume ?? true;
}

// Every business invocation goes through this adapter. The independent license
// window uses its own narrow, sender-checked IPC before business code is loaded.
export const licensedIpc: Pick<typeof ipcMain, "handle" | "on" | "once"> = {
  handle(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
      assertLicense();
      return listener(event, ...args);
    });
  },
  on(channel, listener) {
    return ipcMain.on(channel, (event, ...args) => {
      if (canRunLicensed()) listener(event, ...args);
    });
  },
  once(channel, listener) {
    return ipcMain.once(channel, (event, ...args) => {
      if (canRunLicensed()) listener(event, ...args);
    });
  },
};
