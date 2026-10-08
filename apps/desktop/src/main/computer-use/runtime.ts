import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { release as osRelease } from "node:os";
import {
  computerUsePackManifestSchema,
  type ComputerUsePackManifest,
  type ComputerUseRuntimeStatus,
} from "@artemis/protocol";
import { CapabilityPackService } from "../capabilities/capability-pack-service.js";
import {
  OfficeCapabilityUpdates,
  type OfficeRuntimeCatalog,
} from "../office/office-capability-updates.js";
import { atomicWrite } from "../office/office-file-utils.js";
import {
  ComputerNativeDriver,
  type ComputerHelperLease,
} from "./native-driver.js";
import { verifyComputerUseNative } from "./native-verification.js";

export function computerUsePlatformSupported(
  platform: string = process.platform,
  arch: string = process.arch,
  release = osRelease(),
): boolean {
  return platform === "darwin"
    ? arch === "arm64" && Number(release.split(".")[0]) >= 23
    : platform === "win32" &&
        arch === "x64" &&
        Number(release.split(".")[2]) >= 22000;
}
/** A maintainer opts the final host into one official immutable candidate for acceptance. */
export function computerUseVerificationCatalog(
  catalog: OfficeRuntimeCatalog,
  candidateVersion?: string,
): OfficeRuntimeCatalog {
  if (candidateVersion === undefined) return catalog;
  if (
    candidateVersion.length > 64 ||
    candidateVersion.trim() !== candidateVersion ||
    !/^\d+\.\d+\.\d+$/u.test(candidateVersion)
  )
    throw new Error("Invalid Computer Use candidate version");
  return {
    ...catalog,
    manifests: [],
    updateUrl:
      "https://github.com/EurekaRaider/Artemis/releases/download/computer-use-v" +
      candidateVersion +
      "/catalog.json",
  };
}

interface Transaction {
  version: string;
  previousVersion?: string;
}
export interface ComputerUseRuntimeOptions {
  userData: string;
  catalog: OfficeRuntimeCatalog;
  hostVersion: string;
  commitPlugin(root: string, version: string): Promise<void>;
  busy(): boolean;
  stopHelper(): Promise<void>;
  changed?(): void;
  activated?(): Promise<void>;
  verifyNative?: typeof verifyComputerUseNative;
  probe?(lease: ComputerHelperLease): Promise<void>;
  fetch?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  osRelease?: string;
}

