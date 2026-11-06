import type { IpcMain } from "electron";
import { applicationHost } from "./application-host.js";

/** Keep registration on the actual Electron instance while allowing an
 * embedding entrypoint to decorate request handling before registration. */
export function applicationIpc(ipc: IpcMain): IpcMain {
  return new Proxy(ipc, {
    get(target, property) {
      if (property === "handle") {
        return (channel: string, handler: Parameters<IpcMain["handle"]>[1]) =>
          target.handle(
            channel,
            applicationHost.decorateIpc?.(channel, handler) ?? handler,
          );
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
