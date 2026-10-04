import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ReleaseUpdateManager,
  type UpdaterAdapter,
  type ReleaseUpdateStatus,
  type UpdateFeedEnvironment,
} from "./release-update-manager.js";
import { UpdateRecoveryStore } from "./update-recovery-store.js";
import { WindowsInstalledUpdater } from "./windows-installed-updater.js";
export interface DesktopUpdateOptions {
  updater: UpdaterAdapter;
  version: string;
  packaged: boolean;
  platform: NodeJS.Platform;
  userData: string;
  home: string;
  resources: string;
  executable: string;
  application: string;
  rollbackScript: string;
  environment: UpdateFeedEnvironment;
  onStatus(status: ReleaseUpdateStatus): void;
  prepareToQuit(): Promise<void>;
  cancelPreparation(): void;
  quit(): void;
}
/** Owns platform selection and update storage. Main supplies lifecycle callbacks. */
export async function createDesktopUpdateService(
  options: DesktopUpdateOptions,
): Promise<ReleaseUpdateManager> {
  const root = join(options.userData, "update-recovery");
  let installed: WindowsInstalledUpdater | undefined;
  if (options.packaged && options.platform === "win32") {
    let marker: { distribution?: string; arch?: string } | undefined;
    try {
      marker = JSON.parse(
        await readFile(join(options.resources, "distribution.json"), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (marker?.distribution === "nsis" && marker.arch === "x64") {
      installed = new WindowsInstalledUpdater({
        currentVersion: options.version,
        userData: options.userData,
        executable: options.executable,
        helperPath: join(
          options.resources,
          "resources/windows-install-recover.ps1",
        ),
        keys: JSON.parse(
          await readFile(
            join(options.resources, "resources/update-public-keys.json"),
            "utf8",
          ),
        ),
        onStatus: options.onStatus,
        prepareToQuit: options.prepareToQuit,
        cancelPreparation: options.cancelPreparation,
        quit: options.quit,
      });
    }
  }
  return new ReleaseUpdateManager(
    options.updater,
    new UpdateRecoveryStore(
      join(root, "state.json"),
      join(root, "artifacts"),
      options.platform === "darwin"
        ? join(options.home, "Library", "Caches", "@artemisdesktop-updater")
        : undefined,
    ),
    options.version,
    options.packaged,
    options.platform,
    options.rollbackScript,
    options.application,
    options.environment,
    options.onStatus,
    join(options.resources, "app-update.yml"),
    undefined,
    installed,
  );
}
