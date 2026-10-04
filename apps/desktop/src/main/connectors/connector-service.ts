import { createHash, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { McpServerConfig } from "../../shared/api.js";
import {
  type ConnectorConnection,
  type ConnectorConnectInput,
  type ConnectorAuthContext,
  type ConnectorDefinition,
  validateConnectorDefinition,
  assertConnectorTransport,
} from "../../shared/connectors.js";
import { ConnectorVault, type ConnectorSecret } from "./connector-vault.js";
import {
  SecureMcpOAuthProvider,
  startMcpOAuthCallback,
} from "../mcp/mcp-oauth-provider.js";
import type { McpConnectionAuthentication } from "../mcp/mcp-client-manager.js";
import {
  connectorSecurityContract,
  canonicalConnectorJson,
  type ConnectorOAuth,
} from "../../shared/connector-oauth.js";
import { fetchPublicOAuth } from "./connector-oauth-network.js";
import type { McpOAuthRecord } from "../mcp/mcp-oauth-store.js";
export function connectorBinding(
  config: McpServerConfig,
  owner?: ConnectorOwner,
): string {
  return createHash("sha256")
    .update(
      (config.connector?.version === 2
        ? canonicalConnectorJson
        : JSON.stringify)({
        id: config.id,
        ...(config.connector?.version === 2 ? { owner } : {}),
        connector: connectorSecurityContract(config.connector),
        transport: config.transport,
        target:
          config.transport === "stdio"
            ? [
                config.command,
                config.args,
                config.env,
                config.envVars,
                config.workspacePath,
              ]
            : config.url,
      }),
    )
    .digest("hex");
}
export interface ConnectorOwner {
  pluginId: string;
  signingKeyFingerprint: string;
  marketplaceUrl: string;
}
interface ConnectorServiceOptions {
  vault: ConnectorVault;
  openExternal(url: string, signal?: AbortSignal): Promise<void>;
  fetcher?: typeof fetch;
  configs(): Promise<McpServerConfig[]>;
  assertTrusted(config: McpServerConfig): Promise<ConnectorOwner | void>;
  connectMcp(
    config: McpServerConfig,
    authentication?: McpConnectionAuthentication,
  ): Promise<void>;
  disconnectMcp(id: string): Promise<void>;
  checkMailbox(
    config: McpServerConfig,
    context: ConnectorAuthContext,
  ): Promise<void>;
}
class ConnectorAuthorizationError extends Error {}
export class ConnectorService {
  private readonly pending = new Map<string, AbortController>();
  private readonly pendingGroups = new Map<string, string>();
  private readonly generation = new Map<string, number>();
  private readonly states = new Map<string, ConnectorConnection>();
  private readonly refreshControllers = new Map<string, AbortController>();
  private readonly refreshing = new Map<string, Promise<ConnectorSecret>>();
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: ConnectorServiceOptions) {
    this.fetcher = options.fetcher ?? fetchPublicOAuth;
  }
  private definition(config: McpServerConfig): ConnectorDefinition {
    const definition = validateConnectorDefinition(config.connector);
    assertConnectorTransport(
      definition,
      config.transport,
      config.transport === "streamable-http" ? config.url : undefined,
    );
    return definition;
  }
  private async config(id: string) {
    const config = (await this.options.configs()).find(
      (c) => c.id === id && c.connector,
    );
    if (!config) throw new Error("Update the plugin and reconnect.");
    this.definition(config);
    await this.options.assertTrusted(config);
    return config;
  }
  private async binding(config: McpServerConfig): Promise<string> {
    const owner = await this.options.assertTrusted(config);
    if (config.connector?.version === 2 && !owner)
      throw new Error("OAuth requires a verified plugin owner.");
    return connectorBinding(config, owner || undefined);
  }
  private oauth(config: McpServerConfig): ConnectorOAuth {
    const d = this.definition(config);
    if (d.version !== 2 || !d.oauth)
      throw new ConnectorAuthorizationError(
        "Update the plugin and authorize again.",
      );
    return d.oauth;
  }
  private async secret(config: McpServerConfig) {
    const secret = await this.options.vault.get(config.id);
    return secret?.binding === (await this.binding(config))
      ? secret
      : undefined;
  }
  async migrateLegacyConnections(): Promise<void> {
    for (const config of await this.options.configs()) {
      const d = config.connector;
      if (
        d?.version === 1 &&
        ["oauth-pkce", "device-code", "mcp-oauth"].includes(d.auth)
      ) {
        this.invalidate(config.id);
        await this.options.vault.set(config.id, undefined);
      }
    }
  }
  async list(): Promise<ConnectorConnection[]> {
    return Promise.all(
      (await this.options.configs())
        .filter((c) => c.connector)
        .map(async (config) => {
          const definition = this.definition(config);
          if (
            definition.version === 1 &&
            ["oauth-pkce", "device-code", "mcp-oauth"].includes(definition.auth)
          )
            return {
              id: config.id,
              definition,
              state: "authorization-required" as const,
              error: "Update the plugin and authorize again.",
            };
          const transient = this.states.get(config.id);
          if (transient) return structuredClone(transient);
          const secret = await this.secret(config);
          return {
            id: config.id,
            definition,
            state: secret ? ("connected" as const) : ("disconnected" as const),
            ...(secret?.account ? { account: secret.account } : {}),
          };
        }),
    );
  }
  cancel(id: string): void {
    this.pending.get(id)?.abort();
  }
  invalidate(id: string): void {
    this.cancel(id);
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.states.delete(id);
    this.refreshControllers.get(id)?.abort();
    this.refreshControllers.delete(id);
    this.refreshing.delete(id);
  }
  async disconnect(id: string): Promise<void> {
    this.invalidate(id);
    await this.options.disconnectMcp(id);
    await this.options.vault.set(id, undefined);
    this.states.delete(id);
  }
  async reconnect(id: string): Promise<ConnectorConnection> {
    const config = await this.config(id);
    const secret = await this.secret(config);
    if (!secret) return this.connect({ serverId: id });
    try {
      await this.options.connectMcp(config, await this.authentication(config));
      this.states.delete(id);
      return {
        id,
        definition: this.definition(config),
        state: "connected",
        ...(secret.account ? { account: secret.account } : {}),
      };
    } catch (e) {
      if (e instanceof ConnectorAuthorizationError)
        return this.connect({ serverId: id });
      throw e;
    }
  }
  async connect(input: ConnectorConnectInput): Promise<ConnectorConnection> {
    const initialGeneration = this.generation.get(input.serverId) ?? 0;
    const config = await this.config(input.serverId),
      definition = this.definition(config),
      id = config.id;
    if (this.pending.has(id))
      throw new Error("Connector authorization is already running.");
    if (["oauth-pkce", "device-code", "mcp-oauth"].includes(definition.auth))
      this.oauth(config);
    const binding = await this.binding(config);
    const owner = await this.options.assertTrusted(config);
    const group = definition.oauth?.identity?.group;
    const groupKey =
      group && owner
        ? canonicalConnectorJson([
            owner.marketplaceUrl,
            owner.signingKeyFingerprint,
            definition.oauth!.issuer,
            group,
          ])
        : undefined;
    if ((this.generation.get(id) ?? 0) !== initialGeneration)
      throw new Error(
        "Connector configuration changed during authorization setup.",
      );
    // Recheck after asynchronous trust checks, before reserving the flow.
    if (
      this.pending.has(id) ||
      (groupKey && [...this.pendingGroups.values()].includes(groupKey))
    )
      throw new Error("Connector authorization is already running.");
    if (!this.options.vault.encryptionAvailable)
      throw new Error("OS credential encryption is unavailable.");
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(300000),
    ]);
    this.pending.set(id, controller);
    if (groupKey) this.pendingGroups.set(id, groupKey);
    const revision = (this.generation.get(id) ?? 0) + 1;
    this.generation.set(id, revision);
    this.states.set(id, { id, definition, state: "connecting" });
    let saved = false;
    try {
      let secret: ConnectorSecret;
      if (definition.auth === "oauth-pkce")
        secret = await this.authorizeDesktop(config, signal);
      else if (definition.auth === "device-code")
        secret = await this.authorizeDevice(config, signal);
      else if (definition.auth === "app-password") {
        const email = String(input.email ?? "").trim(),
          password = String(input.appPassword ?? "").replace(/\s/g, "");
        if (
          !/^[^\s@]+@(qq\.com|foxmail\.com)$/i.test(email) ||
          !/^[a-z]{16}$/i.test(password)
        )
          throw new Error(
            "Enter a QQ mailbox address and its 16-letter authorization code.",
          );
        await this.options.checkMailbox(config, {
          version: 1,
          provider: "qq",
          connectionId: id,
          account: email,
          appPassword: password,
        });
        secret = { binding, account: email, appPassword: password };
      } else if (definition.auth === "mcp-oauth") {
        await this.authorizeRemote(config, signal, revision);
        const remote = await this.secret(config);
        if (!remote?.oauth?.tokens)
          throw new ConnectorAuthorizationError(
            "Authorization did not return a token.",
          );
        const identity = await this.identity(
          config,
          remote.oauth.tokens.access_token,
          signal,
        );
        await this.accountGroup(config, identity.subject);
        secret = { ...remote, ...identity, binding };
      } else {
        await this.options.connectMcp(config);
        secret = { binding };
      }
      signal.throwIfAborted();
      if (this.generation.get(id) !== revision)
        throw new Error("Connector authorization was cancelled.");
      await this.options.vault.set(
        id,
        secret,
        () => this.generation.get(id) === revision && !signal.aborted,
      );
      saved = true;
      signal.throwIfAborted();
      await this.options.connectMcp(config, await this.authentication(config));
      signal.throwIfAborted();
      this.states.delete(id);
      return {
        id,
        definition,
        state: "connected",
        ...(secret.account ? { account: secret.account } : {}),
      };
    } catch (e) {
      if (
        (saved || definition.auth === "mcp-oauth") &&
        this.generation.get(id) === revision
      )
        await this.options.vault.set(id, undefined);
      if (this.generation.get(id) === revision) {
        this.generation.set(id, revision + 1);
        await this.options.disconnectMcp(id);
        this.states.set(id, {
          id,
          definition,
          state:
            e instanceof ConnectorAuthorizationError || signal.aborted
              ? "authorization-required"
              : "unavailable",
          error: signal.aborted
            ? "Authorization cancelled or timed out."
            : e instanceof Error
              ? e.message
              : "Connector unavailable.",
        });
      }
      throw e;
    } finally {
      if (this.pending.get(id) === controller) {
        this.pending.delete(id);
        this.pendingGroups.delete(id);
      }
    }
  }
  private async token(
    url: string,
    parameters: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<Record<string, any>> {
    const response = await this.fetcher(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(parameters),
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(30000),
    });
    const token = await response.json();
    if (token.error === "invalid_grant" || token.error === "access_denied")
      throw new ConnectorAuthorizationError(
        "Authorization expired, was denied or revoked. Reconnect this account.",
      );
    if (
      ["invalid_request", "invalid_client"].includes(token.error) &&
      /client_secret.*(?:missing|required)/iu.test(
        String(token.error_description ?? ""),
      )
    )
      throw new Error(
        "This OAuth client requires a client secret. The plugin publisher must declare a non-confidential native client or provide an authorization backend.",
      );
    if (!response.ok || token.error) {
      if (["authorization_pending", "slow_down"].includes(token.error))
        return token;
      throw new Error(
        `Authorization service rejected the request (${response.status}).`,
      );
    }
    if (
      parameters.grant_type &&
      (typeof token.access_token !== "string" ||
        !token.access_token ||
        typeof token.token_type !== "string" ||
        token.token_type.toLowerCase() !== "bearer" ||
        (token.refresh_token !== undefined &&
          typeof token.refresh_token !== "string") ||
        (token.expires_in !== undefined &&
          (!Number.isFinite(Number(token.expires_in)) ||
            Number(token.expires_in) <= 0)))
    )
      throw new ConnectorAuthorizationError("Invalid OAuth token response.");
    return token;
  }
  private async identity(
    config: McpServerConfig,
    accessToken: string,
    signal: AbortSignal,
  ) {
    const identity = this.oauth(config).identity;
    if (!identity) return {};
    const response = await this.fetcher(identity.endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal,
    });
    if (!response.ok)
      throw new Error(`Account verification failed (HTTP ${response.status}).`);
    const data = await response.json();
    const field = (paths: string[]) =>
      paths
        .map((path) =>
          path
            .split(".")
            .reduce(
              (v, key) => (v && Object.hasOwn(v, key) ? v[key] : undefined),
              data,
            ),
        )
        .find(
          (v) => (typeof v === "string" && v.length) || typeof v === "number",
        );
    const subject = field(identity.subject),
      account = field(identity.account);
    if (
      subject === undefined ||
      account === undefined ||
      Object.entries(identity.requiredClaims ?? {}).some(
        ([k, v]) => data[k] !== v,
      )
    )
      throw new Error("Account identity could not be verified.");
    return { subject: String(subject), account: String(account) };
  }
  private grantedScopes(
    config: McpServerConfig,
    scope: unknown,
    fallback?: string[],
  ): string[] {
    const d = this.definition(config),
      oauth = this.oauth(config);
    const scopes =
      scope === undefined
        ? (fallback ?? d.scopes)
        : String(scope)
            .split(/[ ,]+/)
            .filter(Boolean)
            .map((s) => oauth.scopeAliases?.[s] ?? s);
    if (oauth.requiredScopes.some((s) => !scopes.includes(s)))
      throw new ConnectorAuthorizationError(
        "Required permissions were not granted.",
      );
    return scopes;
  }
  private async accountGroup(config: McpServerConfig, subject?: string) {
    const oauth = this.oauth(config),
      group = oauth.identity?.group;
    if (!group || !subject) return;
    const owner = await this.options.assertTrusted(config);
    for (const other of await this.options.configs()) {
      if (
        other.id === config.id ||
        other.connector?.oauth?.identity?.group !== group ||
        other.connector.oauth.issuer !== oauth.issuer
      )
        continue;
      const siblingOwner = await this.options.assertTrusted(other);
      if (
        !owner ||
        !siblingOwner ||
        owner.signingKeyFingerprint !== siblingOwner.signingKeyFingerprint ||
        owner.marketplaceUrl !== siblingOwner.marketplaceUrl
      )
        continue;
      const sibling = await this.secret(other);
      if (sibling?.subject && sibling.subject !== subject)
        throw new ConnectorAuthorizationError(
          "Use the same account for this plugin group, or disconnect the other connection first.",
        );
    }
  }
  private async authorizeDesktop(
    config: McpServerConfig,
    signal: AbortSignal,
  ): Promise<ConnectorSecret> {
    const d = this.definition(config),
      oauth = this.oauth(config);
    if (oauth.client.type !== "static" && oauth.client.type !== "native-public")
      throw new Error("Missing public client ID.");
    const clientId = oauth.client.clientId;
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(48).toString("base64url");
    const callback = await startMcpOAuthCallback(
      config.id,
      (value) => value === state,
      undefined,
      oauth.redirect,
      oauth.issuer,
    );
    void callback.authorizationCode.catch(() => {});
    const cancel = () => {
      void callback.close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const redirect = callback.redirectUrl;
      const url = new URL(oauth.authorizationEndpoint);
      url.search = new URLSearchParams({
        ...oauth.authorizationParameters,
        client_id: clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: d.scopes.join(" "),
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        ...(oauth.resource ? { resource: oauth.resource } : {}),
      }).toString();
      await this.options.openExternal(url.href, signal);
      const code = await callback.authorizationCode;
      signal.throwIfAborted();
      const token = await this.token(
        oauth.tokenEndpoint,
        {
          client_id: clientId,
          ...(oauth.client.type === "native-public"
            ? { client_secret: oauth.client.clientSecret }
            : {}),
          redirect_uri: redirect,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          ...(oauth.resource ? { resource: oauth.resource } : {}),
        },
        signal,
      );
      if (
        !token.access_token ||
        (oauth.offlineRequired && !token.refresh_token)
      )
        throw new ConnectorAuthorizationError(
          "Offline authorization was not granted.",
        );
      const scopes = this.grantedScopes(config, token.scope);
      const identity = await this.identity(config, token.access_token, signal);
      await this.accountGroup(config, identity.subject);
      return {
        binding: await this.binding(config),
        ...identity,
        scopes,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
      };
    } finally {
      signal.removeEventListener("abort", cancel);
      await callback.close();
    }
  }
  private async authorizeDevice(
    config: McpServerConfig,
    signal: AbortSignal,
  ): Promise<ConnectorSecret> {
    const oauth = this.oauth(config),
      definition = this.definition(config);
    if (oauth.client.type !== "static")
      throw new Error("Missing public client ID.");
    const clientId = oauth.client.clientId;
    const device = await this.token(
      oauth.deviceAuthorizationEndpoint!,
      {
        client_id: clientId,
        scope: definition.scopes.join(" "),
        ...(oauth.resource ? { resource: oauth.resource } : {}),
      },
      signal,
    );
    signal.throwIfAborted();
    if (
      !oauth.verificationOrigins?.includes(
        new URL(String(device.verification_uri)).origin + "/",
      ) ||
      new URL(String(device.verification_uri)).username ||
      new URL(String(device.verification_uri)).password ||
      !device.device_code ||
      !device.user_code
    )
      throw new Error("Invalid device authorization response.");
    this.states.set(config.id, {
      id: config.id,
      definition,
      state: "connecting",
      userCode: device.user_code,
      verificationUri: device.verification_uri,
    });
    await this.options.openExternal(device.verification_uri, signal);
    let interval = Math.max(5, Number(device.interval) || 5);
    const deadline =
      Date.now() + Math.min(900, Number(device.expires_in) || 900) * 1000;
    while (Date.now() < deadline) {
      await delay(interval * 1000, undefined, { signal });
      const token = await this.token(
        oauth.tokenEndpoint,
        {
          client_id: clientId,
          ...(oauth.resource ? { resource: oauth.resource } : {}),
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
        signal,
      );
      if (token.error === "slow_down") {
        interval += 5;
        continue;
      }
      if (token.error === "authorization_pending") continue;
      if (!token.access_token)
        throw new ConnectorAuthorizationError(
          "Authorization did not return a token.",
        );
      const scopes = this.grantedScopes(config, token.scope);
      const identity = await this.identity(config, token.access_token, signal);
      await this.accountGroup(config, identity.subject);
      return {
        binding: await this.binding(config),
        ...identity,
        accessToken: token.access_token,
        ...(token.refresh_token
          ? {
              refreshToken: token.refresh_token,
            }
          : {}),
        ...(token.expires_in !== undefined
          ? { expiresAt: Date.now() + Number(token.expires_in) * 1000 }
          : {}),
        scopes,
      };
    }
    throw new ConnectorAuthorizationError(
      "Device authorization expired. Connect again.",
    );
  }
  private oauthStore(
    config: McpServerConfig,
    revision: number,
    signal?: AbortSignal,
    binding = connectorBinding(config),
  ) {
    const id = config.id;
    return {
      get: async (_id: string) => (await this.secret(config))?.oauth ?? {},
      update: async (
        _id: string,
        update: (record: McpOAuthRecord) => McpOAuthRecord,
      ) => {
        let oauth: McpOAuthRecord = {};
        await this.options.vault.update(
          id,
          (current) => {
            if (current && current.binding !== binding)
              throw new Error("Connector configuration changed. Reconnect.");
            oauth = update(current?.oauth ?? {});
            return { ...current, binding, oauth };
          },
          () => (this.generation.get(id) ?? 0) === revision && !signal?.aborted,
        );
        return oauth;
      },
      delete: async (_id: string) => {
        if ((this.generation.get(id) ?? 0) === revision)
          await this.options.vault.set(id, undefined);
      },
    };
  }
  private async authorizeRemote(
    config: McpServerConfig,
    signal: AbortSignal,
    revision: number,
  ) {
    let provider: SecureMcpOAuthProvider | undefined;
    const oauth = this.oauth(config);
    const binding = await this.binding(config);
    const callback = await startMcpOAuthCallback(
      config.id,
      (state) => provider?.matchesState(state) ?? false,
      undefined,
      oauth.redirect,
      oauth.issuer,
    );
    void callback.authorizationCode.catch(() => {});
    const cancel = () => {
      void callback.close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      await this.options.vault.set(
        config.id,
        {
          binding: await this.binding(config),
          oauth: { redirectUrl: callback.redirectUrl },
        },
        () => this.generation.get(config.id) === revision && !signal.aborted,
      );
      provider = new SecureMcpOAuthProvider(
        config.id,
        callback.redirectUrl,
        this.oauthStore(config, revision, signal, binding),
        (url) => {
          this.assertRemoteUrl(config, url);
          return this.options.openExternal(url.href, signal);
        },
        this.registration(config),
      );
      await this.options.connectMcp(config, {
        oauthProvider: provider,
        authorizationCode: callback.authorizationCode,
        fetch: this.remoteFetch(config),
      });
      signal.throwIfAborted();
    } finally {
      signal.removeEventListener("abort", cancel);
      await callback.close();
    }
  }
  private registration(config: McpServerConfig) {
    const oauth = this.oauth(config);
    return {
      ...(oauth.client.type === "static"
        ? { clientId: oauth.client.clientId }
        : {}),
      scopes: config.connector!.scopes,
      oauth,
    };
  }
  private assertRemoteUrl(config: McpServerConfig, url: URL) {
    const oauth = this.oauth(config);
    if (
      url.origin !== new URL(oauth.authorizationEndpoint).origin ||
      url.pathname !== new URL(oauth.authorizationEndpoint).pathname ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error("Untrusted connector authorization endpoint.");
    const scopes = (url.searchParams.get("scope") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    if (scopes.some((s) => !config.connector!.scopes.includes(s)))
      throw new Error("Authorization requested undeclared scopes.");
  }
  private remoteFetch(config: McpServerConfig): typeof fetch {
    return async (input, init) => {
      const request = new Request(input, init),
        url = new URL(request.url),
        oauth = this.oauth(config);
      const allowed = [
        oauth.tokenEndpoint,
        oauth.registrationEndpoint,
        oauth.mcpEndpoint,
        ...(oauth.discoveryUrls ?? []),
      ].filter(Boolean);
      if (!allowed.includes(url.href))
        throw new Error("Untrusted connector authorization endpoint.");
      if (
        request.headers.has("authorization") &&
        url.href !== oauth.mcpEndpoint
      )
        throw new Error("Credentials cannot be sent to a discovery endpoint.");
      if (
        (oauth.discoveryUrls ?? []).includes(url.href) &&
        request.method !== "GET"
      )
        throw new Error("Discovery requests must be read-only.");
      if (
        url.href === oauth.registrationEndpoint &&
        (oauth.client.type !== "dynamic" || request.method !== "POST")
      )
        throw new Error("Unexpected client registration.");
      if (url.href === oauth.tokenEndpoint && request.method !== "POST")
        throw new Error("Invalid token request.");
      if (request.method === "POST" && url.href === oauth.tokenEndpoint) {
        const parameters = new URLSearchParams(await request.clone().text());
        if (
          parameters.has("client_secret") ||
          parameters.has("client_assertion")
        )
          throw new Error("Confidential clients require a developer backend.");
      }
      if (
        config.connector!.auth !== "mcp-oauth" &&
        url.href === oauth.mcpEndpoint
      ) {
        const context = await this.context(config);
        request.headers.set("Authorization", `Bearer ${context.accessToken}`);
      }
      const response = await this.fetcher(request, { redirect: "error" });
      if (response.status >= 300 && response.status < 400)
        throw new Error("OAuth redirects are forbidden.");
      if (
        url.href === oauth.tokenEndpoint ||
        url.href === oauth.registrationEndpoint
      ) {
        const data = await response.json().catch(() => {
          throw new Error("Invalid OAuth service response.");
        });
        if (!response.ok || data.error) {
          const errors = [
            "invalid_request",
            "invalid_client",
            "invalid_grant",
            "unauthorized_client",
            "unsupported_grant_type",
            "invalid_scope",
            "access_denied",
            "temporarily_unavailable",
            "server_error",
          ];
          return Response.json(
            {
              error: errors.includes(data.error) ? data.error : "server_error",
              error_description:
                "OAuth service rejected the request. Reconnect or contact the plugin publisher.",
            },
            { status: response.ok ? 400 : response.status },
          );
        }
        return Response.json(data, { status: response.status });
      }
      if ((oauth.discoveryUrls ?? []).includes(url.href) && response.ok) {
        const metadata = await response.clone().json();
        if (metadata.issuer && new URL(metadata.issuer).href !== oauth.issuer)
          throw new Error("Authorization issuer changed.");
        if (
          metadata.authorization_servers &&
          (metadata.authorization_servers.length !== 1 ||
            new URL(metadata.authorization_servers[0]).href !== oauth.issuer)
        )
          throw new Error("Untrusted authorization server discovery.");
        if (metadata.resource && metadata.resource !== oauth.resource)
          throw new Error("OAuth resource changed.");
        for (const [key, expected] of [
          ["authorization_endpoint", oauth.authorizationEndpoint],
          ["token_endpoint", oauth.tokenEndpoint],
          ["registration_endpoint", oauth.registrationEndpoint],
        ]) {
          if (metadata[key!] && metadata[key!] !== expected)
            throw new Error("OAuth metadata endpoint changed.");
        }
        if (
          metadata.authorization_endpoint &&
          !metadata.code_challenge_methods_supported?.includes("S256")
        )
          throw new Error("OAuth server must support PKCE S256.");
        if (
          metadata.token_endpoint_auth_methods_supported &&
          !metadata.token_endpoint_auth_methods_supported.includes("none")
        )
          throw new Error(
            "Confidential OAuth servers require a developer backend.",
          );
        if (metadata.scopes_supported)
          metadata.scopes_supported = config.connector!.scopes;
        const headers = new Headers(response.headers);
        headers.delete("content-length");
        headers.delete("content-encoding");
        return Response.json(metadata, {
          status: response.status,
          headers,
        });
      }
      return response;
    };
  }
  async context(config: McpServerConfig): Promise<ConnectorAuthContext> {
    const initialGeneration = this.generation.get(config.id) ?? 0;
    await this.options.assertTrusted(config);
    const definition = this.definition(config);
    if (["oauth-pkce", "device-code", "mcp-oauth"].includes(definition.auth))
      this.oauth(config);
    let secret = await this.secret(config);
    if ((this.generation.get(config.id) ?? 0) !== initialGeneration)
      throw new Error("Connector was disconnected.");
    if (!secret)
      throw new ConnectorAuthorizationError(
        "Connect this account before using its tools.",
      );
    if (
      secret.refreshToken &&
      (!secret.accessToken || (secret.expiresAt ?? 0) < Date.now() + 60000)
    ) {
      let refresh = this.refreshing.get(config.id);
      if (!refresh) {
        const revision = this.generation.get(config.id) ?? 0,
          saved = secret;
        const refreshController = new AbortController();
        this.refreshControllers.set(config.id, refreshController);
        refresh = (async () => {
          const oauth = this.oauth(config);
          if (
            oauth.client.type !== "static" &&
            oauth.client.type !== "native-public"
          )
            throw new Error("Reconnect this account.");
          const clientId = oauth.client.clientId;
          try {
            const token = await this.token(
              oauth.tokenEndpoint,
              {
                client_id: clientId,
                ...(oauth.client.type === "native-public"
                  ? { client_secret: oauth.client.clientSecret }
                  : {}),
                refresh_token: saved.refreshToken!,
                grant_type: "refresh_token",
                ...(oauth.resource ? { resource: oauth.resource } : {}),
              },
              AbortSignal.any([
                refreshController.signal,
                AbortSignal.timeout(30000),
              ]),
            );
            if (!token.access_token)
              throw new ConnectorAuthorizationError(
                "Authorization did not return an access token.",
              );
            if ((this.generation.get(config.id) ?? 0) !== revision)
              throw new Error("Connector was disconnected.");
            const next = {
              ...saved,
              scopes: this.grantedScopes(config, token.scope, saved.scopes),
              accessToken: token.access_token,
              refreshToken: token.refresh_token ?? saved.refreshToken,
              expiresAt: Date.now() + Number(token.expires_in ?? 3600) * 1000,
            };
            await this.options.vault.set(
              config.id,
              next,
              () => (this.generation.get(config.id) ?? 0) === revision,
            );
            if ((this.generation.get(config.id) ?? 0) !== revision)
              throw new Error("Connector was disconnected.");
            return next;
          } catch (e) {
            if (
              e instanceof ConnectorAuthorizationError &&
              (this.generation.get(config.id) ?? 0) === revision
            ) {
              await this.options.vault.set(config.id, undefined);
              await this.options.disconnectMcp(config.id);
              this.states.set(config.id, {
                id: config.id,
                definition,
                state: "authorization-required",
                error: e.message,
              });
            }
            throw e;
          }
        })();
        this.refreshing.set(config.id, refresh);
        void refresh
          .finally(() => {
            if (this.refreshing.get(config.id) === refresh) {
              this.refreshing.delete(config.id);
              this.refreshControllers.delete(config.id);
            }
          })
          .catch(() => {});
      }
      secret = await refresh;
    }
    if ((this.generation.get(config.id) ?? 0) !== initialGeneration)
      throw new Error("Connector was disconnected.");
    if (secret.expiresAt && secret.expiresAt <= Date.now())
      throw new ConnectorAuthorizationError(
        "Authorization expired. Reconnect this account.",
      );
    return {
      version: 1,
      provider: definition.provider,
      connectionId: config.id,
      ...(secret.account ? { account: secret.account } : {}),
      ...(secret.accessToken ? { accessToken: secret.accessToken } : {}),
      ...(secret.appPassword ? { appPassword: secret.appPassword } : {}),
    };
  }
  async authentication(
    config: McpServerConfig,
  ): Promise<McpConnectionAuthentication | undefined> {
    const definition = this.definition(config);
    if (definition.auth === "mcp-oauth") {
      await this.options.assertTrusted(config);
      const secret = await this.secret(config);
      if (!secret?.oauth?.tokens)
        throw new ConnectorAuthorizationError("Reconnect this account.");
      return {
        fetch: this.remoteFetch(config),
        oauthProvider: new SecureMcpOAuthProvider(
          config.id,
          secret.oauth.redirectUrl!,
          this.oauthStore(
            config,
            this.generation.get(config.id) ?? 0,
            undefined,
            await this.binding(config),
          ),
          () => {
            throw new ConnectorAuthorizationError("Reconnect this account.");
          },
          this.registration(config),
        ),
      };
    }
    const context = await this.context(config);
    return config.transport === "streamable-http" && context.accessToken
      ? { bearerToken: context.accessToken, fetch: this.remoteFetch(config) }
      : undefined;
  }
}
