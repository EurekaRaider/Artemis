import type { AppLocale } from "@artemis/protocol";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
} from "electron";

/** Optional embedding hooks. The shipped bootstrap uses the default host.
 * Verification entrypoints configure their own host before starting services;
 * production modules never load verification code or select it from the env.
 */
export interface ApplicationHost {
  locale?: AppLocale;
  userName?: string;
  notificationsEnabled?: boolean;
  resumeGoals?: boolean;
  resumeInterruptedTurns?: boolean;
  showStartupErrors?: boolean;
  windowOptions?(): Pick<
    BrowserWindowConstructorOptions,
    "width" | "height" | "show" | "enableLargerThanScreen"
  > & { backgroundThrottling?: boolean };
  windowCreated?(window: BrowserWindow): void;
  configureSettings?(): Promise<void>;
  workspaceReady?(): Promise<void>;
  resourcesReady?(): Promise<void>;
  beforeWindowCreated?(): Promise<void>;
  decorateIpc?(
    channel: string,
    handler: Parameters<IpcMain["handle"]>[1],
  ): Parameters<IpcMain["handle"]>[1];
}

export let applicationHost: ApplicationHost = {};

export function configureApplicationHost(host: ApplicationHost): void {
  applicationHost = host;
}
