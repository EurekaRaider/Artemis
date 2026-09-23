import type { ConnectorOAuth } from "../shared/connector-oauth.js";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { McpOAuthStore } from "./mcp-oauth-store.js";

export class SecureMcpOAuthProvider implements OAuthClientProvider {
  private readonly oauthState = randomBytes(32).toString("hex");

  constructor(
    private readonly serverId: string,
    private readonly callbackUrl: string,
    private readonly store: Pick<McpOAuthStore, "get" | "update" | "delete">,
    private readonly onRedirect: (url: URL) => void | Promise<void>,
    private readonly registration?: {
      clientId?: string;
      scopes: string[];
      oauth?: ConnectorOAuth;
    },
  ) {
    const resource = registration?.oauth?.resource;
    if (resource)
      this.validateResourceURL = async (_serverUrl, discovered) => {
        if (discovered && discovered !== resource)
          throw new Error("OAuth resource changed.");
        return new URL(resource);
      };
    if (registration?.oauth?.client.type === "metadata")
      this.clientMetadataUrl = registration.oauth.client.url;
  }

  clientMetadataUrl?: string;

  validateResourceURL?: (
    serverUrl: string | URL,
    resource?: string,
  ) => Promise<URL | undefined>;

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name:
        this.registration?.oauth?.applicationName ?? "Artemis Desktop",
      ...(this.registration?.scopes.length
        ? { scope: this.registration.scopes.join(" ") }
        : {}),
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.oauthState;
  }

  matchesState(value: string | null): boolean {
    return value === this.oauthState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.registration?.clientId)
      return { client_id: this.registration.clientId, ...this.clientMetadata };
    return (await this.store.get(this.serverId)).clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
    if (
      this.registration?.oauth &&
      (clientInformation.client_secret ||
        ("token_endpoint_auth_method" in clientInformation &&
          clientInformation.token_endpoint_auth_method &&
          clientInformation.token_endpoint_auth_method !== "none"))
    )
      throw new Error(
        "Confidential OAuth clients require a developer backend.",
      );
    if (
      this.registration?.oauth?.client.type === "metadata" &&
      clientInformation.client_id !== this.registration.oauth.client.url
    )
      throw new Error(
        "Client metadata registration cannot fall back to dynamic registration.",
      );
    await this.store.update(this.serverId, (current) => ({
      ...current,
      redirectUrl: this.callbackUrl,
      clientInformation,
    }));
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.get(this.serverId)).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const oauth = this.registration?.oauth;
    if (oauth) {
      if (
        !tokens.access_token ||
        tokens.token_type.toLowerCase() !== "bearer" ||
        (oauth.offlineRequired && !tokens.refresh_token)
      )
        throw new Error("Invalid OAuth token response.");
      const scopes = (tokens.scope ?? this.registration!.scopes.join(" "))
        .split(/\s+/)
        .map((s) => oauth.scopeAliases?.[s] ?? s);
      if (oauth.requiredScopes.some((s) => !scopes.includes(s)))
        throw new Error("Required permissions were not granted.");
    }
    await this.store.update(this.serverId, (current) => ({
      ...current,
      redirectUrl: this.callbackUrl,
      tokens,
    }));
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
    const oauth = this.registration?.oauth;
    if (oauth) {
      if (
        authorizationUrl.searchParams.get("redirect_uri") !==
          this.callbackUrl ||
        authorizationUrl.searchParams.get("state") !== this.oauthState ||
        authorizationUrl.searchParams.get("code_challenge_method") !== "S256"
      )
        throw new Error("OAuth transaction changed.");
      for (const [key, value] of Object.entries(
        oauth.authorizationParameters ?? {},
      ))
        authorizationUrl.searchParams.set(key, value);
    }
    return this.onRedirect(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.update(this.serverId, (current) => ({
      ...current,
      redirectUrl: this.callbackUrl,
      codeVerifier,
    }));
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await this.store.get(this.serverId)).codeVerifier;
    if (!verifier) {
      throw new Error("MCP OAuth PKCE verifier is unavailable");
    }
    return verifier;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all") {
      await this.store.delete(this.serverId);
      return;
    }
    await this.store.update(this.serverId, (current) => {
      if (scope === "client") {
        const { clientInformation: _removed, ...rest } = current;
        return rest;
      }
      if (scope === "tokens") {
        const { tokens: _removed, ...rest } = current;
        return rest;
      }
      if (scope === "verifier") {
        const { codeVerifier: _removed, ...rest } = current;
        return rest;
      }
      return current;
    });
  }
}

