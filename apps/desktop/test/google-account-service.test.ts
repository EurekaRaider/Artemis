import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { SafeStorageAdapter } from "../src/main/encrypted-settings-store.js";
import {
  GoogleAccountService,
  loadGoogleOAuthClient,
  type GoogleOAuthClient,
} from "../src/main/google-account-service.js";

const GOOGLE_SCOPES = {
  "google-workspace": [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/calendar",
  ],
  gmail: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
} as const;

const DESKTOP_CLIENT: GoogleOAuthClient = {
  clientId: "desktop-client.apps.googleusercontent.com",
  clientSecret: "desktop-secret",
  authUri: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUri: "https://oauth2.googleapis.com/token",
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("GoogleAccountService", () => {
  it("uses loopback PKCE, isolates grants, and refreshes only short-lived access tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-google-account-"));
    temporaryDirectories.push(directory);
    const storePath = join(directory, "google-account.json");

    let authorizationUrl: URL | undefined;
    const callbackResponses: Promise<Response>[] = [];
    let omitCalendarScope = false;
    let nextSub = "google-sub-1";
    const fetcher = async (urlInput: string | URL, init?: RequestInit) => {
      const url = String(urlInput);
      if (url.endsWith("/token")) {
        const body = new URLSearchParams(String(init?.body));
        if (body.get("grant_type") === "refresh_token") {
          expect(body.get("refresh_token")).toMatch(/^refresh-/u);
          return Response.json({
            access_token: "short-lived-access-token",
            expires_in: 3600,
          });
        }
        expect(body.get("code_verifier")).toHaveLength(64);
        const authorization = authorizationUrl!;
        const scope = authorization.searchParams.get("scope")!;
        const returnedScope = scope
          .split(" ")
          .filter(
            (entry) =>
              !omitCalendarScope ||
              entry !== "https://www.googleapis.com/auth/calendar",
          )
          .map((entry) => {
            if (entry === "email") {
              return "https://www.googleapis.com/auth/userinfo.email";
            }
            if (entry === "profile") {
              return "https://www.googleapis.com/auth/userinfo.profile";
            }
            return entry;
          })
          .join(" ");
        const payload = {
          iss: "https://accounts.google.com",
          aud: "desktop-client.apps.googleusercontent.com",
          sub: nextSub,
          email: "owner@example.com",
          email_verified: true,
          exp: Math.floor(Date.now() / 1000) + 3600,
          nonce: authorization.searchParams.get("nonce"),
        };
        const idToken = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
          JSON.stringify(payload),
        ).toString("base64url")}.signature`;
        return Response.json({
          access_token: "initial-access-token",
          refresh_token: `refresh-${nextSub}-${scope.includes("gmail") ? "gmail" : "workspace"}`,
          id_token: idToken,
          scope: returnedScope,
        });
      }
      return new Response(undefined, { status: 200 });
    };
    const service = new GoogleAccountService(
      storePath,
      xorSafeStorage(true),
      async (url) => {
        authorizationUrl = new URL(url);
        expect(authorizationUrl.hostname).toBe("accounts.google.com");
        expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
          "S256",
        );
        const redirect = new URL(
          authorizationUrl.searchParams.get("redirect_uri")!,
        );
        expect(redirect.hostname).toBe("127.0.0.1");
        redirect.searchParams.set(
          "state",
          authorizationUrl.searchParams.get("state")!,
        );
        redirect.searchParams.set("code", "authorization-code");
        callbackResponses.push(fetch(redirect));
      },
      fetcher,
      DESKTOP_CLIENT,
    );

    await service.authorize("google-workspace");
    await expect(callbackResponses[0]).resolves.toMatchObject({ status: 200 });
    await service.authorize("gmail");
    await expect(callbackResponses[1]).resolves.toMatchObject({ status: 200 });
    const status = await service.status();
    expect(status.email).toBe("owner@example.com");
    expect(status.grants["google-workspace"].scopes).toEqual(
      GOOGLE_SCOPES["google-workspace"],
    );
    expect(status.grants.gmail.scopes).toEqual(GOOGLE_SCOPES.gmail);

    await expect(
      service.accessContext("google-workspace", [
        ...GOOGLE_SCOPES["google-workspace"],
      ]),
    ).resolves.toEqual({
      accessToken: "short-lived-access-token",
      email: "owner@example.com",
    });

    omitCalendarScope = true;
    await expect(service.authorize("google-workspace", "zh")).rejects.toThrow(
      /did not grant all scopes/u,
    );
    const missingScopeCallback = await callbackResponses[2]!;
    expect(missingScopeCallback.status).toBe(400);
    await expect(missingScopeCallback.text()).resolves.toContain("授权未完成");

    omitCalendarScope = false;
    nextSub = "google-sub-2";
    await expect(service.authorize("gmail")).rejects.toThrow(
      /Google account mismatch/,
    );
    const failedCallback = await callbackResponses[3]!;
    expect(failedCallback.status).toBe(400);
    await expect(failedCallback.text()).resolves.toContain(
      "authorization was not completed",
    );
    const persisted = await readFile(storePath, "utf8");
    expect(persisted).not.toContain("refresh-google-sub-1");
    const envelope = JSON.parse(persisted) as { encrypted: string };
    const decrypted = JSON.parse(
      xorSafeStorage(true).decryptString(
        Buffer.from(envelope.encrypted, "base64"),
      ),
    ) as Record<string, unknown>;
    expect(decrypted).not.toHaveProperty("client");
    expect((await stat(storePath)).mode & 0o777).toBe(0o600);
  });

  it("blocks setup when OS credential encryption is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-google-mismatch-"));
    temporaryDirectories.push(directory);
    const unavailable = new GoogleAccountService(
      join(directory, "unavailable.json"),
      xorSafeStorage(false),
      async () => {},
      fetch,
      DESKTOP_CLIENT,
    );
    await expect(unavailable.status()).resolves.toMatchObject({
      encryptionAvailable: false,
    });
    await expect(unavailable.authorize("gmail")).rejects.toThrow(
      /encryption is unavailable/,
    );
  });

  it("loads Google's downloaded Desktop app client and normalizes its endpoints", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-google-client-"));
    temporaryDirectories.push(directory);
    const clientPath = join(directory, "client.json");
    await writeFile(
      clientPath,
      JSON.stringify({
        installed: {
          client_id: "desktop-client.apps.googleusercontent.com",
          client_secret: "desktop-secret",
          auth_uri: "https://accounts.google.com/o/oauth2/auth",
          token_uri: "https://oauth2.googleapis.com/token",
          redirect_uris: ["http://localhost"],
        },
      }),
    );
    await expect(loadGoogleOAuthClient(clientPath)).resolves.toEqual({
      authUri: "https://accounts.google.com/o/oauth2/v2/auth",
      clientId: "desktop-client.apps.googleusercontent.com",
      clientSecret: "desktop-secret",
      tokenUri: "https://oauth2.googleapis.com/token",
    });
  });

  it.each([
    ["not valid JSON", "not-json"],
    [
      "Desktop app JSON format",
      JSON.stringify({
        web: {
          client_id: "web-client.apps.googleusercontent.com",
          client_secret: "web-secret",
        },
      }),
    ],
    [
      "Desktop app JSON format",
      JSON.stringify({ type: "service_account", private_key: "secret" }),
    ],
    [
      "unsupported authorization endpoint",
      JSON.stringify({
        installed: {
          client_id: "desktop-client.apps.googleusercontent.com",
          client_secret: "desktop-secret",
          auth_uri: "https://example.com/oauth/authorize",
        },
      }),
    ],
  ] as const)(
    "rejects invalid bundled clients: %s",
    async (message, contents) => {
      const directory = await mkdtemp(
        join(tmpdir(), "artemis-google-invalid-"),
      );
      temporaryDirectories.push(directory);
      const clientPath = join(directory, "client.json");
      await writeFile(clientPath, contents);

      await expect(loadGoogleOAuthClient(clientPath)).rejects.toThrow(message);
    },
  );

  it("keeps browser authorization available only when the build has a client", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-google-missing-"));
    temporaryDirectories.push(directory);
    const service = new GoogleAccountService(
      join(directory, "google-account.json"),
      xorSafeStorage(true),
      async () => {},
    );

    await expect(service.status()).resolves.toMatchObject({
      clientConfigured: false,
    });
    await expect(service.authorize("gmail")).rejects.toThrow(
      /does not include a Google OAuth client/,
    );
  });

  it("clears only grants Google explicitly reports as invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-google-health-"));
    temporaryDirectories.push(directory);
    const storePath = join(directory, "google-account.json");
    const safeStorage = xorSafeStorage(true);
    const record = {
      account: { sub: "google-sub-1", email: "owner@example.com" },
      grants: {
        "google-workspace": {
          refreshToken: "revoked-workspace-token",
          scopes: [...GOOGLE_SCOPES["google-workspace"]],
        },
        gmail: {
          refreshToken: "temporarily-unreachable-gmail-token",
          scopes: [...GOOGLE_SCOPES.gmail],
        },
      },
    };
    await writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        encrypted: safeStorage
          .encryptString(JSON.stringify(record))
          .toString("base64"),
      }),
    );
    const service = new GoogleAccountService(
      storePath,
      safeStorage,
      async () => {},
      async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        if (body.get("refresh_token") === "revoked-workspace-token") {
          return Response.json(
            { error: "invalid_grant", error_description: "Token revoked" },
            { status: 400 },
          );
        }
        throw new Error("Temporary network failure");
      },
      DESKTOP_CLIENT,
    );

    await expect(service.status()).resolves.toMatchObject({
      connected: true,
      grants: {
        "google-workspace": { authorized: false },
        gmail: { authorized: true },
      },
    });
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      encrypted: string;
    };
    const saved = JSON.parse(
      safeStorage.decryptString(Buffer.from(persisted.encrypted, "base64")),
    ) as typeof record;
    expect(saved.grants).not.toHaveProperty("google-workspace");
    expect(saved.grants).toHaveProperty("gmail");
  });
});

function xorSafeStorage(available: boolean): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) =>
      Buffer.from(Buffer.from(plainText).map((byte) => byte ^ 0xa5)),
    decryptString: (encrypted) =>
      Buffer.from(encrypted.map((byte) => byte ^ 0xa5)).toString("utf8"),
  };
}
