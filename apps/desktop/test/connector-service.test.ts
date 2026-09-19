import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorService,
  connectorBinding,
} from "../src/main/connector-service.js";
import { ConnectorVault } from "../src/main/connector-vault.js";
import type { McpServerConfig } from "../src/shared/api.js";

const directories: string[] = [];
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Buffer.from(s).toString("base64")),
  decryptString: (b: Buffer) => Buffer.from(b.toString(), "base64").toString(),
};
const google: McpServerConfig = {
  id: "gmail",
  name: "Gmail",
  transport: "stdio",
  enabled: false,
  command: "node",
  args: ["server.mjs"],
  env: {},
  envVars: [],
  allowNetwork: true,
  workspacePath: "/tmp",
  connector: {
    version: 1,
    id: "gmail",
    provider: "google",
    displayName: "Gmail",
    auth: "oauth-pkce",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
  },
};
const qq: McpServerConfig = {
  ...google,
  id: "qq",
  connector: {
    version: 1,
    id: "qq-mail",
    provider: "qq",
    displayName: "QQ Mail",
    auth: "app-password",
    scopes: [],
  },
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});
async function setup(config: McpServerConfig = google) {
  const directory = await mkdtemp(join(tmpdir(), "connector-tests-"));
  directories.push(directory);
  const vault = new ConnectorVault(
    join(directory, "connector-credentials-v1.json"),
    encryption,
  );
  const options = {
    vault,
    clients: { version: 1 as const, google: { clientId: "public-id" } },
    openExternal: vi.fn(async (_url: string) => {}),
    fetcher: vi.fn<typeof fetch>(),
    configs: async () => [config],
    assertTrusted: vi.fn(async () => {}),
    connectMcp: vi.fn(async () => {}),
    disconnectMcp: vi.fn(async () => {}),
    checkMailbox: vi.fn(async () => {}),
  };
  return { directory, vault, options, service: new ConnectorService(options) };
}
describe("connector credential and execution boundary", () => {
  it("completes browser PKCE, verifies identity and keeps refresh tokens out of public state", async () => {
    const { service, options, vault } = await setup();
    let challenge = "";
    options.openExternal.mockImplementation(async (value) => {
      const url = new URL(value);
      expect(url.origin).toBe("https://accounts.google.com");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      challenge = url.searchParams.get("code_challenge")!;
      const redirect = new URL(url.searchParams.get("redirect_uri")!);
      redirect.search = new URLSearchParams({
        code: "verified-code",
        state: url.searchParams.get("state")!,
      }).toString();
      expect((await fetch(redirect)).status).toBe(200);
    });
    options.fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/token")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code")).toBe("verified-code");
        expect(
          createHash("sha256")
            .update(body.get("code_verifier")!)
            .digest("base64url"),
        ).toBe(challenge);
        return Response.json({
          access_token: "private-access",
          refresh_token: "private-refresh",
          expires_in: 3600,
          scope: google.connector!.scopes.join(" "),
        });
      }
      return Response.json({
        sub: "verified-subject",
        email: "demo@example.test",
        email_verified: true,
      });
    });
    expect(await service.connect({ serverId: "gmail" })).toMatchObject({
      account: "demo@example.test",
      state: "connected",
    });
    expect((await vault.get("gmail"))?.refreshToken).toBe("private-refresh");
    expect(JSON.stringify(await service.list())).not.toContain("private-");
  });

  it("rejects partial grants before obtaining an account or enabling tools", async () => {
    const { service, options, vault } = await setup();
    options.openExternal.mockImplementation(async (value) => {
      const url = new URL(value),
        callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({
        code: "code",
        state: url.searchParams.get("state")!,
      }).toString();
      await fetch(callback);
    });
    options.fetcher.mockResolvedValue(
      Response.json({
        access_token: "private-access",
        refresh_token: "private-refresh",
        scope: "openid email profile",
      }),
    );
    await expect(service.connect({ serverId: "gmail" })).rejects.toThrow(
      /Required permissions/,
    );
    expect(options.fetcher).toHaveBeenCalledTimes(1);
    expect(options.connectMcp).not.toHaveBeenCalled();
    expect(await vault.get("gmail")).toBeUndefined();
  });

  it("closes a cancelled browser callback without exchanging a code", async () => {
    const { service, options } = await setup();
    let redirect = "";
    options.openExternal.mockImplementation(async (value) => {
      redirect = new URL(value).searchParams.get("redirect_uri")!;
      service.cancel("gmail");
    });
    await expect(service.connect({ serverId: "gmail" })).rejects.toThrow(
      /cancelled/,
    );
    expect(options.fetcher).not.toHaveBeenCalled();
    await expect(fetch(redirect)).rejects.toThrow();
  });

  it("separates standard MCP credentials and rejects hostile discovery endpoints", async () => {
    const notion: McpServerConfig = {
      id: "notion",
      name: "Notion",
      transport: "streamable-http",
      enabled: false,
      url: "https://mcp.notion.com/mcp",
      auth: "oauth",
      connector: {
        version: 1,
        id: "notion",
        provider: "notion",
        displayName: "Notion",
        auth: "mcp-oauth",
        scopes: [],
      },
    };
    const { options, vault } = await setup(notion);
    const service = new ConnectorService({
      ...options,
      connectMcp: async (_config, authentication) => {
        if (authentication?.authorizationCode) {
          await authentication.oauthProvider!.saveTokens!({
            access_token: "private-mcp",
            token_type: "bearer",
            refresh_token: "private-refresh",
          });
        }
      },
    });
    await service.connect({ serverId: "notion" });
    const auth = await service.authentication(notion);
    await expect(auth!.fetch!("https://evil.example/token")).rejects.toThrow(
      /Untrusted/,
    );
    expect(options.fetcher).not.toHaveBeenCalled();
    await service.disconnect("notion");
    await expect(
      auth!.oauthProvider!.saveTokens!({
        access_token: "late-token",
        token_type: "bearer",
      }),
    ).rejects.toThrow(/disconnected/);
    expect(await vault.get("notion")).toBeUndefined();
  });
  it("starts only one authorization when connect requests arrive together", async () => {
    const { service, options } = await setup(qq);
    const completions: Array<() => void> = [];
    options.checkMailbox.mockImplementation(
      () => new Promise((resolve) => completions.push(resolve)),
    );
    const input = {
      serverId: "qq",
      email: "demo@qq.com",
      appPassword: "abcdefghijklmnop",
    };
    const results = Promise.allSettled([
      service.connect(input),
      service.connect(input),
    ]);
    await vi.waitFor(() => expect(options.checkMailbox).toHaveBeenCalled());
    completions.forEach((finish) => finish());
    const settled = await results;
    expect(
      settled.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(options.checkMailbox).toHaveBeenCalledOnce();
  });

  it("rejects token persistence immediately when remote authorization is cancelled", async () => {
    const notion: McpServerConfig = {
      id: "notion",
      name: "Notion",
      enabled: false,
      transport: "streamable-http",
      url: "https://mcp.notion.com/mcp",
      connector: {
        version: 1,
        id: "notion",
        provider: "notion",
        displayName: "Notion",
        auth: "mcp-oauth",
        scopes: [],
      },
    };
    const { options, vault } = await setup(notion);
    let save!: () => Promise<void>;
    let finish!: () => void;
    const service = new ConnectorService({
      ...options,
      connectMcp: async (_config, auth) => {
        save = async () => {
          await auth!.oauthProvider!.saveTokens!({
            access_token: "late-private-token",
            token_type: "bearer",
          });
        };
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    const pending = service.connect({ serverId: "notion" });
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(save).toBeDefined());
    service.cancel("notion");
    try {
      await expect(save()).rejects.toThrow(/disconnected/);
    } finally {
      finish();
      await rejected;
    }
    expect(await vault.get("notion")).toBeUndefined();
  });

  it("does not read or alter historical credentials and seals new records", async () => {
    const { directory, vault, service } = await setup(qq);
    const historical = join(directory, "google-account.json");
    await writeFile(historical, "historical-user-data");
    expect((await service.list())[0]?.state).toBe("disconnected");
    await service.connect({
      serverId: "qq",
      email: "user@qq.com",
      appPassword: "abcdefghijklmnop",
    });
    const disk = await readFile(
      join(directory, "connector-credentials-v1.json"),
      "utf8",
    );
    expect(disk).not.toContain("abcdefghijklmnop");
    expect(disk).not.toContain("user@qq.com");
    await service.disconnect("qq");
    expect(await vault.get("qq")).toBeUndefined();
    expect(await readFile(historical, "utf8")).toBe("historical-user-data");
  });
  it("rejects untrusted plugins before opening a browser or giving an adapter credentials", async () => {
    const { service, options } = await setup(qq);
    options.assertTrusted.mockRejectedValue(new Error("Untrusted"));
    await expect(
      service.connect({
        serverId: "qq",
        email: "user@qq.com",
        appPassword: "abcdefghijklmnop",
      }),
    ).rejects.toThrow("Untrusted");
    expect(options.openExternal).not.toHaveBeenCalled();
    expect(options.checkMailbox).not.toHaveBeenCalled();
  });
  it("rejects credential reuse after configuration or scope tampering", async () => {
    const { service, vault } = await setup();
    await vault.set("gmail", {
      binding: connectorBinding(google),
      accessToken: "private-access",
    });
    await expect(
      service.context({
        ...google,
        args: ["untrusted.mjs"],
      } as McpServerConfig),
    ).rejects.toThrow(/Connect this account/);
    await expect(
      service.context({ ...google, id: "different" }),
    ).rejects.toThrow(/Connect this account/);
  });
  it("coalesces refreshes and retains credentials after a network error", async () => {
    const { service, vault, options } = await setup();
    const secret = {
      binding: connectorBinding(google),
      accessToken: "expired-token",
      refreshToken: "private-refresh",
      expiresAt: 1,
    };
    await vault.set("gmail", secret);
    options.fetcher.mockRejectedValueOnce(new TypeError("offline"));
    await expect(service.context(google)).rejects.toThrow("offline");
    expect(await vault.get("gmail")).toEqual(secret);
    options.fetcher.mockResolvedValue(
      Response.json({
        access_token: "renewed-token",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      }),
    );
    const contexts = await Promise.all(
      Array.from({ length: 8 }, () => service.context(google)),
    );
    expect(options.fetcher).toHaveBeenCalledTimes(2);
    expect(
      contexts.every((context) => context.accessToken === "renewed-token"),
    ).toBe(true);
    expect(JSON.stringify(contexts)).not.toContain("rotated-refresh");
  });
  it("revocation requires reconnect and never returns an expired token", async () => {
    const { service, vault, options } = await setup();
    await vault.set("gmail", {
      binding: connectorBinding(google),
      refreshToken: "private-refresh",
    });
    options.fetcher.mockResolvedValue(
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    await expect(service.context(google)).rejects.toThrow(/Reconnect/);
    expect(await vault.get("gmail")).toBeUndefined();
    expect((await service.list())[0]?.state).toBe("authorization-required");
  });
  it("discarding an in-flight refresh cannot resurrect a disconnected connection", async () => {
    const { service, vault, options } = await setup();
    await vault.set("gmail", {
      binding: connectorBinding(google),
      refreshToken: "private-refresh",
    });
    let finish!: (response: Response) => void;
    options.fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.context(google);
    const rejected = expect(pending).rejects.toThrow(/disconnected/);
    await vi.waitFor(() => expect(options.fetcher).toHaveBeenCalled());
    await service.disconnect("gmail");
    finish(Response.json({ access_token: "late-token" }));
    await rejected;
    expect(await vault.get("gmail")).toBeUndefined();
  });
  it("cancels pending mailbox validation without keeping credentials", async () => {
    const { service, vault, options } = await setup(qq);
    let finish!: () => void;
    options.checkMailbox.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const connecting = service.connect({
      serverId: "qq",
      email: "user@qq.com",
      appPassword: "abcdefghijklmnop",
    });
    const rejected = expect(connecting).rejects.toThrow();
    await vi.waitFor(() => expect(options.checkMailbox).toHaveBeenCalled());
    service.cancel("qq");
    finish();
    await rejected;
    expect(await vault.get("qq")).toBeUndefined();
    expect(options.connectMcp).not.toHaveBeenCalled();
  });
  it("encrypts concurrent vault writes without dropping other connections", async () => {
    const { vault } = await setup();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        vault.set(`conn-${i}`, {
          binding: String(i),
          accessToken: `secret-${i}`,
        }),
      ),
    );
    expect(
      (
        await Promise.all(
          Array.from({ length: 12 }, (_, i) => vault.get(`conn-${i}`)),
        )
      ).every(Boolean),
    ).toBe(true);
  });
});
