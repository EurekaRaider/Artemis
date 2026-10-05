import type { WindowsInstalledUpdater } from "./windows-installed-updater.js";
import { checkWindowsRelease } from "./windows-release-check.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import type { UpdateRecoveryStore } from "./update-recovery-store.js";

interface UpdateInfo {
  version: string;
  downloadedFile?: string;
}

interface ProgressInfo {
  percent: number;
  transferred: number;
  total: number;
}

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  setFeedURL(options: any): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface ReleaseUpdateStatus {
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  currentVersion: string;
  upToDate?: boolean;
  availableVersion?: string;
  manualDownloadUrl?: string;
  manualUpdate?: boolean;
  completedVersion?: string;
  progress?: number;
  rollbackAvailable: boolean;
  message?: string;
}

export interface UpdateFeedEnvironment {
  ARTEMIS_UPDATE_URL?: string;
  ARTEMIS_UPDATE_OWNER?: string;
  ARTEMIS_UPDATE_REPO?: string;
  ARTEMIS_UPDATE_CHANNEL?: string;
}

type UpdateStatusPatch = {
  [Key in keyof ReleaseUpdateStatus]?: ReleaseUpdateStatus[Key] | undefined;
};

function resolveFeed(
  environment: UpdateFeedEnvironment,
): Record<string, unknown> | undefined {
  if (environment.ARTEMIS_UPDATE_URL) {
    const url = new URL(environment.ARTEMIS_UPDATE_URL);
    if (url.protocol !== "https:") {
      throw new Error("Update feed must use HTTPS");
    }
    return {
      provider: "generic",
      url: url.href,
      channel: environment.ARTEMIS_UPDATE_CHANNEL ?? "latest",
    };
  }
  const owner = environment.ARTEMIS_UPDATE_OWNER?.trim();
  const repo = environment.ARTEMIS_UPDATE_REPO?.trim();
  if (!owner && !repo) return undefined;
  if (
    !owner ||
    !repo ||
    !/^[A-Za-z0-9_.-]+$/u.test(owner) ||
    !/^[A-Za-z0-9_.-]+$/u.test(repo)
  ) {
    throw new Error("GitHub update owner/repository is invalid");
  }
  return {
    provider: "github",
    owner,
    repo,
    channel: environment.ARTEMIS_UPDATE_CHANNEL ?? "latest",
  };
}

