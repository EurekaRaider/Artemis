import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { satisfies, validRange } from "semver";
import {
  canonicalCapabilityJson,
  capabilityArchiveDownloadUrl,
  capabilityPackManifestSchema,
  type CapabilityPackManifest,
  type CapabilityPackStatus,
} from "@artemis/protocol";
import { extractCapabilityZip } from "./capability-archive.js";
import { atomicWrite, fileSha256 } from "../office/office-file-utils.js";

interface PackServiceOptions {
  root: string;
  /** Pack namespace; defaults to "office-core". One instance manages one pack. */
  packId?: string;
  hostVersion: string;
  platform: string;
  arch: string;
  publicKeys: Readonly<Record<string, string>>;
  verifyNative: (
    directory: string,
    manifest: CapabilityPackManifest,
  ) => Promise<void>;
  dependents: (version: string) => Promise<string[]>;
  fetch?: typeof fetch;
  onProgress?: (status: CapabilityPackStatus) => void;
}

export function verifyCapabilityManifest(
  input: unknown,
  options: Pick<
    PackServiceOptions,
    "hostVersion" | "platform" | "arch" | "publicKeys"
  >,
): CapabilityPackManifest {
  const manifest = capabilityPackManifestSchema.parse(input);
  const { signature, ...unsigned } = manifest;
  const pem = options.publicKeys[signature.keyId];
  if (!pem) throw new Error("Untrusted capability signing key");
  const key = createPublicKey(pem);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    !verify(
      null,
      Buffer.from(canonicalCapabilityJson(unsigned)),
      key,
      Buffer.from(signature.value, "base64"),
    )
  )
    throw new Error("Invalid capability signature");
  if (manifest.platform !== options.platform || manifest.arch !== options.arch)
    throw new Error("Capability platform mismatch");
  if (
    !validRange(manifest.hostRange) ||
    !satisfies(options.hostVersion, manifest.hostRange)
  )
    throw new Error("Capability is incompatible with this Artemis version");
  return manifest;
}

export class CapabilityPackService {
  private controller: AbortController | undefined;
  private pending: Promise<void> | undefined;
  private leases = new Map<string, number>();
  private phase: CapabilityPackStatus["phase"] = "idle";
  private downloadedBytes = 0;
  private totalBytes = 0;
  private error: string | undefined;
  private maintenance = false;
  private acquiring = 0;
  private readonly packId: string;

  constructor(private readonly options: PackServiceOptions) {
    this.packId = options.packId ?? "office-core";
  }

  private versionPath(version: string): string {
    if (!/^\d+\.\d+\.\d+$/u.test(version))
      throw new Error("Invalid capability version");
    return join(this.options.root, this.packId, version);
  }

  private async active(): Promise<string | undefined> {
    try {
      const value = JSON.parse(
        await readFile(join(this.options.root, "active.json"), "utf8"),
      ) as { version?: unknown; packs?: unknown } | null;
      const fromPacks =
        value &&
        typeof value === "object" &&
        value.packs &&
        typeof value.packs === "object"
          ? (value.packs as Record<string, unknown>)[this.packId]
          : undefined;
      // Legacy single-version pointer predates multi-pack support; only
      // office-core reads it and the next write migrates it into the map.
      const version =
        typeof fromPacks === "string"
          ? fromPacks
          : this.packId === "office-core" && typeof value?.version === "string"
            ? value.version
            : undefined;
      if (!version || typeof version !== "string") return undefined;
      this.versionPath(version);
      return version;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      if (
        error instanceof SyntaxError ||
        (error instanceof Error &&
          error.message === "Invalid capability version")
      )
        return undefined;
      throw error;
    }
  }

  /**
   * Pointer file holds one entry per pack so several services can share a
   * root; a torn or missing file repairs through this write.
   */
  private async setActiveVersion(version: string): Promise<void> {
    this.versionPath(version);
    let packs: Record<string, string> = {};
    try {
      const value = JSON.parse(
        await readFile(join(this.options.root, "active.json"), "utf8"),
      ) as { version?: unknown; packs?: unknown } | null;
      if (
        value &&
        typeof value === "object" &&
        value.packs &&
        typeof value.packs === "object"
      )
        packs = { ...(value.packs as Record<string, string>) };
      // The legacy pointer semantically belongs to office-core; preserve it
      // no matter which pack's service performs this write.
      else if (typeof value?.version === "string")
        packs = { "office-core": value.version };
    } catch {
      // Unreadable pointer: nothing salvageable to preserve.
    }
    packs[this.packId] = version;
    await atomicWrite(
      join(this.options.root, "active.json"),
      JSON.stringify({ packs }),
    );
  }

