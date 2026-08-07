import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
