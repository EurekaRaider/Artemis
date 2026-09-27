import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
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
import { satisfies, validRange } from "semver";
import {
  canonicalCapabilityJson,
  capabilityPackManifestSchema,
  type CapabilityPackManifest,
  type CapabilityPackStatus,
} from "@artemis/protocol";
import { extractCapabilityZip } from "./capability-archive.js";
import { atomicWrite, fileSha256 } from "./office-file-utils.js";

interface PackServiceOptions {
  root: string;
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

  constructor(private readonly options: PackServiceOptions) {}

  private versionPath(version: string): string {
    if (!/^\d+\.\d+\.\d+$/u.test(version))
      throw new Error("Invalid capability version");
    return join(this.options.root, "office-core", version);
  }

  private async active(): Promise<string | undefined> {
    try {
      const value = JSON.parse(
        await readFile(join(this.options.root, "active.json"), "utf8"),
      ) as { version: string };
      if (!value || typeof value.version !== "string") return undefined;
      this.versionPath(value.version);
      return value.version;
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

  async status(): Promise<CapabilityPackStatus> {
    const activeVersion = await this.active();
    const versions: CapabilityPackStatus["versions"] = [];
    const dependents = new Set<string>();
    for (const version of await readdir(
      join(this.options.root, "office-core"),
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
      id: "office-core",
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
    offline: string | undefined,
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
          await atomicWrite(
            join(this.options.root, "active.json"),
            JSON.stringify({ version: manifest.version }),
          );
          return;
        } catch (error) {
          if ((this.leases.get(manifest.version) ?? 0) > 0) throw error;
        }
      }
      await mkdir(stage, { mode: 0o700 });
      const archive = join(stage, "download.zip");
      if (offline) {
        if (
          !(await lstat(offline)).isFile() ||
          (await lstat(offline)).size !== manifest.archive.downloadBytes
        )
          throw new Error("Offline capability size mismatch");
        await copyFile(offline, archive);
      } else {
        await this.progress("downloading");
        const response = await (this.options.fetch ?? fetch)(
          manifest.archive.url,
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
      await mkdir(join(this.options.root, "office-core"), {
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
      await atomicWrite(
        join(this.options.root, "active.json"),
        JSON.stringify({ version: manifest.version }),
      );
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
      await atomicWrite(
        join(this.options.root, "active.json"),
        JSON.stringify({ version }),
      );
    });
  }

  async deactivate(): Promise<void> {
    await this.maintain(async () => {
      const version = await this.active();
      if (version && (this.leases.get(version) ?? 0) > 0)
        throw new Error("Capability version is in use");
      await rm(join(this.options.root, "active.json"), { force: true });
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
    await this.maintain(async () => {
      if ((this.leases.get(version) ?? 0) > 0)
        throw new Error("Capability version is in use");
      const dependents =
        (await this.active()) === version
          ? await this.options.dependents(version)
          : [];
      if (dependents.length)
        throw new Error(`Capability is shared by: ${dependents.join(", ")}`);
      if ((this.leases.get(version) ?? 0) > 0)
        throw new Error("Capability version is in use");
      if ((await this.active()) === version)
        await rm(join(this.options.root, "active.json"), { force: true });
      await rm(this.versionPath(version), { recursive: true, force: true });
    });
  }
}
