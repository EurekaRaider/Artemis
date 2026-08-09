import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { GoogleAccountStatus, GoogleGrantId } from "../shared/api.js";
import type { SafeStorageAdapter } from "./encrypted-settings-store.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_GRANTS: GoogleGrantId[] = ["google-workspace", "gmail"];
const GOOGLE_AUTH_URLS = new Set([
  GOOGLE_AUTH_URL,
  "https://accounts.google.com/o/oauth2/auth",
]);
const GOOGLE_TOKEN_URLS = new Set([
  GOOGLE_TOKEN_URL,
  "https://accounts.google.com/o/oauth2/token",
]);
const GRANT_SCOPES: Record<GoogleGrantId, string[]> = {
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
};
const GOOGLE_SCOPE_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  email: ["email", "https://www.googleapis.com/auth/userinfo.email"],
  profile: ["profile", "https://www.googleapis.com/auth/userinfo.profile"],
};

type GoogleAuthorizationLanguage = "en" | "zh";

export interface GoogleOAuthClient {
  clientId: string;
  clientSecret: string;
  authUri: string;
  tokenUri: string;
}

interface StoredGrant {
  refreshToken: string;
  scopes: string[];
}

interface GoogleAccountRecord {
  client?: GoogleOAuthClient;
  account?: { sub: string; email: string };
  grants: Partial<Record<GoogleGrantId, StoredGrant>>;
}

interface PersistedGoogleAccount {
  version: 1;
  encrypted?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    status: number,
    description: string,
  ) {
    super(`Google OAuth failed (${status}): ${description}`);
    this.name = "GoogleOAuthError";
  }
}

type Fetcher = (url: string | URL, init?: RequestInit) => Promise<Response>;
type OpenExternal = (url: string) => Promise<void>;

export async function loadGoogleOAuthClient(
  path: string,
): Promise<GoogleOAuthClient | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) {
    throw new Error("Bundled Google OAuth client JSON exceeds 1 MiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Bundled Google OAuth client is not valid JSON.");
  }
  if (!isRecord(parsed) || !isRecord(parsed.installed)) {
    throw new Error(
      "Bundled Google OAuth client must use the Desktop app JSON format.",
    );
  }
  const clientId = stringValue(parsed.installed.client_id);
  const clientSecret = stringValue(parsed.installed.client_secret);
  if (!clientId || !clientSecret) {
    throw new Error(
      "Bundled Google OAuth client is missing client_id or client_secret.",
    );
  }
  const importedAuthUri = stringValue(parsed.installed.auth_uri);
  if (importedAuthUri && !GOOGLE_AUTH_URLS.has(importedAuthUri)) {
    throw new Error(
      "Bundled Google OAuth client uses an unsupported authorization endpoint.",
    );
  }
  const importedTokenUri = stringValue(parsed.installed.token_uri);
  if (importedTokenUri && !GOOGLE_TOKEN_URLS.has(importedTokenUri)) {
    throw new Error(
      "Bundled Google OAuth client uses an unsupported token endpoint.",
    );
  }
  return {
    clientId,
    clientSecret,
    authUri: GOOGLE_AUTH_URL,
    tokenUri: GOOGLE_TOKEN_URL,
  };
}

