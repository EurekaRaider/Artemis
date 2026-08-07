import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SafeStorageAdapter } from "../src/main/encrypted-settings-store.js";
import {
  SecureMcpOAuthProvider,
  startMcpOAuthCallback,
} from "../src/main/mcp-oauth-provider.js";
import { McpOAuthStore } from "../src/main/mcp-oauth-store.js";

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

async function createStore(): Promise<{
  filePath: string;
  store: McpOAuthStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-oauth-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, "mcp-oauth.json");
  return { filePath, store: new McpOAuthStore(filePath, safeStorage) };
}

describe("MCP OAuth", () => {
  it("encrypts and restores client registration, tokens, and the PKCE verifier", async () => {
    const { filePath, store } = await createStore();
    const provider = new SecureMcpOAuthProvider(
      "github",
      "http://127.0.0.1:4242/mcp-oauth/github",
      store,
      vi.fn(),
    );

    await provider.saveClientInformation({
      client_id: "client-secret-id",
      client_secret: "dynamic-secret",
    });
    await provider.saveTokens({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      token_type: "bearer",
    });
    await provider.saveCodeVerifier("pkce-secret");

    const persisted = await readFile(filePath, "utf8");
    expect(persisted).not.toContain("client-secret-id");
    expect(persisted).not.toContain("dynamic-secret");
    expect(persisted).not.toContain("access-secret");
    expect(persisted).not.toContain("refresh-secret");
    expect(persisted).not.toContain("pkce-secret");

    const reopened = new SecureMcpOAuthProvider(
      "github",
      provider.redirectUrl,
      new McpOAuthStore(filePath, safeStorage),
      vi.fn(),
    );
    expect(await reopened.clientInformation()).toMatchObject({
      client_id: "client-secret-id",
      client_secret: "dynamic-secret",
    });
    expect(await reopened.tokens()).toMatchObject({
      access_token: "access-secret",
      refresh_token: "refresh-secret",
    });
    expect(await reopened.codeVerifier()).toBe("pkce-secret");
  });

  it("accepts only an exact loopback callback path and OAuth state", async () => {
    const callback = await startMcpOAuthCallback(
      "test-server",
      (state) => state === "expected-state",
    );
    try {
      expect(
        (await fetch(`${callback.redirectUrl}/wrong?code=nope`)).status,
      ).toBe(404);
      const response = await fetch(
        `${callback.redirectUrl}?code=authorization-code&state=expected-state`,
      );
      expect(response.status).toBe(200);
      await expect(callback.authorizationCode).resolves.toBe(
        "authorization-code",
      );
    } finally {
      await callback.close();
    }
  });
});
