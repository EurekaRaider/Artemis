import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ArtemisGateway } from "@artemis/gateway";
import type { SafeStorageAdapter } from "./encrypted-settings-store.js";

const secretsSchema = z
  .object({
    version: z.literal(1),
    adminToken: z.string().min(32),
    encryptionKey: z.string().min(32),
  })
  .strict();

/** Bundled gateway, bound exclusively to loopback. Nothing is installed or executed in a project. */
export class LocalImGateway {
  private gateway: ArtemisGateway | undefined;
  private starting: Promise<{ url: string; token: string }> | undefined;
  private credential: { url: string; token: string } | undefined;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly directory: string,
    private readonly secure: SafeStorageAdapter,
  ) {}
  get url(): string | undefined {
    return this.credential?.url;
  }
  start(): Promise<{ url: string; token: string }> {
    if (this.closing)
      return Promise.reject(new Error("Gateway is shutting down."));
    if (this.credential) return Promise.resolve(this.credential);
    if (!this.starting)
      this.starting = this.initialize().finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }
  private async initialize(): Promise<{ url: string; token: string }> {
    if (!this.secure.isEncryptionAvailable())
      throw new Error("系统凭据加密不可用，无法启动内置 Gateway。");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, "credentials.enc");
    let secrets: z.infer<typeof secretsSchema>;
    try {
      secrets = secretsSchema.parse(
        JSON.parse(this.secure.decryptString(await readFile(file))),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "内置 Gateway 凭据无法解密，请恢复原系统钥匙串；不会覆盖已有凭据。",
        );
      secrets = {
        version: 1,
        adminToken: randomBytes(32).toString("hex"),
        encryptionKey: randomBytes(32).toString("hex"),
      };
      await writeFile(
        file,
        this.secure.encryptString(JSON.stringify(secrets)),
        { mode: 0o600, flag: "wx" },
      );
    }
    const databasePath = join(this.directory, "gateway.sqlite");
    const gateway = new ArtemisGateway({ databasePath, ...secrets });
    try {
      const port = await gateway.listen(0, "127.0.0.1");
      await chmod(databasePath, 0o600);
      this.gateway = gateway;
      this.credential = {
        url: `http://127.0.0.1:${port}`,
        token: secrets.adminToken,
      };
      return this.credential;
    } catch (error) {
      await gateway.close();
      throw error;
    }
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      await this.starting?.catch(() => undefined);
      await this.gateway?.close();
      this.gateway = undefined;
      this.credential = undefined;
    })().finally(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
}
