import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { SafeStorageAdapter } from "./encrypted-settings-store.js";

export interface McpSecretRecord {
  env: Record<string, string>;
  headers: Record<string, string>;
}

interface PersistedMcpSecrets {
  version: 1;
  records: Record<string, string>;
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u;
const MAX_SECRET_VALUE_BYTES = 32 * 1024;
const MAX_SECRET_ENTRIES = 100;

function validateServerId(serverId: string): string {
  const value = serverId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) {
    throw new Error("MCP secret server ID is invalid");
  }
  return value;
}

function validateSecretMap(
  value: unknown,
  kind: "environment" | "header",
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP secret ${kind} values are invalid`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_SECRET_ENTRIES) {
    throw new Error(`MCP secret ${kind} values exceed the entry limit`);
  }
  const pattern = kind === "environment" ? ENVIRONMENT_NAME : HEADER_NAME;
  return Object.fromEntries(
    entries.map(([name, secret]) => {
      if (
        !pattern.test(name) ||
        typeof secret !== "string" ||
        !secret ||
        secret.includes("\0") ||
        Buffer.byteLength(secret, "utf8") > MAX_SECRET_VALUE_BYTES ||
        (kind === "header" && /[\r\n]/u.test(secret))
      ) {
        throw new Error(`MCP secret ${kind} value is invalid`);
      }
      return [name, secret];
    }),
  );
}

function validateRecord(value: unknown): McpSecretRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP secret record is invalid");
  }
  const record = value as Record<string, unknown>;
  return {
    env: validateSecretMap(record.env ?? {}, "environment"),
    headers: validateSecretMap(record.headers ?? {}, "header"),
  };
}

export class McpSecretStore {
  private value: PersistedMcpSecrets | undefined;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  get encryptionAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  async get(serverId: string): Promise<McpSecretRecord> {
    const records = (await this.load()).records;
    const id = validateServerId(serverId);
    const encrypted = Object.hasOwn(records, id) ? records[id] : undefined;
    if (!encrypted) return { env: {}, headers: {} };
    if (!this.encryptionAvailable) {
      throw new Error("OS credential encryption is unavailable");
    }
    return validateRecord(
      JSON.parse(
        this.safeStorage.decryptString(Buffer.from(encrypted, "base64")),
      ),
    );
  }

  async set(serverId: string, input: McpSecretRecord): Promise<void> {
    if (!this.encryptionAvailable) {
      throw new Error("OS credential encryption is unavailable");
    }
    const id = validateServerId(serverId);
    const record = validateRecord(input);
    const value = await this.load();
    value.records[id] = this.safeStorage
      .encryptString(JSON.stringify(record))
      .toString("base64");
    await this.save(value);
  }

  async delete(serverId: string): Promise<void> {
    const value = await this.load();
    delete value.records[validateServerId(serverId)];
    await this.save(value);
  }

  private async load(): Promise<PersistedMcpSecrets> {
    if (this.value) return this.value;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as PersistedMcpSecrets;
      if (
        parsed.version !== 1 ||
        !parsed.records ||
        typeof parsed.records !== "object" ||
        Array.isArray(parsed.records)
      ) {
        throw new Error("MCP secret store is invalid");
      }
      this.value = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.value = { version: 1, records: {} };
    }
    return this.value;
  }

  private async save(value: PersistedMcpSecrets): Promise<void> {
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
