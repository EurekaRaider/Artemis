import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SafeStorageAdapter } from "../src/main/encrypted-settings-store.js";
import { McpSecretStore } from "../src/main/mcp-secret-store.js";

const temporaryDirectories: string[] = [];

const safeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) =>
    Buffer.from(`sealed:${Buffer.from(plainText).toString("base64")}`),
  decryptString: (encrypted) => {
    const value = encrypted.toString();
    if (!value.startsWith("sealed:")) throw new Error("not encrypted");
    return Buffer.from(value.slice("sealed:".length), "base64").toString();
  },
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("MCP secret store", () => {
  it("encrypts stdio environment variables and HTTP headers at rest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-secrets-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "mcp-secrets.json");
    const store = new McpSecretStore(filePath, safeStorage);

    await store.set("context7", {
      env: { CONTEXT7_API_KEY: "ctx-secret" },
      headers: { Authorization: "Bearer remote-secret" },
    });

    const persisted = await readFile(filePath, "utf8");
    expect(persisted).not.toContain("ctx-secret");
    expect(persisted).not.toContain("remote-secret");
    await expect(
      new McpSecretStore(filePath, safeStorage).get("context7"),
    ).resolves.toEqual({
      env: { CONTEXT7_API_KEY: "ctx-secret" },
      headers: { Authorization: "Bearer remote-secret" },
    });
  });

  it("fails closed when OS credential encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-secrets-"));
    temporaryDirectories.push(directory);
    const store = new McpSecretStore(join(directory, "mcp-secrets.json"), {
      ...safeStorage,
      isEncryptionAvailable: () => false,
    });

    await expect(
      store.set("context7", {
        env: { CONTEXT7_API_KEY: "ctx-secret" },
        headers: {},
      }),
    ).rejects.toThrow(/encryption is unavailable/u);
  });

  it("rejects process and header injection bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-secrets-"));
    temporaryDirectories.push(directory);
    const store = new McpSecretStore(
      join(directory, "mcp-secrets.json"),
      safeStorage,
    );

    await expect(
      store.set("context7", {
        env: { CONTEXT7_API_KEY: "secret\0injected" },
        headers: {},
      }),
    ).rejects.toThrow(/environment value is invalid/u);
    await expect(
      store.set("context7", {
        env: {},
        headers: { Authorization: "Bearer secret\r\nX-Injected: yes" },
      }),
    ).rejects.toThrow(/header value is invalid/u);
  });
});
