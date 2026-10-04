import { fetchUpdateIndex } from "./fetch-update-index.js";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync, backup } from "node:sqlite";
import { gt } from "semver";
import { type UpdateIndexPayload } from "./signed-update-index.js";
import type { ReleaseUpdateStatus } from "./release-update-manager.js";

interface Recovery {
  sequence: number;
  quarantined?: string[];
  pending?: {
    version: string;
    previousVersion: string;
    installer: string;
    previousInstaller: string;
    installerHash: string;
    previousHash: string;
    databaseBackup: string;
    databasePath: string;
    executable: string;
    userData: string;
    healthMarker: string;
    readyMarker: string;
    cancelMarker: string;
    parentPid: number;
  };
}
export interface WindowsInstalledUpdaterOptions {
  currentVersion: string;
  userData: string;
  executable: string;
  helperPath: string;
  keys: Record<string, string>;
  onStatus(status: ReleaseUpdateStatus): void;
  prepareToQuit(): Promise<void>;
  quit(): void;
  cancelPreparation?(): void;
  fetcher?: typeof fetch;
}
const RELEASES =
  "https://github.com/EurekaRaider/ArtemisRelease/releases/download/";
export class WindowsInstalledUpdater {
  private status: ReleaseUpdateStatus;
  private index: UpdateIndexPayload | undefined;
  private downloaded: string | undefined;
  private downloadOperation: Promise<ReleaseUpdateStatus> | undefined;
  private installOperation: Promise<void> | undefined;
  private recovery: Recovery = { sequence: 0 };
  private readonly root: string;
  private readonly statePath: string;
  constructor(private readonly options: WindowsInstalledUpdaterOptions) {
    this.root = join(options.userData, "windows-update");
    this.statePath = join(this.root, "recovery.json");
    this.status = {
      state: "idle",
      currentVersion: options.currentVersion,
      rollbackAvailable: false,
    };
  }
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      this.recovery = JSON.parse(
        await readFile(this.statePath, "utf8"),
      ) as Recovery;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      !Number.isSafeInteger(this.recovery.sequence) ||
      this.recovery.sequence < 0
    )
      throw new Error("Invalid update recovery state");
    this.emit({});
  }
  getStatus(): ReleaseUpdateStatus {
    return structuredClone(this.status);
  }
  private emit(patch: Partial<ReleaseUpdateStatus>) {
    this.status = { ...this.status, ...patch };
    this.options.onStatus(this.getStatus());
  }
  private async save(): Promise<void> {
    const tmp = `${this.statePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.recovery), { mode: 0o600 });
    await rename(tmp, this.statePath);
  }
  private async indexAt(
    url: string,
    minimumSequence: number,
  ): Promise<UpdateIndexPayload> {
    return fetchUpdateIndex(
      url,
      this.options.keys,
      minimumSequence,
      this.options.fetcher,
    );
  }

  async check(): Promise<ReleaseUpdateStatus> {
    if (this.recovery.pending && !this.installOperation) {
      const saved = JSON.parse(
        await readFile(this.statePath, "utf8"),
      ) as Recovery;
      if (
        !saved.pending &&
        Number.isSafeInteger(saved.sequence) &&
        saved.sequence >= this.recovery.sequence
      )
        this.recovery = saved;
    }
    if (
      this.installOperation ||
      this.recovery.pending ||
      ["checking", "downloading", "downloaded"].includes(this.status.state)
    )
      return this.getStatus();
    this.index = undefined;
    this.downloaded = undefined;
    delete this.status.availableVersion;
    this.emit({
      state: "checking",
      upToDate: false,
      message: "",
    });
    try {
      const index = await this.indexAt(
        `${RELEASES}windows-x64-stable/windows-x64-update.json`,
        this.recovery.sequence,
      );
      this.recovery.sequence = index.sequence;
      await this.save();
      if (this.recovery.quarantined?.includes(index.version))
        throw new Error("This update previously failed its health check");
      this.index = index;
      this.emit(
        gt(index.version, this.options.currentVersion)
          ? { state: "available", availableVersion: index.version }
          : { state: "idle", upToDate: true },
      );
    } catch (error) {
      this.emit({ state: "error", message: String(error) });
    }
    return this.getStatus();
  }
  private async installer(index: UpdateIndexPayload): Promise<string> {
    const asset = index.assets.find(
      (value) => value.name === `Artemis-Windows-x64-${index.version}.exe`,
    )!;
    const destination = join(this.root, asset.name);
    const hashFile = async () => {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(destination))
        hash.update(chunk);
      return hash.digest("hex");
    };
    try {
      if ((await hashFile()) === asset.sha256) return destination;
    } catch {
      /* Download a verified replacement. */
    }
    const response = await (this.options.fetcher ?? fetch)(
      `${RELEASES}v${index.version}/${asset.name}`,
      { credentials: "omit", signal: AbortSignal.timeout(15 * 60 * 1000) },
    );
    if (!response.ok || !response.body)
      throw new Error(`Installer HTTP ${response.status}`);
    const temporary = `${destination}.partial`;
    const file = await open(temporary, "w", 0o600);
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > asset.size) throw new Error("Installer size mismatch");
        hash.update(chunk.value);
        let offset = 0;
        while (offset < chunk.value.length) {
          const { bytesWritten } = await file.write(chunk.value, offset);
          if (!bytesWritten)
            throw new Error("Installer write made no progress");
          offset += bytesWritten;
        }
      }
      if (size !== asset.size || hash.digest("hex") !== asset.sha256)
        throw new Error("Installer integrity check failed");
      await file.sync();
    } catch (error) {
      await file.close();
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    } finally {
      await file.close();
      await reader.cancel();
      reader.releaseLock();
    }
    await rename(temporary, destination);
    return destination;
  }
  download(): Promise<ReleaseUpdateStatus> {
    if (this.downloadOperation) return this.downloadOperation;
    if (this.installOperation)
      return Promise.reject(new Error("Update installation is in progress"));
    this.downloadOperation = this.downloadOnce().finally(() => {
      this.downloadOperation = undefined;
    });
    return this.downloadOperation;
  }
  private async downloadOnce(): Promise<ReleaseUpdateStatus> {
    if (!this.index || !gt(this.index.version, this.options.currentVersion))
      throw new Error("No update available");
    this.emit({ state: "downloading", progress: 0 });
    try {
      this.downloaded = await this.installer(this.index);
      this.emit({ state: "downloaded", progress: 100 });
    } catch (error) {
      this.emit({ state: "error", message: String(error) });
      throw error;
    }
    return this.getStatus();
  }
  install(): Promise<void> {
    if (this.installOperation) return this.installOperation;
    this.installOperation = this.installOnce()
      .catch(async (error) => {
        if (this.recovery.pending) {
          await writeFile(this.recovery.pending.cancelMarker, "cancelled", {
            mode: 0o600,
          });
          delete this.recovery.pending;
          await this.save();
        }
        this.options.cancelPreparation?.();
        throw error;
      })
      .finally(() => {
        this.installOperation = undefined;
      });
    return this.installOperation;
  }
  private async installOnce(): Promise<void> {
    if (this.recovery.pending)
      throw new Error("An update recovery is already pending");
    if (!this.index || !this.downloaded || this.status.state !== "downloaded")
      throw new Error("No verified installer ready");
    // A recoverable previous version is mandatory, including the first update.
    const previous = await this.indexAt(
      `${RELEASES}v${this.options.currentVersion}/windows-x64-update.json`,
      0,
    );
    if (previous.version !== this.options.currentVersion)
      throw new Error("Rollback version mismatch");
    const previousInstaller = await this.installer(previous);
    await this.installer(this.index); // Revalidate immediately before installation.
    await this.options.prepareToQuit();
    const databasePath = join(this.options.userData, "artemis.sqlite");
    const databaseBackup = join(this.root, "pre-update.sqlite");
    await rm(databaseBackup, { force: true });
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      await backup(db, databaseBackup);
    } finally {
      db.close();
    }
    const healthMarker = join(this.root, "healthy.marker");
    const readyMarker = join(this.root, "helper-ready.marker");
    const cancelMarker = join(this.root, "cancel.marker");
    await Promise.all([
      rm(healthMarker, { force: true }),
      rm(readyMarker, { force: true }),
      rm(cancelMarker, { force: true }),
    ]);
    this.recovery.pending = {
      version: this.index.version,
      previousVersion: previous.version,
      installer: this.downloaded,
      previousInstaller,
      installerHash: this.index.assets.find(
        (a) => a.name === `Artemis-Windows-x64-${this.index!.version}.exe`,
      )!.sha256,
      previousHash: previous.assets.find(
        (a) => a.name === `Artemis-Windows-x64-${previous.version}.exe`,
      )!.sha256,
      databaseBackup,
      databasePath,
      executable: this.options.executable,
      userData: this.options.userData,
      healthMarker,
      readyMarker,
      cancelMarker,
      parentPid: process.pid,
    };
    await this.save();
    const helper = join(this.root, "install-and-recover.ps1");
    await copyFile(this.options.helperPath, helper);
    const child = spawn(
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helper,
        "-StatePath",
        this.statePath,
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    for (let attempt = 0; attempt < 100; attempt++) {
      let ready = false;
      try {
        ready =
          (await readFile(readyMarker, "utf8")).trim() === this.index.version;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (ready) {
        this.options.quit();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      "Update recovery helper did not become ready; application remains open",
    );
  }
  async markHealthy(): Promise<void> {
    if (this.recovery.pending?.version !== this.options.currentVersion) return;
    await writeFile(
      this.recovery.pending.healthMarker,
      this.options.currentVersion,
      { mode: 0o600 },
    );
    // Keep checks blocked until the independent helper has cleared pending.
    // Otherwise a concurrent check could race the helper's state-file write.
    this.emit({
      completedVersion: this.options.currentVersion,
      rollbackAvailable: true,
    });
  }
}
