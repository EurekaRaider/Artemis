import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SafeStorageAdapter } from "./encrypted-settings-store.js";
import type { McpOAuthRecord } from "./mcp-oauth-store.js";
export interface ConnectorSecret {
  binding: string;
  account?: string;
  subject?: string;
  scopes?: string[];
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  appPassword?: string;
  oauth?: McpOAuthRecord;
}
export class ConnectorVault {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly encryption: SafeStorageAdapter,
  ) {}
  get encryptionAvailable() {
    return this.encryption.isEncryptionAvailable();
  }
  private async records(): Promise<Record<string, string>> {
    try {
      const v = JSON.parse(await readFile(this.path, "utf8"));
      if (
        v.version !== 1 ||
        v.kind !== "artemis-connectors" ||
        !v.records ||
        Array.isArray(v.records) ||
        typeof v.records !== "object"
      )
        throw new Error("Connector store is invalid.");
      return v.records;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw e;
    }
  }
  async get(id: string): Promise<ConnectorSecret | undefined> {
    await this.tail;
    const encrypted = (await this.records())[id];
    if (!encrypted) return;
    if (!this.encryptionAvailable)
      throw new Error("OS credential encryption is unavailable.");
    const v = JSON.parse(
      this.encryption.decryptString(Buffer.from(encrypted, "base64")),
    );
    if (!v || typeof v.binding !== "string")
      throw new Error("Connector credential is invalid.");
    return v;
  }
  set(
    id: string,
    value: ConnectorSecret | undefined,
    valid: () => boolean = () => true,
  ): Promise<void> {
    return this.update(id, () => value, valid, false);
  }
  update(
    id: string,
    mutate: (
      current: ConnectorSecret | undefined,
    ) => ConnectorSecret | undefined,
    valid: () => boolean = () => true,
    readCurrent = true,
  ): Promise<void> {
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id))
          throw new Error("Connector connection ID is invalid.");
        const records = await this.records();
        if (!valid())
          throw new Error(
            "Connector was disconnected or authorization cancelled.",
          );
        const current =
          readCurrent && records[id]
            ? (JSON.parse(
                this.encryption.decryptString(
                  Buffer.from(records[id], "base64"),
                ),
              ) as ConnectorSecret)
            : undefined;
        const value = mutate(current);
        if (value && !this.encryptionAvailable)
          throw new Error("OS credential encryption is unavailable.");
        if (value)
          records[id] = this.encryption
            .encryptString(JSON.stringify(value))
            .toString("base64");
        else delete records[id];
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.tmp`;
        await writeFile(
          temporary,
          JSON.stringify({ version: 1, kind: "artemis-connectors", records }),
          { mode: 0o600 },
        );
        await rename(temporary, this.path);
      });
    this.tail = task.catch(() => {});
    return task;
  }
}
