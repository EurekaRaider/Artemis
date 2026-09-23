import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReleaseUpdateManager,
  type UpdaterAdapter,
} from "../src/main/release-update-manager.js";
import { UpdateRecoveryStore } from "../src/main/update-recovery-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

class FakeUpdater extends EventEmitter implements UpdaterAdapter {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  feed: Record<string, unknown> | undefined;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();

  setFeedURL(options: any): void {
    this.feed = options;
  }
}

describe("ReleaseUpdateManager", () => {
  it("checks after five seconds and hourly without downloading, survives errors and stops on quit", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const updater = new FakeUpdater();
    const manager = new ReleaseUpdateManager(
      updater,
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      ),
      "1.0.0",
      true,
      "darwin",
      "/tmp/rollback.sh",
      "/Applications/Artemis.app",
      { ARTEMIS_UPDATE_OWNER: "example", ARTEMIS_UPDATE_REPO: "Artemis" },
      () => {},
    );
    await manager.initialize();
    vi.useFakeTimers();
    const onError = vi.fn();
    manager.startAutomaticChecks(onError);
    manager.startAutomaticChecks(onError);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.checkForUpdates.mockRejectedValueOnce(new Error("Offline"));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    updater.emit("update-available", { version: "1.1.0" });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    updater.emit("download-progress", { percent: 50 });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    manager.stopAutomaticChecks();
    updater.emit("update-not-available");
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
    manager.startAutomaticChecks(onError);
    manager.stopAutomaticChecks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });
  it.each([
    { packaged: true, configExists: true, state: "idle" },
    { packaged: true, configExists: false, state: "disabled" },
    { packaged: false, configExists: true, state: "disabled" },
  ])(
    "uses the bundled feed only in configured packaged builds: %j",
    async ({ packaged, configExists, state }) => {
      const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
      temporaryDirectories.push(directory);
      const configPath = join(directory, "app-update.yml");
      if (configExists)
        await writeFile(
          configPath,
          "provider: github\nowner: example\nrepo: Artemis\n",
        );
      const updater = new FakeUpdater();
      const manager = new ReleaseUpdateManager(
        updater,
        new UpdateRecoveryStore(
          join(directory, "state.json"),
          join(directory, "artifacts"),
        ),
        "1.0.0",
        packaged,
        "darwin",
        "/tmp/rollback.sh",
        "/Applications/Artemis.app",
        {},
        () => {},
        configPath,
      );
      await manager.initialize();
      await manager.check();
      expect(manager.getStatus().state).toBe(state);
      expect(updater.feed).toBeUndefined();
      expect(updater.checkForUpdates).toHaveBeenCalledTimes(
        state === "idle" ? 1 : 0,
      );
    },
  );

  it("configures a macOS feed with download-only installation semantics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "app-update.yml");
    await writeFile(
      configPath,
      "provider: github\nowner: bundled\nrepo: feed\n",
    );
    const updater = new FakeUpdater();
    const manager = new ReleaseUpdateManager(
      updater,
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      ),
      "1.0.0",
      true,
      "darwin",
      "/tmp/rollback.sh",
      "/Applications/Artemis.app",
      {
        ARTEMIS_UPDATE_OWNER: "example",
        ARTEMIS_UPDATE_REPO: "Artemis",
      },
      () => {},
      configPath,
    );

    await manager.initialize();

    expect(updater.feed).toMatchObject({
      provider: "github",
      owner: "example",
      repo: "Artemis",
    });
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    await expect(manager.download()).rejects.toThrow("No update");
    updater.emit("update-available", { version: "1.1.0" });
    expect(manager.getStatus().state).toBe("available");
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    await manager.download();
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(manager.getStatus().state).toBe("downloading");
    updater.emit("download-progress", {
      percent: 42,
      transferred: 42,
      total: 100,
    });
    expect(manager.getStatus().progress).toBe(42);
    await manager.check();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await expect(manager.download()).rejects.toThrow("No update");
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("announces completion only after the installed version starts successfully", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const recovery = new UpdateRecoveryStore(
      join(directory, "state.json"),
      join(directory, "artifacts"),
    );
    const artifact = join(directory, "update.zip");
    await writeFile(artifact, "test update");
    await recovery.recordDownloaded("1.1.0", artifact);
    await recovery.prepareInstall("1.0.0", "1.1.0");
    const makeManager = () =>
      new ReleaseUpdateManager(
        new FakeUpdater(),
        recovery,
        "1.1.0",
        true,
        "darwin",
        "/tmp/rollback.sh",
        "/Applications/Artemis.app",
        { ARTEMIS_UPDATE_OWNER: "example", ARTEMIS_UPDATE_REPO: "Artemis" },
        () => {},
      );
    const manager = makeManager();
    await manager.initialize();
    expect(manager.getStatus().completedVersion).toBeUndefined();
    const cleanup = vi.spyOn(recovery, "cleanupInstalledUpdate");
    cleanup.mockRejectedValueOnce(new Error("Cache is locked"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await manager.markHealthy();
    expect(manager.getStatus().completedVersion).toBe("1.1.0");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
    const nextLaunch = makeManager();
    await nextLaunch.initialize();
    await nextLaunch.markHealthy();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(nextLaunch.getStatus().completedVersion).toBeUndefined();
  });

  it("uses manual updates for Windows ZIP builds even when a feed is configured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const updater = new FakeUpdater();
    const manager = new ReleaseUpdateManager(
      updater,
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      ),
      "1.0.0",
      true,
      "win32",
      "C:\\rollback.ps1",
      "C:\\Artemis.exe",
      {
        ARTEMIS_UPDATE_OWNER: "example",
        ARTEMIS_UPDATE_REPO: "Artemis",
      },
      () => {},
    );

    await manager.initialize();

    expect(updater.feed).toBeUndefined();
    expect(manager.getStatus()).toMatchObject({
      state: "idle",
      manualUpdate: true,
    });
  });

  it("checks Windows periodically, exposes a manual link and never downloads or installs", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const updater = new FakeUpdater();
    const checkWindows = vi.fn().mockResolvedValue({
      version: "1.1.0",
      downloadUrl: "https://github.com/example/release.zip",
    });
    const manager = new ReleaseUpdateManager(
      updater,
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      ),
      "1.0.0",
      true,
      "win32",
      "",
      "",
      {},
      () => {},
      undefined,
      checkWindows,
    );
    await manager.initialize();
    vi.useFakeTimers();
    manager.startAutomaticChecks(vi.fn());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(manager.getStatus()).toMatchObject({
      state: "available",
      manualUpdate: true,
      availableVersion: "1.1.0",
      manualDownloadUrl: "https://github.com/example/release.zip",
    });
    await expect(manager.download()).rejects.toThrow("manually");
    await expect(manager.install()).rejects.toThrow("manually");
    checkWindows.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(manager.getStatus().state).toBe("error");
    expect(manager.getStatus().manualDownloadUrl).toBeUndefined();
    checkWindows.mockResolvedValueOnce(undefined);
    await manager.check();
    expect(manager.getStatus().state).toBe("idle");
    manager.stopAutomaticChecks();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("refuses an insecure generic update feed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const manager = new ReleaseUpdateManager(
      new FakeUpdater(),
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      ),
      "1.0.0",
      true,
      "darwin",
      "/tmp/rollback.sh",
      "/Applications/Artemis.app",
      { ARTEMIS_UPDATE_URL: "http://updates.example.test" },
      () => {},
    );

    await expect(manager.initialize()).rejects.toThrow("HTTPS");
  });

  it("reports a recovery copy failure instead of leaking an unhandled rejection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-updater-"));
    temporaryDirectories.push(directory);
    const updater = new FakeUpdater();
    const manager = new ReleaseUpdateManager(
      updater,
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      ),
      "1.0.0",
      true,
      "darwin",
      "/tmp/rollback.sh",
      "/Applications/Artemis.app",
      {
        ARTEMIS_UPDATE_OWNER: "example",
        ARTEMIS_UPDATE_REPO: "Artemis",
      },
      () => {},
    );
    await manager.initialize();

    updater.emit("update-downloaded", {
      version: "1.1.0",
      downloadedFile: join(directory, "missing-installer.exe"),
    });

    await vi.waitFor(() => {
      expect(manager.getStatus()).toMatchObject({
        state: "error",
        message: expect.stringContaining("missing-installer.exe"),
      });
    });
  });
});
