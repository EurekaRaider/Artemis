import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImService, type ImTaskOperations } from "../src/main/im-service.js";

const roots: string[] = [],
  services: ImService[] = [];
const secure = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) =>
    Buffer.from(`test-cipher:${Buffer.from(s).toString("base64")}`),
  decryptString: (s: Buffer) => {
    if (!s.toString().startsWith("test-cipher:"))
      throw new Error("locked keychain");
    return Buffer.from(s.toString().slice(12), "base64").toString();
  },
};
const ops: ImTaskOperations = {
  projects: () => [],
  threads: () => [],
  thread: () => undefined,
  ready: () => true,
  events: () => [],
  create: async () => {
    throw new Error("Setup must not start tasks");
  },
  close: async () => {},
  start: async () => {},
  queue: async () => {},
  cancel: async () => {},
  approve: async () => {},
  answer: () => {},
};
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(encryption = true) {
  const root = await mkdtemp(join(tmpdir(), "artemis-local-gateway-"));
  roots.push(root);
  const service = new ImService(
    root,
    { ...secure, isEncryptionAvailable: () => encryption },
    ops,
  );
  services.push(service);
  return { root, service };
}
describe("Built-in Gateway setup", () => {
  it("starts and registers exactly once without granting project access or exposing secrets", async () => {
    const { root, service } = await fixture();
    const results = await Promise.all([
      service.manage({ action: "setup-local" }),
      service.manage({ action: "setup-local" }),
    ]);
    expect(results[0]).toEqual(results[1]);
    const status = service.status();
    expect(status.localGateway?.state).toBe("running");
    expect(status.settings).toMatchObject({ enabled: false, grants: [] });
    expect(status.settings.deviceId).not.toBe("");
    expect(new URL(status.settings.gatewayUrl).hostname).toBe("127.0.0.1");
    expect(
      await (await fetch(`${status.settings.gatewayUrl}/health`)).json(),
    ).toMatchObject({ ok: true });
    expect(
      (await fetch(`${status.settings.gatewayUrl}/v1/admin/status`)).status,
    ).toBe(401);
    await service.manage({ action: "setup-local" });
    const admin = (await service.manage({
      action: "admin",
      operation: "status",
    })) as { devices: unknown[] };
    expect(admin.devices).toHaveLength(1);
    const encrypted = await readFile(join(root, "im-gateway/credentials.enc"));
    const secrets = JSON.parse(secure.decryptString(encrypted));
    expect(secrets.adminToken).not.toBe(secrets.encryptionKey);
    expect(encrypted.toString()).not.toContain(secrets.adminToken);
    expect(JSON.stringify(status)).not.toContain(secrets.adminToken);
    expect(JSON.stringify(status)).not.toContain(secrets.encryptionKey);
    expect(await service.manage({ action: "pair" })).toHaveProperty("code");
  });
  it("restores the same device and credentials on restart, with a new private listener", async () => {
    const { root, service } = await fixture();
    await service.manage({ action: "setup-local" });
    const before = service.status();
    const encrypted = await readFile(join(root, "im-gateway/credentials.enc"));
    await service.close();
    services.splice(services.indexOf(service), 1);
    await expect(
      fetch(`${before.settings.gatewayUrl}/health`),
    ).rejects.toThrow();
    const restored = new ImService(root, secure, ops);
    services.push(restored);
    restored.start();
    await expect
      .poll(() => restored.status().localGateway?.state)
      .toBe("running");
    expect(restored.status().settings.deviceId).toBe(before.settings.deviceId);
    expect(await readFile(join(root, "im-gateway/credentials.enc"))).toEqual(
      encrypted,
    );
    expect(await restored.manage({ action: "pair" })).toHaveProperty("code");
    expect(
      (
        (await restored.manage({ action: "admin", operation: "status" })) as {
          devices: unknown[];
        }
      ).devices,
    ).toHaveLength(1);
  });
  it("fails closed when OS encryption is unavailable", async () => {
    const { root, service } = await fixture(false);
    await expect(service.manage({ action: "setup-local" })).rejects.toThrow(
      "加密不可用",
    );
    expect(service.status().settings.deviceId).toBe("");
    await expect(
      readFile(join(root, "im-gateway/credentials.enc")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not overwrite credentials when the keychain cannot decrypt them", async () => {
    const { root, service } = await fixture();
    await service.manage({ action: "setup-local" });
    await service.close();
    services.splice(services.indexOf(service), 1);
    const file = join(root, "im-gateway/credentials.enc");
    await writeFile(file, "locked-keychain-fixture");
    const restored = new ImService(root, secure, ops);
    services.push(restored);
    await expect(restored.manage({ action: "setup-local" })).rejects.toThrow(
      "不会覆盖",
    );
    expect(await readFile(file, "utf8")).toBe("locked-keychain-fixture");
  });
  it("requires explicit credentials for an external Gateway admin action", async () => {
    const { service } = await fixture();
    await expect(
      service.manage({ action: "admin", operation: "status" }),
    ).rejects.toThrow("管理员凭据");
  });
});
