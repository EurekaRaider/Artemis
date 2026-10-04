import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

interface PendingUpdate {
  previousVersion: string;
  targetVersion: string;
  previousArtifact?: string;
  startedAt: string;
  attempts: number;
}

interface RecoveryState {
  version: 1;
  lastHealthyVersion?: string;
  lastHealthyArtifact?: string;
  artifacts: Record<string, string>;
  downloadCaches?: Record<string, { file: string; sha512: string }>;
  cleanupVersions?: string[];
  pending?: PendingUpdate;
}

export interface StartupRecovery {
  pending: PendingUpdate;
  healthMarkerPath: string;
}

function validateVersion(value: string): string {
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(value)) {
    throw new Error("Update version is invalid");
  }
  return value;
}

async function fileHash(path: string): Promise<string | undefined> {
  try {
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("base64");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export class UpdateRecoveryStore {
  private state: RecoveryState | undefined;

  constructor(
    private readonly statePath: string,
    private readonly artifactRoot: string,
    private readonly updaterCacheRoot?: string,
  ) {}

  async recordDownloaded(version: string, sourcePath: string): Promise<string> {
    const safeVersion = validateVersion(version);
    const destinationDirectory = join(this.artifactRoot, safeVersion);
    await mkdir(destinationDirectory, { recursive: true });
    const destinationPath = join(destinationDirectory, basename(sourcePath));
    await copyFile(sourcePath, destinationPath);
    const state = await this.load();
    state.artifacts[safeVersion] = destinationPath;
    // Only electron-updater's pending directory contains disposable downloads.
    if (basename(dirname(sourcePath)) === "pending") {
      const sha512 = await fileHash(destinationPath);
      if (sha512) {
        state.downloadCaches ??= {};
        state.downloadCaches[safeVersion] = { file: sourcePath, sha512 };
      }
    }
    await this.save(state);
    return destinationPath;
  }

  async prepareInstall(
    currentVersion: string,
    targetVersion: string,
  ): Promise<PendingUpdate> {
    const state = await this.load();
    const current = validateVersion(currentVersion);
    const target = validateVersion(targetVersion);
    if (!state.artifacts[target]) {
      throw new Error("Downloaded update recovery artifact is missing");
    }
    state.pending = {
      previousVersion: current,
      targetVersion: target,
      ...(state.lastHealthyVersion === current && state.lastHealthyArtifact
        ? { previousArtifact: state.lastHealthyArtifact }
        : {}),
      startedAt: new Date().toISOString(),
      attempts: 0,
    };
    await this.save(state);
    return structuredClone(state.pending);
  }

  async beginStartup(
    currentVersion: string,
  ): Promise<StartupRecovery | undefined> {
    const state = await this.load();
    const current = validateVersion(currentVersion);
    if (!state.pending || state.pending.targetVersion !== current) {
      return undefined;
    }
    state.pending.attempts += 1;
    const healthMarkerPath = join(
      this.artifactRoot,
      `healthy-${current}.marker`,
    );
    await rm(healthMarkerPath, { force: true });
    await this.save(state);
    return {
      pending: structuredClone(state.pending),
      healthMarkerPath,
    };
  }

  async markHealthy(currentVersion: string): Promise<string> {
    const state = await this.load();
    const current = validateVersion(currentVersion);
    const markerPath = join(this.artifactRoot, `healthy-${current}.marker`);
    await mkdir(this.artifactRoot, { recursive: true });
    await writeFile(markerPath, new Date().toISOString(), "utf8");
    state.lastHealthyVersion = current;
    const artifact = state.artifacts[current];
    if (artifact) state.lastHealthyArtifact = artifact;
    if (state.pending?.targetVersion === current) {
      state.cleanupVersions = [
        ...new Set([
          ...(state.cleanupVersions ?? []),
          ...Object.keys(state.artifacts),
        ]),
      ];
      delete state.pending;
    }
    // Also collect the recovery package retained by older releases.
    if (artifact) {
      state.cleanupVersions = [
        ...new Set([...(state.cleanupVersions ?? []), current]),
      ];
    }
    await this.save(state);
    return markerPath;
  }

  async cleanupInstalledUpdate(): Promise<void> {
    const state = await this.load();
    // Keep rollback artifacts until the pending installation is healthy.
    if (state.pending) return;
    for (const version of [...(state.cleanupVersions ?? [])]) {
      const artifact = state.artifacts[version];
      // Releases before cache tracking still have a verified recovery copy.
      const cache =
        state.downloadCaches?.[version] ??
        (this.updaterCacheRoot && artifact
          ? {
              file: join(this.updaterCacheRoot, "pending", basename(artifact)),
              sha512: await fileHash(artifact),
            }
          : undefined);
      if (cache?.sha512 && basename(dirname(cache.file)) === "pending") {
        const pendingDirectory = dirname(cache.file);
        for (const path of [
          cache.file,
          join(dirname(pendingDirectory), "update.zip"),
        ]) {
          // A later download may already have reused the cache location.
          if ((await fileHash(path)) === cache.sha512)
            await rm(path, { force: true });
        }
        const metadataPath = join(pendingDirectory, "update-info.json");
        try {
          const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
            sha512?: string;
          };
          if (metadata.sha512 === cache.sha512)
            await rm(metadataPath, { force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        delete state.downloadCaches?.[version];
      }
      await rm(join(this.artifactRoot, validateVersion(version)), {
        recursive: true,
        force: true,
      });
      delete state.artifacts[version];
      if (state.lastHealthyArtifact === artifact)
        delete state.lastHealthyArtifact;
      // The active watchdog still needs the successful startup marker.
      if (version !== state.lastHealthyVersion) {
        await rm(
          join(this.artifactRoot, `healthy-${validateVersion(version)}.marker`),
          { force: true },
        );
      }
      state.cleanupVersions = (state.cleanupVersions ?? []).filter(
        (item) => item !== version,
      );
      await this.save(state);
    }
  }

  async rollbackAvailable(currentVersion: string): Promise<boolean> {
    const state = await this.load();
    return Boolean(
      state.lastHealthyVersion === validateVersion(currentVersion) &&
      state.lastHealthyArtifact,
    );
  }

  private async load(): Promise<RecoveryState> {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(
        await readFile(this.statePath, "utf8"),
      ) as RecoveryState;
      if (
        parsed.version !== 1 ||
        !parsed.artifacts ||
        typeof parsed.artifacts !== "object"
      ) {
        throw new Error("Update recovery state is invalid");
      }
      this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { version: 1, artifacts: {} };
    }
    return this.state;
  }

  private async save(state: RecoveryState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.statePath);
    this.state = state;
  }
}
