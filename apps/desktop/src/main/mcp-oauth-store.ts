import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import type { SafeStorageAdapter } from "./encrypted-settings-store.js";

export interface McpOAuthRecord {
  redirectUrl?: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

interface PersistedMcpOAuth {
  version: 1;
  records: Record<string, string>;
}

function validateServerId(serverId: string): string {
  const value = serverId.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) {
    throw new Error("MCP OAuth server ID is invalid");
  }
  return value;
}

export class McpOAuthStore {
  private value: PersistedMcpOAuth | undefined;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter,
  ) {}

  get encryptionAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  async get(serverId: string): Promise<McpOAuthRecord> {
    const encrypted = (await this.load()).records[validateServerId(serverId)];
    if (!encrypted) return {};
    if (!this.encryptionAvailable) {
      throw new Error("OS credential encryption is unavailable");
    }
    const parsed = JSON.parse(
      this.safeStorage.decryptString(Buffer.from(encrypted, "base64")),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MCP OAuth record is invalid");
    }
    return structuredClone(parsed as McpOAuthRecord);
  }

  async update(
    serverId: string,
    updater: (current: McpOAuthRecord) => McpOAuthRecord,
  ): Promise<McpOAuthRecord> {
    if (!this.encryptionAvailable) {
      throw new Error("OS credential encryption is unavailable");
    }
    const id = validateServerId(serverId);
    const next = structuredClone(updater(await this.get(id)));
    const value = await this.load();
    value.records[id] = this.safeStorage
      .encryptString(JSON.stringify(next))
      .toString("base64");
    await this.save(value);
    return next;
  }

  async delete(serverId: string): Promise<void> {
    const value = await this.load();
    delete value.records[validateServerId(serverId)];
    await this.save(value);
  }

  private async load(): Promise<PersistedMcpOAuth> {
    if (this.value) return this.value;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as PersistedMcpOAuth;
      if (
        parsed.version !== 1 ||
        !parsed.records ||
        typeof parsed.records !== "object"
      ) {
        throw new Error("MCP OAuth store is invalid");
      }
      this.value = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.value = { version: 1, records: {} };
    }
    return this.value;
  }

  private async save(value: PersistedMcpOAuth): Promise<void> {
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
