import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UpdateRecoveryStore } from "../src/main/update-recovery-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("UpdateRecoveryStore", () => {
  it("cleans legacy cache records and retries an interrupted cleanup after relaunch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-update-"));
    temporaryDirectories.push(directory);
    const cache = join(directory, "cache");
    const pending = join(cache, "pending");
    await mkdir(pending, { recursive: true });
    const source = join(pending, "update.zip");
    await writeFile(source, "signed update");
    const statePath = join(directory, "state.json");
    const makeStore = () =>
      new UpdateRecoveryStore(statePath, join(directory, "artifacts"), cache);
    let store = makeStore();
    await store.recordDownloaded("1.1.0", source);
    await store.prepareInstall("1.0.0", "1.1.0");
    const legacy = JSON.parse(await readFile(statePath, "utf8"));
    delete legacy.downloadCaches;
    await writeFile(statePath, JSON.stringify(legacy));
    store = makeStore();
    await store.beginStartup("1.1.0");
    await store.markHealthy("1.1.0");
    const metadata = join(pending, "update-info.json");
    await mkdir(metadata);
    await expect(store.cleanupInstalledUpdate()).rejects.toThrow();
    await rm(metadata, { recursive: true });
    await writeFile(
      metadata,
      JSON.stringify({
        sha512: createHash("sha512").update("signed update").digest("base64"),
      }),
    );
    store = makeStore();
    await store.markHealthy("1.1.0");
    await store.cleanupInstalledUpdate();
    await expect(readFile(metadata)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await store.rollbackAvailable("1.1.0")).toBe(true);
    expect(
      JSON.parse(await readFile(statePath, "utf8")).cleanupVersions,
    ).toEqual([]);
  });
  it("cleans successful update caches, keeps one recovery package and leaves history intact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-update-"));
    temporaryDirectories.push(directory);
    const pending = join(directory, "cache", "pending");
    await mkdir(pending, { recursive: true });
    const old = join(pending, "old.zip");
    const next = join(pending, "next.zip");
    await writeFile(old, "old");
    await writeFile(next, "new");
    await writeFile(join(directory, "history.sqlite"), "history");
    await writeFile(join(directory, "cache", "update.zip"), "new");
    const makeStore = () =>
      new UpdateRecoveryStore(
        join(directory, "state.json"),
        join(directory, "artifacts"),
      );
    let store = makeStore();
    const oldRecovery = await store.recordDownloaded("1.0.0", old);
    await store.markHealthy("1.0.0");
    const newRecovery = await store.recordDownloaded("1.1.0", next);
    await store.prepareInstall("1.0.0", "1.1.0");
    store = makeStore();
    await store.beginStartup("1.1.0");
    await store.cleanupInstalledUpdate();
    expect(await readFile(next, "utf8")).toBe("new");
    expect(await readFile(oldRecovery, "utf8")).toBe("old");
    await store.markHealthy("1.1.0");
    await store.cleanupInstalledUpdate();
    for (const path of [
      old,
      next,
      oldRecovery,
      join(directory, "cache", "update.zip"),
    ]) {
      await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(await readFile(newRecovery, "utf8")).toBe("new");
    expect(await readFile(join(directory, "history.sqlite"), "utf8")).toBe(
      "history",
    );
    expect(await store.rollbackAvailable("1.1.0")).toBe(true);
    await makeStore().cleanupInstalledUpdate();
  });

  it("does not delete a newer download reusing the cache paths", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-update-"));
    temporaryDirectories.push(directory);
    const pending = join(directory, "cache", "pending");
    await mkdir(pending, { recursive: true });
    const source = join(pending, "update.zip");
    await writeFile(source, "installed");
    const store = new UpdateRecoveryStore(
      join(directory, "state.json"),
      join(directory, "artifacts"),
    );
    await store.recordDownloaded("1.1.0", source);
    await store.prepareInstall("1.0.0", "1.1.0");
    await store.markHealthy("1.0.0");
    await store.cleanupInstalledUpdate();
    expect(await readFile(source, "utf8")).toBe("installed");
    await store.markHealthy("1.1.0");
    await writeFile(source, "newer");
    await writeFile(join(directory, "cache", "update.zip"), "newer");
    await writeFile(
      join(pending, "update-info.json"),
      JSON.stringify({ sha512: "newer" }),
    );
    await store.cleanupInstalledUpdate();
    expect(await readFile(source, "utf8")).toBe("newer");
    expect(await readFile(join(directory, "cache", "update.zip"), "utf8")).toBe(
      "newer",
    );
    expect(
      JSON.parse(await readFile(join(pending, "update-info.json"), "utf8")),
    ).toEqual({ sha512: "newer" });
  });
  it("retains the last healthy installer and arms rollback before the next update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-update-"));
    temporaryDirectories.push(directory);
    const artifact = join(directory, "Artemis-1.1.0.exe");
    await writeFile(artifact, "signed-installer", "utf8");
    const store = new UpdateRecoveryStore(
      join(directory, "state.json"),
      join(directory, "artifacts"),
    );

    await store.recordDownloaded("1.1.0", artifact);
    await store.markHealthy("1.1.0");
    const nextArtifact = join(directory, "Artemis-1.2.0.exe");
    await writeFile(nextArtifact, "next-installer", "utf8");
    await store.recordDownloaded("1.2.0", nextArtifact);
    const pending = await store.prepareInstall("1.1.0", "1.2.0");

    expect(pending).toMatchObject({
      previousVersion: "1.1.0",
      targetVersion: "1.2.0",
    });
    expect(pending.previousArtifact).toContain("1.1.0");
  });

  it("keeps an update pending until the new version writes its health marker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-update-"));
    temporaryDirectories.push(directory);
    const store = new UpdateRecoveryStore(
      join(directory, "state.json"),
      join(directory, "artifacts"),
    );
    const artifact = join(directory, "Artemis-2.0.0.exe");
    await writeFile(artifact, "installer", "utf8");
    await store.recordDownloaded("2.0.0", artifact);
    await store.prepareInstall("1.0.0", "2.0.0");

    const startup = await store.beginStartup("2.0.0");
    expect(startup?.pending.attempts).toBe(1);
    const marker = await store.markHealthy("2.0.0");
    expect(await readFile(marker, "utf8")).not.toBe("");
    expect(await store.beginStartup("2.0.0")).toBeUndefined();
  });
});