/** Only the first-party host can commit this pack into the reserved plugin identity. */
export class ComputerUseRuntime {
  readonly packs: CapabilityPackService;
  readonly updates: OfficeCapabilityUpdates;
  readonly supported: boolean;
  private pendingVersion: string | undefined;
  private installing: Promise<void> | undefined;
  private activating: Promise<void> | undefined;
  private error: string | undefined;
  private generation = 0;
  private previousVersion: string | undefined;
  private readonly journal: string;
  constructor(private readonly options: ComputerUseRuntimeOptions) {
    const platform = options.platform ?? process.platform;
    const arch = options.arch ?? process.arch;
    this.supported = computerUsePlatformSupported(
      platform,
      arch,
      options.osRelease ?? osRelease(),
    );
    this.journal = join(options.userData, "computer-use-transaction.json");
    this.packs = new CapabilityPackService({
      root: join(options.userData, "capability-packs"),
      packId: "computer-use",
      hostVersion: options.hostVersion,
      platform,
      arch,
      publicKeys: options.catalog.publicKeys,
      verifyNative: options.verifyNative ?? verifyComputerUseNative,
      dependents: async () => [],
      ...(options.fetch ? { fetch: options.fetch } : {}),
      onProgress: () => options.changed?.(),
    });
    this.updates = new OfficeCapabilityUpdates(options.catalog, {
      hostVersion: options.hostVersion,
      platform,
      arch,
      packId: "computer-use",
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }
  async status(): Promise<ComputerUseRuntimeStatus> {
    const current = await this.packs.status();
    if (this.activating) {
      delete current.activeVersion;
      if (this.previousVersion) current.activeVersion = this.previousVersion;
      current.phase = "verifying";
    }
    return {
      ...current,
      ...this.updates.status(current.activeVersion),
      supported: this.supported,
      ...(this.pendingVersion ? { pendingVersion: this.pendingVersion } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }
  async check(): Promise<void> {
    await this.updates.check();
    this.options.changed?.();
  }
  async initialize(): Promise<void> {
    try {
      const transaction = JSON.parse(
        await readFile(this.journal, "utf8"),
      ) as Transaction;
      if (
        !/^\d+\.\d+\.\d+$/u.test(transaction.version) ||
        (transaction.previousVersion !== undefined &&
          !/^\d+\.\d+\.\d+$/u.test(transaction.previousVersion))
      )
        throw new Error("Invalid Computer Use transaction");
      this.pendingVersion = transaction.version;
      this.previousVersion = transaction.previousVersion;
      await this.finishUpdate();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.error = String(error);
        throw error;
      }
    }
  }
  async install(): Promise<void> {
    if (!this.supported)
      throw new Error(
        "Computer Use supports macOS 14+ arm64 and Windows 11 x64.",
      );
    if (this.installing) return this.installing;
    if (this.pendingVersion) return this.finishUpdate();
    this.error = undefined;
    const generation = this.generation;
    this.installing = (async () => {
      await this.check();
      const manifest = this.updates.available();
      if (!manifest || manifest.id !== "computer-use")
        throw new Error(
          this.updates.status().updateError ??
            "No compatible Computer Use release is available.",
        );
      await this.packs.install(manifest, undefined, { activate: false });
      const lease = await this.helper(manifest.version);
      await this.probe(lease);
      if (generation !== this.generation)
        throw new Error("Computer Use installation cancelled");
      const current = await this.packs.status();
      await atomicWrite(
        this.journal,
        JSON.stringify({
          version: manifest.version,
          previousVersion: current.activeVersion,
        }),
      );
      this.pendingVersion = manifest.version;
      this.previousVersion = current.activeVersion;
      await this.finishUpdate();
    })()
      .catch((error) => {
        this.error = String(error);
        throw error;
      })
      .finally(() => {
        this.installing = undefined;
        this.options.changed?.();
      });
    return this.installing;
  }
  private async probe(lease: ComputerHelperLease): Promise<void> {
    if (this.options.probe) {
      try {
        await this.options.probe(lease);
      } finally {
        lease.release();
      }
      return;
    }
    const driver = new ComputerNativeDriver(
      async () => lease,
      () => {},
    );
    try {
      await driver.permissions();
    } finally {
      await driver.close();
    }
  }
  /** A prepared, verified revision stays pending until the last target is released. */
  finishUpdate(): Promise<void> {
    if (this.activating) return this.activating;
    if (!this.pendingVersion || this.options.busy()) return Promise.resolve();
    const version = this.pendingVersion;
    this.activating = (async () => {
      await this.options.stopHelper();
      const lease = await this.packs.acquire(version);
      try {
        const manifest = lease.manifest as ComputerUsePackManifest;
        // No calls can start while activating; a crash is recovered from the journal.
        await this.packs.activate(version);
        try {
          await this.options.commitPlugin(
            join(lease.root, manifest.pluginRoot),
            version,
          );
        } catch (error) {
          if (this.previousVersion)
            await this.packs.activate(this.previousVersion);
          else {
            lease.release();
            await this.packs.deactivate();
          }
          throw error;
        }
      } finally {
        lease.release();
      }
      await rm(this.journal, { force: true });
      this.pendingVersion = undefined;
      await this.packs.retireInactiveVersions();
      this.error = undefined;
      await this.options.activated?.();
    })()
      .catch((error) => {
        this.error = String(error);
        throw error;
      })
      .finally(() => {
        this.activating = undefined;
        this.options.changed?.();
      });
    return this.activating;
  }
  async ensure(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.finishUpdate();
    if (!(await this.packs.status()).activeVersion) await this.install();
    signal?.throwIfAborted();
  }
  async helper(version?: string): Promise<ComputerHelperLease> {
    const lease = await this.packs.acquire(version);
    const manifest = computerUsePackManifestSchema.parse(lease.manifest);
    if (manifest.id !== "computer-use") {
      lease.release();
      throw new Error("Invalid Computer Use pack identity");
    }
    return {
      path: join(lease.root, manifest.entrypoint),
      release: lease.release,
    };
  }
  cancel(): void {
    this.generation++;
    this.packs.cancel();
  }
  async uninstall(): Promise<void> {
    this.cancel();
    await this.installing?.catch(() => {});
    await this.activating?.catch(() => {});
    await this.options.stopHelper();
    await this.packs.uninstall();
    await rm(this.journal, { force: true });
    this.pendingVersion = undefined;
  }
}