export class GoogleAccountService {
  private value: PersistedGoogleAccount | undefined;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageAdapter,
    private readonly openExternal: OpenExternal,
    private readonly fetcher: Fetcher = fetch,
    private readonly configuredClient?: GoogleOAuthClient,
  ) {}

  async status(): Promise<GoogleAccountStatus> {
    if (!this.safeStorage.isEncryptionAvailable()) {
      return {
        encryptionAvailable: false,
        clientConfigured: false,
        connected: false,
        grants: {
          "google-workspace": { authorized: false, scopes: [] },
          gmail: { authorized: false, scopes: [] },
        },
      };
    }
    const record = await this.validateStoredGrants(await this.getRecord());
    return this.accountStatus(record);
  }

  private accountStatus(
    record: GoogleAccountRecord | undefined,
  ): GoogleAccountStatus {
    return {
      encryptionAvailable: this.safeStorage.isEncryptionAvailable(),
      clientConfigured: Boolean(this.clientFor(record)),
      connected: Boolean(record?.account),
      ...(record?.account ? { email: record.account.email } : {}),
      grants: {
        "google-workspace": grantStatus(record?.grants["google-workspace"]),
        gmail: grantStatus(record?.grants.gmail),
      },
    };
  }

  async authorize(
    grant: GoogleGrantId,
    language: GoogleAuthorizationLanguage = "en",
  ): Promise<GoogleAccountStatus> {
    this.assertGrant(grant);
    this.assertEncryption();
    const record = (await this.getRecord()) ?? emptyGoogleAccountRecord();
    const client = this.requireClient(record);
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const callback = await loopbackCallback(state, language);
    try {
      const authorization = new URL(client.authUri);
      authorization.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: callback.redirectUrl,
        response_type: "code",
        scope: GRANT_SCOPES[grant].join(" "),
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "false",
        ...(record.account ? { login_hint: record.account.email } : {}),
      }).toString();
      await this.openExternal(authorization.href);
      const code = await callback.code;
      const token = await this.tokenRequest(client.tokenUri, {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        code_verifier: verifier,
        redirect_uri: callback.redirectUrl,
        grant_type: "authorization_code",
      });
      if (!token.refresh_token || !token.id_token) {
        throw new Error(
          "Google did not return an offline refresh token and identity token.",
        );
      }
      const identity = validateIdentityToken(
        token.id_token,
        client.clientId,
        nonce,
      );
      if (record.account && identity.sub !== record.account.sub) {
        throw new Error(
          `Google account mismatch. Continue with ${record.account.email}.`,
        );
      }
      const grantedScopes = new Set(
        token.scope?.split(/\s+/u).filter(Boolean) ?? [],
      );
      if (
        GRANT_SCOPES[grant].some(
          (scope) => !hasGoogleScope(grantedScopes, scope),
        )
      ) {
        throw new Error(
          "Google did not grant all scopes required by this plugin.",
        );
      }
      const scopes = [...GRANT_SCOPES[grant]];
      const updated = {
        ...record,
        account: { sub: identity.sub, email: identity.email },
        grants: {
          ...record.grants,
          [grant]: { refreshToken: token.refresh_token, scopes },
        },
      };
      await this.saveRecord(updated);
      callback.complete(true);
      return this.accountStatus(updated);
    } catch (error) {
      callback.complete(false);
      throw error;
    } finally {
      await callback.close();
    }
  }

  async accessContext(
    grant: GoogleGrantId,
    requiredScopes: string[],
  ): Promise<{
    accessToken: string;
    email: string;
  }> {
    this.assertGrant(grant);
    const record = await this.requireRecord();
    const client = this.requireClient(record);
    const saved = record.grants[grant];
    if (!record.account || !saved)
      throw new Error("Authorize this Google plugin before enabling it.");
    if (requiredScopes.some((scope) => !saved.scopes.includes(scope))) {
      throw new Error(
        "This plugin requires additional Google scopes. Authorize it again.",
      );
    }
    let token: TokenResponse;
    try {
      token = await this.refreshGrant(client, saved);
    } catch (error) {
      if (!isInvalidGrant(error)) throw error;
      const grants = { ...record.grants };
      delete grants[grant];
      await this.saveRecord({ ...record, grants });
      throw new Error(
        "Google authorization expired or was revoked. Authorize this plugin again.",
      );
    }
    if (!token.access_token)
      throw new Error("Google did not return an access token.");
    return {
      accessToken: token.access_token,
      email: record.account.email,
    };
  }

  async disconnectGrant(
    grant: GoogleGrantId,
    revoke = true,
  ): Promise<GoogleAccountStatus> {
    this.assertGrant(grant);
    const record = await this.getRecord();
    const saved = record?.grants[grant];
    if (!record || !saved) return this.status();
    let revokeError: Error | undefined;
    if (revoke) {
      try {
        await this.revoke(saved.refreshToken);
      } catch (error) {
        revokeError = error instanceof Error ? error : new Error(String(error));
      }
    }
    const grants = { ...record.grants };
    delete grants[grant];
    await this.saveRecord({ ...record, grants });
    if (revokeError) throw revokeError;
    return this.status();
  }

  async disconnectAccount(): Promise<GoogleAccountStatus> {
    const record = await this.getRecord();
    const errors: string[] = [];
    for (const grant of Object.values(record?.grants ?? {})) {
      if (!grant) continue;
      try {
        await this.revoke(grant.refreshToken);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    await this.deleteRecord();
    if (errors.length) {
      throw new Error(
        `Local Google credentials were deleted, but revocation failed: ${errors.join("; ")}`,
      );
    }
    return this.status();
  }

  private async revoke(token: string): Promise<void> {
    const response = await this.fetcher(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    if (!response.ok)
      throw new Error(`Google token revocation failed (${response.status}).`);
  }

  private async tokenRequest(
    url: string,
    values: Record<string, string>,
  ): Promise<TokenResponse> {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values).toString(),
    });
    const token = (await response.json()) as TokenResponse;
    if (!response.ok || token.error) {
      throw new GoogleOAuthError(
        token.error ?? "unknown_error",
        response.status,
        token.error_description ?? token.error ?? "unknown error",
      );
    }
    return token;
  }

  private refreshGrant(
    client: GoogleOAuthClient,
    grant: StoredGrant,
  ): Promise<TokenResponse> {
    return this.tokenRequest(client.tokenUri, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: grant.refreshToken,
      grant_type: "refresh_token",
    });
  }

  private async validateStoredGrants(
    record: GoogleAccountRecord | undefined,
  ): Promise<GoogleAccountRecord | undefined> {
    if (!record) return undefined;
    const client = this.clientFor(record);
    if (!client) return record;
    const invalid = await Promise.all(
      GOOGLE_GRANTS.map(async (grant) => {
        const saved = record.grants[grant];
        if (!saved) return undefined;
        try {
          await this.refreshGrant(client, saved);
          return undefined;
        } catch (error) {
          return isInvalidGrant(error) ? grant : undefined;
        }
      }),
    );
    const invalidGrants = invalid.filter(
      (grant): grant is GoogleGrantId => grant !== undefined,
    );
    if (invalidGrants.length === 0) return record;
    const grants = { ...record.grants };
    for (const grant of invalidGrants) delete grants[grant];
    const updated = { ...record, grants };
    await this.saveRecord(updated);
    return updated;
  }

  private assertEncryption(): void {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error(
        "OS credential encryption is unavailable. Google plugins remain disabled.",
      );
    }
  }

  private assertGrant(grant: string): asserts grant is GoogleGrantId {
    if (grant !== "google-workspace" && grant !== "gmail")
      throw new Error("Google grant is invalid.");
  }

  private async requireRecord(): Promise<GoogleAccountRecord> {
    const record = await this.getRecord();
    if (!record) throw new Error("Authorize this Google account first.");
    return record;
  }

  private clientFor(
    record: GoogleAccountRecord | undefined,
  ): GoogleOAuthClient | undefined {
    return this.configuredClient ?? record?.client;
  }

  private requireClient(record?: GoogleAccountRecord): GoogleOAuthClient {
    const client = this.clientFor(record);
    if (!client) {
      throw new Error(
        "This Artemis build does not include a Google OAuth client.",
      );
    }
    return client;
  }

  private async getRecord(): Promise<GoogleAccountRecord | undefined> {
    const stored = await this.load();
    if (!stored.encrypted) return undefined;
    this.assertEncryption();
    const parsed = JSON.parse(
      this.safeStorage.decryptString(Buffer.from(stored.encrypted, "base64")),
    ) as GoogleAccountRecord;
    return {
      ...(parsed.client ? { client: parsed.client } : {}),
      ...(parsed.account ? { account: parsed.account } : {}),
      grants: parsed.grants ?? {},
    };
  }

  private async saveRecord(record: GoogleAccountRecord): Promise<void> {
    this.assertEncryption();
    const storedRecord = this.configuredClient
      ? { ...record, client: undefined }
      : record;
    await this.save({
      version: 1,
      encrypted: this.safeStorage
        .encryptString(JSON.stringify(storedRecord))
        .toString("base64"),
    });
  }

  private async deleteRecord(): Promise<void> {
    this.value = { version: 1 };
    await rm(this.filePath, { force: true });
  }

  private async load(): Promise<PersistedGoogleAccount> {
    if (this.value) return this.value;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as PersistedGoogleAccount;
      if (parsed.version !== 1)
        throw new Error("Google account store is invalid.");
      this.value = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.value = { version: 1 };
    }
    return this.value;
  }

  private async save(value: PersistedGoogleAccount): Promise<void> {
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

function grantStatus(grant: StoredGrant | undefined) {
  return { authorized: Boolean(grant), scopes: [...(grant?.scopes ?? [])] };
}

function emptyGoogleAccountRecord(): GoogleAccountRecord {
  return { grants: {} };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvalidGrant(error: unknown): boolean {
  return error instanceof GoogleOAuthError && error.code === "invalid_grant";
}

function hasGoogleScope(
  grantedScopes: ReadonlySet<string>,
  requiredScope: string,
): boolean {
  return (GOOGLE_SCOPE_EQUIVALENTS[requiredScope] ?? [requiredScope]).some(
    (scope) => grantedScopes.has(scope),
  );
}

function validateIdentityToken(token: string, clientId: string, nonce: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Google identity token is invalid.");
  const payload = JSON.parse(
    Buffer.from(parts[1]!, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  const issuer = stringValue(payload.iss);
  const audience = stringValue(payload.aud);
  const sub = stringValue(payload.sub);
  const email = stringValue(payload.email);
  if (
    !["accounts.google.com", "https://accounts.google.com"].includes(
      issuer ?? "",
    ) ||
    audience !== clientId ||
    payload.nonce !== nonce ||
    typeof payload.exp !== "number" ||
    payload.exp * 1000 < Date.now() ||
    !sub ||
    !email ||
    payload.email_verified !== true
  ) {
    throw new Error("Google identity token claims are invalid.");
  }
  return { sub, email };
}

async function loopbackCallback(
  expectedState: string,
  language: GoogleAuthorizationLanguage,
): Promise<{
  redirectUrl: string;
  code: Promise<string>;
  complete(success: boolean): void;
  close(): Promise<void>;
}> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let completionResponse: ServerResponse | undefined;
  const code = new Promise<string>((resolvePromise, rejectPromise) => {
    resolveCode = resolvePromise;
    rejectCode = rejectPromise;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth2/callback") {
      response.writeHead(404).end();
      return;
    }
    const state = url.searchParams.get("state");
    const authorizationCode = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    if (state !== expectedState || !authorizationCode || oauthError) {
      rejectCode(
        new Error(
          oauthError
            ? `Google authorization failed: ${oauthError}`
            : "Google OAuth state validation failed.",
        ),
      );
      response
        .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Authorization failed. Return to Artemis.");
      return;
    }
    if (completionResponse) {
      response
        .writeHead(409, { "Content-Type": "text/plain; charset=utf-8" })
        .end(
          language === "zh"
            ? "Google 授权正在由 Artemis 处理，请返回 Artemis。"
            : "Google authorization is already being processed by Artemis.",
        );
      return;
    }
    completionResponse = response;
    resolveCode(authorizationCode);
  });
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Google OAuth callback listener failed.");
  const timeout = setTimeout(
    () => rejectCode(new Error("Google authorization timed out.")),
    5 * 60 * 1000,
  );
  const complete = (success: boolean): void => {
    if (!completionResponse || completionResponse.writableEnded) return;
    completionResponse
      .writeHead(success ? 200 : 400, {
        "Content-Type": "text/plain; charset=utf-8",
      })
      .end(
        language === "zh"
          ? success
            ? "Google 授权已完成。你可以关闭此页面并返回 Artemis。"
            : "Google 授权未完成。请返回 Artemis 查看具体原因。"
          : success
            ? "Google authorization completed. You can close this tab and return to Artemis."
            : "Google authorization was not completed. Return to Artemis for details.",
      );
    completionResponse = undefined;
  };
  return {
    redirectUrl: `http://127.0.0.1:${address.port}/oauth2/callback`,
    code: code.finally(() => clearTimeout(timeout)),
    complete,
    close: () => {
      complete(false);
      return new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise()),
      );
    },
  };
}