export interface McpOAuthCallback {
  redirectUrl: string;
  authorizationCode: Promise<string>;
  close(): Promise<void>;
}

export async function startMcpOAuthCallback(
  serverId: string,
  stateMatches: (state: string | null) => boolean,
  fixedRedirect?: string,
  redirect?: ConnectorOAuth["redirect"],
  expectedIssuer?: string,
): Promise<McpOAuthCallback> {
  const fixed = fixedRedirect
    ? new URL(fixedRedirect)
    : redirect?.port
      ? new URL(
          `http://${redirect.hostname}:${redirect.port}${redirect.path ?? `/mcp-oauth/${encodeURIComponent(serverId)}`}`,
        )
      : undefined;
  if (
    fixed &&
    (fixed.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(fixed.hostname) ||
      !fixed.port ||
      fixed.username ||
      fixed.password ||
      fixed.search ||
      fixed.hash)
  )
    throw new Error("Desktop OAuth requires an exact loopback redirect.");
  const callbackPath =
    fixed?.pathname ??
    redirect?.path ??
    `/mcp-oauth/${encodeURIComponent(serverId)}`;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  let settled = false;
  const authorizationCode = new Promise<string>((resolvePromise, reject) => {
    resolveCode = resolvePromise;
    rejectCode = reject;
  });
  let server: Server;
  const finish = (
    status: number,
    body: string,
    response: import("node:http").ServerResponse,
  ) => {
    response.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'",
      "Cache-Control": "no-store",
    });
    response.end(
      `<!doctype html><meta charset="utf-8"><title>Artemis MCP OAuth</title><body><h1>${body}</h1><p>You can close this window and return to Artemis.</p></body>`,
    );
  };
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET" || url.pathname !== callbackPath) {
      response.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const issuer = url.searchParams.get("iss");
    let issuerMatches = true;
    try {
      if (expectedIssuer && issuer)
        issuerMatches = new URL(issuer).href === new URL(expectedIssuer).href;
    } catch {
      issuerMatches = false;
    }
    if (!stateMatches(url.searchParams.get("state")) || !issuerMatches) {
      finish(400, "Authorization state did not match.", response);
      if (!settled) {
        settled = true;
        rejectCode(new Error("MCP OAuth state did not match"));
      }
      return;
    }
    if (error) {
      finish(400, "Authorization failed.", response);
      if (!settled) {
        settled = true;
        rejectCode(new Error("MCP OAuth authorization was denied"));
      }
      return;
    }
    if (!code || code.length > 16 * 1024) {
      finish(400, "Authorization code was missing.", response);
      if (!settled) {
        settled = true;
        rejectCode(new Error("MCP OAuth authorization code was missing"));
      }
      return;
    }
    finish(200, "Authorization response received.", response);
    if (!settled) {
      settled = true;
      resolveCode(code);
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(fixed ? Number(fixed.port) : 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolvePromise();
    });
  });
  const address = server.address() as AddressInfo;
  const timeout = setTimeout(
    () => {
      if (!settled) {
        settled = true;
        rejectCode(new Error("MCP OAuth authorization timed out"));
      }
      server.close();
      server.closeAllConnections();
    },
    5 * 60 * 1000,
  );
  timeout.unref();

  return {
    redirectUrl:
      fixed?.href ??
      `http://${redirect?.hostname ?? "127.0.0.1"}:${address.port.toString()}${callbackPath}`,
    authorizationCode,
    async close() {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        rejectCode(new Error("MCP OAuth authorization cancelled"));
      }
      if (!server.listening) return;
      await new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise());
        // Browsers can leave speculative sockets without an HTTP request.
        // They otherwise keep close() pending and block connector completion.
        server.closeAllConnections();
      });
    },
  };
}
