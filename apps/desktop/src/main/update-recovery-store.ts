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

export class UpdateRecoveryStore {
  private state: RecoveryState | undefined;

  constructor(
    private readonly statePath: string,
    private readonly artifactRoot: string,
  ) {}

  async recordDownloaded(version: string, sourcePath: string): Promise<string> {
    const safeVersion = validateVersion(version);
    const destinationDirectory = join(this.artifactRoot, safeVersion);
    await mkdir(destinationDirectory, { recursive: true });
    const destinationPath = join(destinationDirectory, basename(sourcePath));
    await copyFile(sourcePath, destinationPath);
    const state = await this.load();
    state.artifacts[safeVersion] = destinationPath;
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
    if (state.pending?.targetVersion === current) delete state.pending;
    await this.save(state);
    return markerPath;
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