export class ReleaseUpdateManager {
  private status: ReleaseUpdateStatus;
  private downloadedVersion: string | undefined;
  private initialized = false;
  private installedVersion: string | undefined;
  private initialCheckTimer: ReturnType<typeof setTimeout> | undefined;
  private periodicCheckTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly updater: UpdaterAdapter,
    private readonly recovery: UpdateRecoveryStore,
    private readonly currentVersion: string,
    private readonly isPackaged: boolean,
    private readonly platform: NodeJS.Platform,
    private readonly rollbackScriptPath: string,
    private readonly applicationPath: string,
    private readonly environment: UpdateFeedEnvironment,
    private readonly onStatus: (status: ReleaseUpdateStatus) => void,
    private readonly packagedUpdateConfigPath?: string,
    private readonly checkWindows = checkWindowsRelease,
    private readonly windowsInstalled?: WindowsInstalledUpdater,
  ) {
    this.status = {
      state: "disabled",
      currentVersion,
      rollbackAvailable: false,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (this.platform === "win32") {
      if (this.windowsInstalled) {
        await this.windowsInstalled.initialize();
        this.status = this.windowsInstalled.getStatus();
        return;
      }
      this.update({
        state: this.isPackaged ? "idle" : "disabled",
        manualUpdate: true,
      });
      return;
    }
    const startup = await this.recovery.beginStartup(this.currentVersion);
    if (startup) this.installedVersion = this.currentVersion;
    if (startup?.pending.previousArtifact) {
      this.launchRollbackWatchdog(
        startup.healthMarkerPath,
        startup.pending.previousArtifact,
      );
    }
    const feed = this.isPackaged ? resolveFeed(this.environment) : undefined;
    const hasPackagedFeed =
      this.isPackaged &&
      this.packagedUpdateConfigPath !== undefined &&
      existsSync(this.packagedUpdateConfigPath);
    if (!feed && !hasPackagedFeed) {
      this.update({
        state: "disabled",
        message: this.isPackaged
          ? "No signed update feed is configured."
          : "Updates are disabled in development builds.",
      });
      return;
    }

    this.updater.autoDownload = false;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    // Without an override, electron-updater reads the signed bundle's app-update.yml.
    if (feed) this.updater.setFeedURL(feed);
    this.updater.on("checking-for-update", () => {
      this.update({
        state: "checking",
        progress: undefined,
        message: undefined,
      });
    });
    this.updater.on("update-available", (info: UpdateInfo) => {
      this.update({
        state: "available",
        availableVersion: info.version,
        progress: 0,
        message: undefined,
      });
    });
    this.updater.on("update-not-available", () => {
      this.update({
        state: "idle",
        upToDate: true,
        availableVersion: undefined,
        progress: undefined,
        message: undefined,
      });
    });
    this.updater.on("download-progress", (progress: ProgressInfo) => {
      this.update({
        state: "downloading",
        progress: Math.max(0, Math.min(100, progress.percent)),
      });
    });
    this.updater.on("update-downloaded", (info: UpdateInfo) => {
      void this.handleDownloaded(info).catch((error: unknown) => {
        this.update({
          state: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    });
    this.updater.on("error", (error: Error) => {
      this.update({
        state: "error",
        message: error.message,
      });
    });
    this.update({
      state: "idle",
      rollbackAvailable: await this.recovery.rollbackAvailable(
        this.currentVersion,
      ),
      message: undefined,
    });
  }

  getStatus(): ReleaseUpdateStatus {
    return this.windowsInstalled?.getStatus() ?? structuredClone(this.status);
  }

  startAutomaticChecks(onError: (error: unknown) => void): void {
    if (
      !this.isPackaged ||
      this.status.state === "disabled" ||
      this.initialCheckTimer ||
      this.periodicCheckTimer
    )
      return;
    const check = () => {
      void this.check().catch(onError);
    };
    this.initialCheckTimer = setTimeout(() => {
      this.initialCheckTimer = undefined;
      check();
      this.periodicCheckTimer = setInterval(check, 60 * 60 * 1_000);
      this.periodicCheckTimer.unref();
    }, 5_000);
    this.initialCheckTimer.unref();
  }

  stopAutomaticChecks(): void {
    clearTimeout(this.initialCheckTimer);
    clearInterval(this.periodicCheckTimer);
    this.initialCheckTimer = undefined;
    this.periodicCheckTimer = undefined;
  }

  async check(): Promise<ReleaseUpdateStatus> {
    if (this.windowsInstalled) return this.windowsInstalled.check();
    if (
      ["disabled", "checking", "downloading", "downloaded"].includes(
        this.status.state,
      )
    )
      return this.getStatus();
    if (this.platform === "win32") {
      this.update({
        state: "checking",
        message: undefined,
        availableVersion: undefined,
        manualDownloadUrl: undefined,
      });
      try {
        const release = await this.checkWindows(
          this.currentVersion,
          this.environment.ARTEMIS_UPDATE_OWNER ?? "EurekaRaider",
          this.environment.ARTEMIS_UPDATE_REPO ?? "Artemis",
        );
        this.update({
          state: release ? "available" : "idle",
          upToDate: !release,
          availableVersion: release?.version,
          manualDownloadUrl: release?.downloadUrl,
        });
      } catch {
        this.update({
          state: "error",
          message: "Could not check Windows releases. Please try again later.",
        });
      }
      return this.getStatus();
    }
    await this.updater.checkForUpdates();
    return this.getStatus();
  }

  async download(): Promise<ReleaseUpdateStatus> {
    if (this.windowsInstalled) return this.windowsInstalled.download();
    if (this.platform === "win32")
      throw new Error(
        "Windows ZIP updates must be downloaded in the browser and replaced manually.",
      );
    if (
      !this.status.availableVersion ||
      !["available", "error"].includes(this.status.state)
    ) {
      throw new Error("No update is available to download");
    }
    this.update({ state: "downloading", progress: 0, message: undefined });
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.update({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return this.getStatus();
  }

  async install(): Promise<void> {
    if (this.windowsInstalled) return this.windowsInstalled.install();
    if (this.platform === "win32")
      throw new Error("Windows ZIP updates must be installed manually.");
    if (this.status.state !== "downloaded" || !this.downloadedVersion) {
      throw new Error("No verified update is ready to install");
    }
    await this.recovery.prepareInstall(
      this.currentVersion,
      this.downloadedVersion,
    );
    this.updater.quitAndInstall(false, true);
  }

  async markHealthy(): Promise<void> {
    if (this.windowsInstalled) return this.windowsInstalled.markHealthy();
    if (this.platform === "win32") return;
    await this.recovery.markHealthy(this.currentVersion);
    // Cleanup is retried on the next healthy startup if a cache file is locked.
    // It must not turn a successful installation into an update error.
    await this.recovery.cleanupInstalledUpdate().catch((error: unknown) => {
      console.warn("Could not clean installed update cache", error);
    });
    this.update({
      completedVersion: this.installedVersion,
      rollbackAvailable: await this.recovery.rollbackAvailable(
        this.currentVersion,
      ),
    });
  }

  private async handleDownloaded(info: UpdateInfo): Promise<void> {
    if (!info.downloadedFile) {
      this.update({
        state: "error",
        message: "Updater did not expose the downloaded artifact.",
      });
      return;
    }
    await this.recovery.recordDownloaded(info.version, info.downloadedFile);
    this.downloadedVersion = info.version;
    this.update({
      state: "downloaded",
      availableVersion: info.version,
      progress: 100,
      message: undefined,
    });
  }

  private update(patch: UpdateStatusPatch): void {
    const next = { ...this.status } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    if (next.state !== "idle") delete next.upToDate;
    this.status = next as unknown as ReleaseUpdateStatus;
    this.onStatus(this.getStatus());
  }

  private launchRollbackWatchdog(
    healthMarkerPath: string,
    previousInstallerPath: string,
  ): void {
    if (this.platform === "darwin") {
      const watchdog = spawn(
        "/bin/bash",
        [
          this.rollbackScriptPath,
          healthMarkerPath,
          previousInstallerPath,
          this.applicationPath,
          String(process.pid),
          "90",
        ],
        {
          detached: true,
          stdio: "ignore",
        },
      );
      watchdog.unref();
      return;
    }
    if (this.platform !== "win32") return;
    const watchdog = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        this.rollbackScriptPath,
        "-HealthMarkerPath",
        healthMarkerPath,
        "-PreviousInstallerPath",
        previousInstallerPath,
        "-ApplicationProcessId",
        String(process.pid),
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    watchdog.unref();
  }
}
