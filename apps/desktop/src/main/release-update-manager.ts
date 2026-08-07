import { spawn } from "node:child_process";

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
  availableVersion?: string;
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
      this.update({
        state: "disabled",
        message:
          "Windows ZIP builds use manual updates. Download and extract the new ZIP to update Artemis.",
      });
      return;
    }
    const startup = await this.recovery.beginStartup(this.currentVersion);
    if (startup?.pending.previousArtifact) {
      this.launchRollbackWatchdog(
        startup.healthMarkerPath,
        startup.pending.previousArtifact,
      );
    }
    const feed = this.isPackaged ? resolveFeed(this.environment) : undefined;
    if (!feed) {
      this.update({
        state: "disabled",
        message: this.isPackaged
          ? "No signed update feed is configured."
          : "Updates are disabled in development builds.",
      });
      return;
    }

    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowDowngrade = false;
    this.updater.setFeedURL(feed);
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
    return structuredClone(this.status);
  }

  async check(): Promise<ReleaseUpdateStatus> {
    if (this.status.state === "disabled") return this.getStatus();
    await this.updater.checkForUpdates();
    return this.getStatus();
  }

  async install(): Promise<void> {
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
    if (this.platform === "win32") return;
    await this.recovery.markHealthy(this.currentVersion);
    this.update({
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
