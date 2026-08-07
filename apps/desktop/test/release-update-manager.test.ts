import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
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
  quitAndInstall = vi.fn();

  setFeedURL(options: any): void {
    this.feed = options;
  }
}

describe("ReleaseUpdateManager", () => {
  it("configures a macOS feed with download-only installation semantics", async () => {
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

    expect(updater.feed).toMatchObject({
      provider: "github",
      owner: "example",
      repo: "Artemis",
    });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
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
      state: "disabled",
      message: expect.stringContaining("manual updates"),
    });
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
