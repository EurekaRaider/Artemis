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
    private readonly store: McpOAuthStore,
    private readonly onRedirect: (url: URL) => void | Promise<void>,
  ) {}

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Artemis Desktop",
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
    return (await this.store.get(this.serverId)).clientInformation;
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformationMixed,
  ): Promise<void> {
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
    await this.store.update(this.serverId, (current) => ({
      ...current,
      redirectUrl: this.callbackUrl,
      tokens,
    }));
  }

  redirectToAuthorization(authorizationUrl: URL): void | Promise<void> {
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
): Promise<McpOAuthCallback> {
  const callbackPath = `/mcp-oauth/${encodeURIComponent(serverId)}`;
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
    if (!stateMatches(url.searchParams.get("state"))) {
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
        rejectCode(new Error(`MCP OAuth failed: ${error}`));
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
    finish(200, "Authorization complete.", response);
    if (!settled) {
      settled = true;
      resolveCode(code);
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
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
    },
    5 * 60 * 1000,
  );
  timeout.unref();

  return {
    redirectUrl: `http://127.0.0.1:${address.port.toString()}${callbackPath}`,
    authorizationCode,
    async close() {
      clearTimeout(timeout);
      if (!server.listening) return;
      await new Promise<void>((resolvePromise) =>
        server.close(() => resolvePromise()),
      );
    },
  };
}