  private async clearActiveVersion(): Promise<void> {
    const path = join(this.options.root, "active.json");
    let value: { version?: unknown; packs?: unknown } | undefined;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      if (error instanceof SyntaxError) {
        await rm(path, { force: true });
        return;
      }
      throw error;
    }
    if (
      value &&
      typeof value === "object" &&
      value.packs &&
      typeof value.packs === "object"
    ) {
      const packs = { ...(value.packs as Record<string, string>) };
      delete packs[this.packId];
      if (Object.keys(packs).length === 0) await rm(path, { force: true });
      else await atomicWrite(path, JSON.stringify({ packs }));
      return;
    }
    // Legacy single-version pointer only ever belonged to office-core.
    if (this.packId === "office-core") await rm(path, { force: true });
  }

  async status(): Promise<CapabilityPackStatus> {
    const activeVersion = await this.active();
    const versions: CapabilityPackStatus["versions"] = [];
    const dependents = new Set<string>();
    for (const version of await readdir(
      join(this.options.root, this.packId),
    ).catch(() => [] as string[])) {
      if (!/^\d+\.\d+\.\d+$/u.test(version)) continue;
      try {
        const manifest = await this.receipt(version);
        versions.push({
          version,
          bytes: manifest.archive.unpackedBytes,
          active: activeVersion === version,
          inUse: (this.leases.get(version) ?? 0) > 0,
        });
        for (const plugin of await this.options.dependents(version))
          dependents.add(plugin);
      } catch {
        /* Invalid receipts cannot advertise an executable installation. */
      }
    }
    return {
      id: this.packId,
      ...(activeVersion &&
      versions.some((entry) => entry.version === activeVersion)
        ? { activeVersion }
        : {}),
      versions,
      dependents: [...dependents],
      phase: this.phase,
      downloadedBytes: this.downloadedBytes,
      totalBytes: this.totalBytes,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private async progress(phase: CapabilityPackStatus["phase"]): Promise<void> {
    this.phase = phase;
    this.options.onProgress?.(await this.status());
  }

  private async receipt(version: string): Promise<CapabilityPackManifest> {
    return verifyCapabilityManifest(
      JSON.parse(
        await readFile(
          join(this.versionPath(version), "manifest.json"),
          "utf8",
        ),
      ),
      this.options,
    );
  }

  private async validateInstallation(
    directory: string,
    manifest: CapabilityPackManifest,
  ): Promise<void> {
    const expected = new Set(manifest.files.map((file) => file.path));
    const inspect = async (path: string, prefix: string): Promise<void> => {
      const info = await lstat(path);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Capability inventory contains an invalid directory");
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory())
          await inspect(join(path, entry.name), `${name}/`);
        else if (!entry.isFile() || !expected.has(name))
          throw new Error(
            "Capability inventory contains an unsigned file or link",
          );
      }
    };
    await inspect(directory, "");
    for (const file of manifest.files) {
      const path = join(directory, file.path);
      // Never follow even an interior symlink: release packaging dereferences links.
      let current = directory;
      for (const part of file.path.split("/")) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Capability contains a symbolic link");
      }
      const info = await lstat(path);
      if (
        !info.isFile() ||
        info.size !== file.bytes ||
        (await fileSha256(path)) !== file.sha256
      )
        throw new Error("Capability installation needs repair");
    }
    await this.options.verifyNative(directory, manifest);
  }

  /** Online and offline bytes enter the same verification and atomic-install path. */
  install(input: unknown, offlineArchive?: string): Promise<void> {
    const manifest = verifyCapabilityManifest(input, this.options);
    return this.startInstall(
      manifest,
      offlineArchive ? { path: offlineArchive, offset: 0 } : undefined,
    );
  }

  /** A single .artemis-office file contains the signed manifest and original ZIP. */
  async installOffline(path: string): Promise<void> {
    if (!(await lstat(path)).isFile())
      throw new Error("Invalid Office offline pack");
    const file = await open(path, "r");
    let manifest: CapabilityPackManifest;
    let offset: number;
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      if (
        bytesRead !== 12 ||
        !header.subarray(0, 8).equals(Buffer.from("ARTOFF1\n"))
      )
        throw new Error("Invalid Office offline pack header");
      const length = header.readUInt32BE(8);
      const info = await file.stat();
      offset = header.length + length;
      if (!length || length > 16 * 1024 * 1024 || offset >= info.size)
        throw new Error("Invalid Office offline manifest size");
      const json = Buffer.alloc(length);
      if (
        (await file.read(json, 0, length, header.length)).bytesRead !== length
      )
        throw new Error("Incomplete Office offline manifest");
      manifest = verifyCapabilityManifest(
        JSON.parse(json.toString("utf8")),
        this.options,
      );
      if (info.size - offset !== manifest.archive.downloadBytes)
        throw new Error("Offline capability size mismatch");
    } finally {
      await file.close();
    }
    await this.startInstall(manifest, { path, offset });
  }

  private startInstall(
    manifest: CapabilityPackManifest,
    offlineArchive?: { path: string; offset: number },
  ): Promise<void> {
    if (this.pending)
      return Promise.reject(
        new Error("A capability installation is already running"),
      );
    if (this.maintenance || this.acquiring)
      return Promise.reject(
        new Error("Capability maintenance is already running"),
      );
    this.maintenance = true;
    this.controller = new AbortController();
    this.error = undefined;
    this.totalBytes = manifest.archive.downloadBytes;
    this.downloadedBytes = 0;
    this.pending = this.installVerified(
      manifest,
      offlineArchive,
      this.controller.signal,
    )
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(async () => {
        this.pending = undefined;
        this.controller = undefined;
        this.maintenance = false;
        await this.progress("idle");
      });
    return this.pending;
  }

  cancel(): void {
    this.controller?.abort(new Error("Capability installation cancelled"));
  }

  private async lock(): Promise<() => Promise<void>> {
    await mkdir(this.options.root, { recursive: true, mode: 0o700 });
    const path = join(this.options.root, ".install.lock");
    const token = randomUUID();
    const candidate = `${path}.${token}`;
    const handle = await open(candidate, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      try {
        // Publish only complete lock records. link is atomic and never replaces
        // another host's lock on either supported platform.
        await link(candidate, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const raw = await readFile(path, "utf8");
        let owner: { pid?: number };
        try {
          owner = JSON.parse(raw) as { pid?: number };
        } catch {
          throw new Error(
            "Capability lock is damaged; its owner cannot be verified",
          );
        }
        if (!Number.isSafeInteger(owner.pid) || owner.pid! <= 0)
          throw new Error("Invalid capability lock");
        try {
          process.kill(owner.pid!, 0);
          throw new Error("Another host is maintaining this capability pack");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
        if ((await readFile(path, "utf8")) !== raw)
          throw new Error("Capability lock changed; retry");
        await rm(path);
        await link(candidate, path);
      }
    } finally {
      await rm(candidate, { force: true });
    }
    return async () => {
      const owner = JSON.parse(await readFile(path, "utf8")) as {
        token: string;
      };
      if (owner.token === token) await rm(path);
    };
  }

  private async maintain(action: () => Promise<void>): Promise<void> {
    if (this.maintenance || this.acquiring)
      throw new Error("Capability maintenance is already running");
    this.maintenance = true;
    try {
      const release = await this.lock();
      try {
        await action();
      } finally {
        await release();
      }
    } finally {
      this.maintenance = false;
    }
  }

  private async installVerified(
    manifest: CapabilityPackManifest,
    offline: { path: string; offset: number } | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const releaseLock = await this.lock();
    const stage = join(this.options.root, `.stage-${randomUUID()}`);
    try {
      const target = this.versionPath(manifest.version);
      let exists = false;
      let installed: CapabilityPackManifest | undefined;
      try {
        const info = await lstat(target);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Invalid capability installation directory");
        exists = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (exists) {
        try {
          installed = await this.receipt(manifest.version);
        } catch {
          if ((this.leases.get(manifest.version) ?? 0) > 0)
            throw new Error("Capability version is in use");
          // Reinstall from the independently verified signed manifest, never from the damaged receipt.
        }
      }
      if (installed) {
        if (installed.archive.sha256 !== manifest.archive.sha256)
          throw new Error(
            "An immutable capability version cannot be republished",
          );
        try {
          await this.validateInstallation(join(target, "payload"), installed);
          signal.throwIfAborted();
          await this.setActiveVersion(manifest.version);
          return;
        } catch (error) {
          if ((this.leases.get(manifest.version) ?? 0) > 0) throw error;
        }
      }
      await mkdir(stage, { mode: 0o700 });
      const archive = join(stage, "download.zip");
      if (offline) {
        await this.progress("verifying");
        const info = await lstat(offline.path);
        if (
          !info.isFile() ||
          info.size !== offline.offset + manifest.archive.downloadBytes
        )
          throw new Error("Offline capability size mismatch");
        await pipeline(
          createReadStream(offline.path, {
            start: offline.offset,
            end: info.size - 1,
          }),
          createWriteStream(archive, { flags: "wx", mode: 0o600 }),
          { signal },
        ).catch((error: unknown) => {
          signal.throwIfAborted();
          throw error;
        });
        this.downloadedBytes = manifest.archive.downloadBytes;
      } else {
        await this.progress("downloading");
        const response = await (this.options.fetch ?? fetch)(
          capabilityArchiveDownloadUrl(manifest.archive.url),
          { signal, redirect: "follow" },
        );
        if (
          !response.ok ||
          !response.body ||
          (response.url && new URL(response.url).protocol !== "https:")
        )
          throw new Error(`Capability download failed: ${response.status}`);
        const file = await open(archive, "wx", 0o600);
        try {
          let lastReport = 0;
          for await (const chunk of response.body) {
            signal.throwIfAborted();
            this.downloadedBytes += chunk.length;
            if (this.downloadedBytes > manifest.archive.downloadBytes)
              throw new Error("Capability download exceeds signed size");
            await file.writeFile(chunk);
            if (Date.now() - lastReport > 200) {
              lastReport = Date.now();
              await this.progress("downloading");
            }
          }
          await file.sync();
        } finally {
          await file.close();
        }
      }
      signal.throwIfAborted();
      await this.progress("verifying");
      const hash = createHash("sha256");
      let bytes = 0;
      for await (const chunk of createReadStream(archive)) {
        signal.throwIfAborted();
        hash.update(chunk);
        bytes += (chunk as Buffer).length;
      }
      if (
        bytes !== manifest.archive.downloadBytes ||
        hash.digest("hex") !== manifest.archive.sha256
      )
        throw new Error("Capability archive digest mismatch");
      const payload = join(stage, "payload");
      await mkdir(payload, { mode: 0o700 });
      await this.progress("installing");
      await extractCapabilityZip(archive, payload, manifest, signal);
      await this.options.verifyNative(payload, manifest);
      await atomicWrite(join(stage, "manifest.json"), JSON.stringify(manifest));
      await rm(archive);
      signal.throwIfAborted();
      await mkdir(join(this.options.root, this.packId), {
        recursive: true,
        mode: 0o700,
      });
      const backup = `${target}.repair-${randomUUID()}`;
      if (exists) await rename(target, backup);
      try {
        await rename(stage, target);
      } catch (error) {
        if (exists) await rename(backup, target);
        throw error;
      }
      await this.setActiveVersion(manifest.version);
      if (exists) await rm(backup, { recursive: true, force: true });
    } finally {
      await rm(stage, { recursive: true, force: true });
      await releaseLock();
    }
  }

  async activate(version: string): Promise<void> {
    await this.maintain(async () => {
      const manifest = await this.receipt(version);
      await this.validateInstallation(
        join(this.versionPath(version), "payload"),
        manifest,
      );
      await this.setActiveVersion(version);
    });
  }

  async deactivate(): Promise<void> {
    await this.maintain(async () => {
      const version = await this.active();
      if (version && (this.leases.get(version) ?? 0) > 0)
        throw new Error("Capability version is in use");
      await this.clearActiveVersion();
    });
  }

  async acquire(): Promise<{
    root: string;
    manifest: CapabilityPackManifest;
    release(): void;
  }> {
    if (this.maintenance)
      throw new Error(
        "Capability maintenance is running; retry after completion",
      );
    this.acquiring++;
    try {
      const version = await this.active();
      if (!version)
        throw new Error(
          "Office capability pack is not installed. Lite workflows remain available.",
        );
      // Take the lease before asynchronous verification, so uninstall cannot race it.
      this.leases.set(version, (this.leases.get(version) ?? 0) + 1);
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          this.leases.set(
            version,
            Math.max(0, (this.leases.get(version) ?? 1) - 1),
          );
        }
      };
      try {
        const manifest = await this.receipt(version);
        const root = join(this.versionPath(version), "payload");
        await this.validateInstallation(root, manifest);
        return { root, manifest, release };
      } catch (error) {
        release();
        throw error;
      }
    } finally {
      this.acquiring--;
    }
  }

  async uninstall(version: string): Promise<void> {
    const path = this.versionPath(version);
    await this.maintain(async () => {
      if ((this.leases.get(version) ?? 0) > 0)
        throw new Error("Capability version is in use");
      // Office dependencies are optional; explicit removal returns them to Lite.
      // The maintenance lock prevents a new document lease during removal.
      if ((await this.active()) === version) await this.clearActiveVersion();
      await rm(path, { recursive: true, force: true });
    });
  }
}
