import {
  futureConnector,
  futureRemoteConnector,
  futureOwner,
} from "../../fixtures/connector-oauth.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectorService,
  connectorBinding,
} from "../../../src/main/connectors/connector-service.js";
import { ConnectorVault } from "../../../src/main/connectors/connector-vault.js";
import type { McpServerConfig } from "../../../src/shared/api.js";

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
  connector: futureConnector,
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
    openExternal: vi.fn(async (_url: string) => {}),
    fetcher: vi.fn<typeof fetch>(),
    configs: async () => [config],
    assertTrusted: vi.fn(async () => futureOwner),
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
      expect(url.origin).toBe("https://identity.example.com");
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
          token_type: "Bearer",
          access_token: "private-access",
          refresh_token: "private-refresh",
          expires_in: 3600,
          scope: google.connector!.scopes.join(" "),
        });
      }
      return Response.json({
        id: "verified-subject",
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
        token_type: "Bearer",
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
      connector: futureRemoteConnector,
    };
    const { options, vault } = await setup(notion);
    const service = new ConnectorService({
      ...options,
      connectMcp: async (_config, authentication) => {
        if (authentication?.authorizationCode) {
          await authentication.oauthProvider!.saveTokens!({
            token_type: "Bearer",
            access_token: "private-mcp",
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
        token_type: "Bearer",
        access_token: "late-token",
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
      connector: futureRemoteConnector,
    };
    const { options, vault } = await setup(notion);
    let save!: () => Promise<void>;
    let finish!: () => void;
    const service = new ConnectorService({
      ...options,
      connectMcp: async (_config, auth) => {
        save = async () => {
          await auth!.oauthProvider!.saveTokens!({
            token_type: "Bearer",
            access_token: "late-private-token",
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
      binding: connectorBinding(google, futureOwner),
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
      binding: connectorBinding(google, futureOwner),
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
        token_type: "Bearer",
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
      binding: connectorBinding(google, futureOwner),
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
      binding: connectorBinding(google, futureOwner),
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
    finish(Response.json({ token_type: "Bearer", access_token: "late-token" }));
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

it("cleans only known legacy OAuth credentials and preserves QQ Mail", async () => {
  const legacy = {
    ...google,
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
  } as McpServerConfig;
  const { options, vault } = await setup(legacy);
  options.configs = async () => [legacy, qq];
  const service = new ConnectorService(options);
  await vault.set(legacy.id, { binding: "old", refreshToken: "obsolete" });
  await vault.set(qq.id, {
    binding: connectorBinding(qq),
    appPassword: "abcdefghijklmnop",
  });
  await service.migrateLegacyConnections();
  expect(await vault.get(legacy.id)).toBeUndefined();
  expect((await vault.get(qq.id))?.appPassword).toBe("abcdefghijklmnop");
  await expect(service.connect({ serverId: legacy.id })).rejects.toThrow(
    /Update the plugin/,
  );
});

it("rejects credential reuse after signing identity changes", async () => {
  const { options, vault, service } = await setup();
  await vault.set(google.id, {
    binding: connectorBinding(google, futureOwner),
    accessToken: "old-access",
  });
  options.assertTrusted.mockResolvedValue({
    ...futureOwner,
    signingKeyFingerprint: "different-signer",
  });
  await expect(service.context(google)).rejects.toThrow(/Connect this account/);
});

it("preserves the pre-v2 QQ credential binding byte-for-byte", () => {
  const old = createHash("sha256")
    .update(
      JSON.stringify({
        id: qq.id,
        connector: qq.connector,
        transport: qq.transport,
        target:
          qq.transport === "stdio"
            ? [qq.command, qq.args, qq.env, qq.envVars, qq.workspacePath]
            : qq.url,
      }),
    )
    .digest("hex");
  expect(connectorBinding(qq)).toBe(old);
});

it("completes device authorization with an independent backend token and resource binding", async () => {
  const config: McpServerConfig = {
    ...google,
    connector: {
      ...futureConnector,
      auth: "device-code",
      oauth: {
        ...futureConnector.oauth!,
        deviceAuthorizationEndpoint: "https://identity.example.com/device",
        verificationOrigins: ["https://identity.example.com/"],
        backend: {
          operator: "Test backend",
          url: "https://identity.example.com/",
        },
      },
    },
  };
  const { service, options, vault } = await setup(config);
  options.fetcher.mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/device"))
      return Response.json({
        device_code: "private-device",
        user_code: "ABCD-EFGH",
        verification_uri: "https://identity.example.com/activate",
        expires_in: 60,
        interval: 1,
      });
    if (url.endsWith("/token")) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("resource")).toBe("https://api.example.com/");
      expect(body.get("client_secret")).toBeNull();
      return Response.json({
        token_type: "Bearer",
        access_token: "backend-resource-token",
        expires_in: 120,
        scope: "records.read",
      });
    }
    return Response.json({ id: "test-account", email: "test@example.com" });
  });
  await expect(service.connect({ serverId: config.id })).resolves.toMatchObject(
    { state: "connected" },
  );
  expect(options.openExternal).toHaveBeenCalledWith(
    "https://identity.example.com/activate",
    expect.any(AbortSignal),
  );
  expect((await vault.get(config.id))?.expiresAt).toBeGreaterThan(Date.now());
  expect((await service.context(config)).accessToken).toBe(
    "backend-resource-token",
  );
  const changed = {
    ...config,
    connector: {
      ...config.connector!,
      oauth: {
        ...config.connector!.oauth!,
        resource: "https://other.example.com/",
      },
    },
  };
  await expect(service.context(changed)).rejects.toThrow(
    /Connect this account/,
  );
}, 10000);

it("rejects a device verification address outside the declared authorization origin", async () => {
  const config: McpServerConfig = {
    ...google,
    connector: {
      ...futureConnector,
      auth: "device-code",
      oauth: {
        ...futureConnector.oauth!,
        deviceAuthorizationEndpoint: "https://identity.example.com/device",
        verificationOrigins: ["https://identity.example.com/"],
      },
    },
  };
  const { service, options } = await setup(config);
  options.fetcher.mockResolvedValue(
    Response.json({
      device_code: "private-device",
      user_code: "CODE",
      verification_uri: "https://attacker.example.com/activate",
    }),
  );
  await expect(service.connect({ serverId: config.id })).rejects.toThrow(
    /Invalid device/,
  );
  expect(options.openExternal).not.toHaveBeenCalled();
});

it("restricts remote discovery, registration, and credential destinations independently", async () => {
  const config: McpServerConfig = {
    id: "notion",
    name: "Remote",
    transport: "streamable-http",
    enabled: false,
    url: futureRemoteConnector.oauth!.mcpEndpoint!,
    connector: futureRemoteConnector,
  };
  const { service, options, vault } = await setup(config);
  await vault.set(config.id, {
    binding: connectorBinding(config, futureOwner),
    oauth: {
      redirectUrl: "http://127.0.0.1:12345/callback",
      tokens: { token_type: "Bearer", access_token: "private" },
    },
  });
  const authentication = await service.authentication(config);
  const request = authentication!.fetch!;
  const discovery = config.connector!.oauth!.discoveryUrls![0]!;
  await expect(
    request(discovery, { headers: { authorization: "Bearer private" } }),
  ).rejects.toThrow(/Credentials/);
  await expect(
    request(discovery, { method: "POST", body: "code=private" }),
  ).rejects.toThrow(/read-only/);
  await expect(request("https://attacker.example.com/token")).rejects.toThrow(
    /Untrusted/,
  );
  expect(options.fetcher).not.toHaveBeenCalled();
  options.fetcher.mockResolvedValueOnce(
    Response.json({ issuer: "https://attacker.example.com/" }),
  );
  await expect(request(discovery)).rejects.toThrow(/issuer changed/);
  options.fetcher.mockResolvedValueOnce(
    new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example.com/" },
    }),
  );
  await expect(request(discovery)).rejects.toThrow(/redirects/);
  options.fetcher.mockResolvedValueOnce(
    Response.json(
      {
        error: "invalid_grant",
        error_description: "private-code private-refresh private-verifier",
      },
      { status: 400 },
    ),
  );
  const rejected = await request(config.connector!.oauth!.tokenEndpoint, {
    method: "POST",
    body: "grant_type=authorization_code",
  });
  expect(await rejected.text()).not.toContain("private-");
});

it.each(["static", "dynamic", "metadata"] as const)(
  "uses the MCP SDK with %s public registration and resource-bound code exchange",
  async (mode) => {
    const { auth } = await import("@modelcontextprotocol/sdk/client/auth.js");
    const oauth = {
      ...futureRemoteConnector.oauth!,
      discoveryUrls: [
        "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp",
        "https://identity.example.com/.well-known/oauth-authorization-server",
      ],
      client:
        mode === "static"
          ? { type: "static" as const, clientId: "registered-public-client" }
          : mode === "dynamic"
            ? { type: "dynamic" as const }
            : {
                type: "metadata" as const,
                url: "https://client.example.com/oauth.json",
              },
      redirect:
        mode === "metadata"
          ? { hostname: "127.0.0.1" as const, port: 43829, path: "/callback" }
          : { hostname: "127.0.0.1" as const },
    };
    const config: McpServerConfig = {
      id: "notion",
      name: "Remote",
      transport: "streamable-http",
      enabled: false,
      url: oauth.mcpEndpoint!,
      connector: { ...futureRemoteConnector, oauth },
    };
    const { service, options, vault } = await setup(config);
    options.openExternal.mockImplementation(async (value) => {
      const url = new URL(value);
      expect(url.searchParams.get("resource")).toBe(oauth.resource);
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({
        state: url.searchParams.get("state")!,
        code: "private-code",
        iss: oauth.issuer,
      }).toString();
      await fetch(callback);
    });
    let registrations = 0;
    options.fetcher.mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      if (request.url.includes("oauth-protected-resource"))
        return Response.json({
          resource: oauth.resource,
          authorization_servers: [oauth.issuer],
        });
      if (request.url.includes("oauth-authorization-server"))
        return Response.json({
          issuer: oauth.issuer,
          authorization_endpoint: oauth.authorizationEndpoint,
          token_endpoint: oauth.tokenEndpoint,
          registration_endpoint: oauth.registrationEndpoint,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          client_id_metadata_document_supported: true,
        });
      if (request.url === oauth.registrationEndpoint) {
        registrations++;
        return Response.json(
          {
            ...(await request.json()),
            client_id: "dynamic-public-client",
            token_endpoint_auth_method: "none",
          },
          { status: 201 },
        );
      }
      if (request.url === oauth.tokenEndpoint) {
        const body = new URLSearchParams(await request.text());
        expect(body.get("resource")).toBe(oauth.resource);
        expect(body.get("client_secret")).toBeNull();
        expect(body.get("code_verifier")).toBeTruthy();
        return Response.json({
          token_type: "Bearer",
          access_token: "remote-resource-access",
          refresh_token: "host-only-remote-refresh",
          expires_in: 3600,
        });
      }
      throw new Error("Unexpected OAuth endpoint");
    });
    options.connectMcp.mockImplementation(async (_config, authentication) => {
      if (!authentication?.authorizationCode) return;
      const provider = authentication.oauthProvider!;
      expect(
        await auth(provider, {
          serverUrl: oauth.mcpEndpoint!,
          fetchFn: authentication.fetch!,
        }),
      ).toBe("REDIRECT");
      const code = await authentication.authorizationCode;
      expect(
        await auth(provider, {
          serverUrl: oauth.mcpEndpoint!,
          fetchFn: authentication.fetch!,
          authorizationCode: code,
        }),
      ).toBe("AUTHORIZED");
    });
    await service.connect({ serverId: config.id });
    expect(registrations).toBe(mode === "dynamic" ? 1 : 0);
    expect((await vault.get(config.id))?.oauth?.tokens?.access_token).toBe(
      "remote-resource-access",
    );
    expect(JSON.stringify(await service.list())).not.toContain(
      "host-only-remote-refresh",
    );
  },
);

it("does not start an old authorization after an update during trust verification", async () => {
  const { service, options } = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  options.assertTrusted.mockImplementationOnce(async () => {
    await gate;
    return futureOwner;
  });
  const pending = service.connect({ serverId: google.id });
  const rejected = expect(pending).rejects.toThrow(/configuration changed/);
  await vi.waitFor(() => expect(options.assertTrusted).toHaveBeenCalled());
  service.invalidate(google.id);
  release();
  await rejected;
  expect(options.openExternal).not.toHaveBeenCalled();
});

it("explains secret-required registrations without exposing the provider error body", async () => {
  const { service, options } = await setup();
  options.openExternal.mockImplementation(async (value) => {
    const authorization = new URL(value);
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get("state")!,
      code: "synthetic-code",
    }).toString();
    await fetch(callback);
  });
  options.fetcher.mockResolvedValue(
    Response.json(
      {
        error: "invalid_request",
        error_description:
          "client_secret is missing. sensitive-provider-detail",
      },
      { status: 400 },
    ),
  );
  await expect(service.connect({ serverId: google.id })).rejects.toThrow(
    "This OAuth client requires a client secret. The plugin publisher must declare a non-confidential native client or provide an authorization backend.",
  );
  expect(JSON.stringify(await service.list())).not.toContain(
    "sensitive-provider-detail",
  );
  expect(options.connectMcp).not.toHaveBeenCalled();
});

it("sends native compatibility credentials only to the token endpoint for exchange and refresh", async () => {
  const config: McpServerConfig = {
    ...google,
    connector: {
      ...futureConnector,
      oauth: {
        ...futureConnector.oauth!,
        client: {
          type: "native-public",
          clientId: "native-id",
          clientSecret: "native-compatibility-value",
        },
      },
    },
  };
  const { service, options, vault } = await setup(config);
  options.openExternal.mockImplementation(async (value) => {
    expect(value).not.toContain("native-compatibility-value");
    const authorization = new URL(value);
    expect(authorization.searchParams.has("client_secret")).toBe(false);
    expect(authorization.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    const callback = new URL(authorization.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: authorization.searchParams.get("state")!,
      code: "synthetic-code",
    }).toString();
    await fetch(callback);
  });
  const grants: string[] = [];
  options.fetcher.mockImplementation(async (input, init) => {
    if (String(input) === config.connector!.oauth!.tokenEndpoint) {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_secret")).toBe("native-compatibility-value");
      grants.push(body.get("grant_type")!);
      return Response.json({
        access_token: "resource-access",
        refresh_token: "host-only-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    expect(String(init?.body)).not.toContain("native-compatibility-value");
    return Response.json({ id: "test-account", email: "test@example.com" });
  });
  await service.connect({ serverId: config.id });
  await vault.set(config.id, {
    ...(await vault.get(config.id))!,
    expiresAt: Date.now() - 1,
  });
  const context = await service.context(config);
  expect(grants).toEqual(["authorization_code", "refresh_token"]);
  expect(JSON.stringify(context)).not.toContain("native-compatibility-value");
  expect(context.accessToken).toBe("resource-access");
  const changed = {
    ...config,
    connector: {
      ...config.connector!,
      oauth: {
        ...config.connector!.oauth!,
        client: {
          type: "native-public" as const,
          clientId: "native-id",
          clientSecret: "rotated-value",
        },
      },
    },
  };
  await expect(service.context(changed)).rejects.toThrow(
    /Connect this account/,
  );
});
