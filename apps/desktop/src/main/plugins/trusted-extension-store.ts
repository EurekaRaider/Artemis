import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute } from "node:path";

export interface TrustedExtensionConfig {
  id: string;
  name: string;
  path: string;
  sha256: string;
  enabled: boolean;
  allowNetwork: boolean;
  trustedAt: string;
}

interface PersistedTrustedExtensions {
  version: 1;
  extensions: TrustedExtensionConfig[];
}

const EXTENSION_SUFFIXES = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".mts",
  ".cts",
]);

function validateId(value: string): string {
  if (!/^[a-f0-9]{24}$/u.test(value)) {
    throw new Error("Trusted extension ID is invalid");
  }
  return value;
}

function validateConfig(input: TrustedExtensionConfig): TrustedExtensionConfig {
  if (!isAbsolute(input.path)) {
    throw new Error("Trusted extension path must be absolute");
  }
  if (!/^[a-f0-9]{64}$/u.test(input.sha256)) {
    throw new Error("Trusted extension hash is invalid");
  }
  if (!input.name.trim() || input.name.length > 120) {
    throw new Error("Trusted extension name is invalid");
  }
  return {
    ...structuredClone(input),
    id: validateId(input.id),
    name: input.name.trim(),
  };
}

async function canonicalExtensionPath(inputPath: string): Promise<string> {
  if (!isAbsolute(inputPath)) {
    throw new Error("Trusted extension path must be absolute");
  }
  const canonicalPath = await realpath(inputPath);
  const information = await stat(canonicalPath);
  if (
    !information.isFile() ||
    !EXTENSION_SUFFIXES.has(extname(canonicalPath).toLowerCase())
  ) {
    throw new Error(
      "Trusted extension must be a JavaScript or TypeScript file",
    );
  }
  return canonicalPath;
}

export async function hashExtensionFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export class TrustedExtensionStore {
  private value: PersistedTrustedExtensions | undefined;

  constructor(private readonly filePath: string) {}

  async list(): Promise<TrustedExtensionConfig[]> {
    return structuredClone((await this.load()).extensions);
  }

  async trust(
    inputPath: string,
    options?: { name?: string; allowNetwork?: boolean },
  ): Promise<TrustedExtensionConfig> {
    const path = await canonicalExtensionPath(inputPath);
    const id = createHash("sha256")
      .update(path.toLowerCase())
      .digest("hex")
      .slice(0, 24);
    const config: TrustedExtensionConfig = {
      id,
      name: options?.name?.trim() || basename(path),
      path,
      sha256: await hashExtensionFile(path),
      enabled: true,
      allowNetwork: options?.allowNetwork ?? false,
      trustedAt: new Date().toISOString(),
    };
    const value = await this.load();
    const index = value.extensions.findIndex(
      (extension) => extension.id === id,
    );
    if (index >= 0) value.extensions[index] = config;
    else value.extensions.push(config);
    await this.save(value);
    return structuredClone(config);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const value = await this.load();
    const extension = value.extensions.find(
      (candidate) => candidate.id === validateId(id),
    );
    if (!extension) throw new Error("Trusted extension was not found");
    extension.enabled = enabled;
    await this.save(value);
  }

  async setAllowNetwork(id: string, allowNetwork: boolean): Promise<void> {
    const value = await this.load();
    const extension = value.extensions.find(
      (candidate) => candidate.id === validateId(id),
    );
    if (!extension) throw new Error("Trusted extension was not found");
    extension.allowNetwork = allowNetwork;
    await this.save(value);
  }

  async remove(id: string): Promise<void> {
    const value = await this.load();
    value.extensions = value.extensions.filter(
      (extension) => extension.id !== validateId(id),
    );
    await this.save(value);
  }

  private async load(): Promise<PersistedTrustedExtensions> {
    if (this.value) return this.value;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as PersistedTrustedExtensions;
      if (parsed.version !== 1 || !Array.isArray(parsed.extensions)) {
        throw new Error("Trusted extension configuration is invalid");
      }
      this.value = {
        version: 1,
        extensions: parsed.extensions.map(validateConfig),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.value = { version: 1, extensions: [] };
    }
    return this.value;
  }

  private async save(value: PersistedTrustedExtensions): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
    this.value = value;
  }
}
