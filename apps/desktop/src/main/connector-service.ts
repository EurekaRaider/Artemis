import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { McpServerConfig } from "../shared/api.js";
import {
  type ConnectorConnection,
  type ConnectorConnectInput,
  type ConnectorAuthContext,
  type ConnectorDefinition,
  validateConnectorDefinition,
  assertConnectorTransport,
} from "../shared/connectors.js";
import { ConnectorVault, type ConnectorSecret } from "./connector-vault.js";
import {
  SecureMcpOAuthProvider,
  startMcpOAuthCallback,
} from "./mcp-oauth-provider.js";
import type { McpConnectionAuthentication } from "./mcp-client-manager.js";
import type { McpOAuthRecord } from "./mcp-oauth-store.js";
export interface ConnectorClients {
  version: 1;
  google?: { clientId: string; clientSecret?: string };
  microsoft?: { clientId: string };
  github?: { clientId: string };
  slack?: { clientId: string };
}
export async function loadConnectorClients(
  path: string,
): Promise<ConnectorClients> {
  try {
    const data = JSON.parse(await readFile(path, "utf8"));
    if (data.version !== 1)
      throw new Error("Connector client configuration is invalid.");
    for (const provider of ["google", "microsoft", "github", "slack"]) {
      if (
        data[provider] &&
        (typeof data[provider].clientId !== "string" ||
          !data[provider].clientId.trim())
      )
        throw new Error("Connector client ID is invalid.");
      if (provider !== "google" && data[provider]?.clientSecret)
        throw new Error(
          "Confidential client secrets cannot be bundled in a desktop app.",
        );
    }
    return data;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 };
    throw e;
  }
}
export function connectorBinding(config: McpServerConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: config.id,
        connector: config.connector,
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
interface ConnectorServiceOptions {
  vault: ConnectorVault;
  clients: ConnectorClients;
  openExternal(url: string): Promise<void>;
  fetcher?: typeof fetch;
  configs(): Promise<McpServerConfig[]>;
  assertTrusted(config: McpServerConfig): Promise<void>;
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
  private readonly generation = new Map<string, number>();
  private readonly states = new Map<string, ConnectorConnection>();
  private readonly refreshing = new Map<string, Promise<ConnectorSecret>>();
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: ConnectorServiceOptions) {
    this.fetcher = options.fetcher ?? fetch;
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
  private async secret(config: McpServerConfig) {
    const secret = await this.options.vault.get(config.id);
    return secret?.binding === connectorBinding(config) ? secret : undefined;
  }
  async list(): Promise<ConnectorConnection[]> {
    return Promise.all(
      (await this.options.configs())
        .filter((c) => c.connector)
        .map(async (config) => {
          const definition = this.definition(config);
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
  async disconnect(id: string): Promise<void> {
    this.cancel(id);
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
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
    const config = await this.config(input.serverId),
      definition = this.definition(config),
      id = config.id;
    if (
      definition.provider === "google" &&
      (await this.options.configs()).some(
        (c) => c.connector?.provider === "google" && this.pending.has(c.id),
      )
    )
      throw new Error("Finish the current Google authorization first.");
    if (this.pending.has(id))
      throw new Error("Connector authorization is already running.");
    const configs = await this.options.configs();
    for (const other of configs) {
      if (
        other.id !== id &&
        other.connector?.id === definition.id &&
        (this.pending.has(other.id) || (await this.secret(other)))
      )
        throw new Error(
          "Disconnect the existing connection for this service first.",
        );
    }
    // Recheck after asynchronous preflight, immediately before reserving the
    // authorization slot. Concurrent IPC requests must not open two flows.
    if (
      this.pending.has(id) ||
      configs.some(
        (other) =>
          this.pending.has(other.id) &&
          (other.connector?.id === definition.id ||
            (definition.provider === "google" &&
              other.connector?.provider === "google")),
      )
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
    const revision = (this.generation.get(id) ?? 0) + 1;
    this.generation.set(id, revision);
    this.states.set(id, { id, definition, state: "connecting" });
    const binding = connectorBinding(config);
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
        secret = { ...(await this.secret(config)), binding };
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
      if (this.pending.get(id) === controller) this.pending.delete(id);
    }
  }
  private client(provider: "google" | "microsoft" | "github") {
    const client = this.options.clients[provider];
    if (!client)
      throw new Error(
        `This Artemis build has no ${provider} public client configuration.`,
      );
    return client;
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
    if (!response.ok || token.error) {
      if (["authorization_pending", "slow_down"].includes(token.error))
        return token;
      throw new Error(
        `Authorization service rejected the request (${response.status}).`,
      );
    }
    return token;
  }
  private async identity(
    provider: string,
    accessToken: string,
    signal: AbortSignal,
  ) {
    const url =
      provider === "google"
        ? "https://openidconnect.googleapis.com/v1/userinfo"
        : provider === "microsoft"
          ? "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName"
          : "https://api.github.com/user";
    const response = await this.fetcher(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal,
    });
    if (!response.ok)
      throw new Error(`Account verification failed (${response.status}).`);
    const data = await response.json();
    const subject = String(data.sub ?? data.id ?? ""),
      account = data.email ?? data.mail ?? data.userPrincipalName ?? data.login;
    if (
      !subject ||
      typeof account !== "string" ||
      (provider === "google" && data.email_verified !== true)
    )
      throw new Error("Account identity could not be verified.");
    return { subject, account };
  }
  private async authorizeDesktop(
    config: McpServerConfig,
    signal: AbortSignal,
  ): Promise<ConnectorSecret> {
    const d = this.definition(config),
      provider = d.provider as "google" | "microsoft",
      client = this.client(provider);
    const state = randomBytes(32).toString("hex"),
      verifier = randomBytes(48).toString("base64url");
    const callback = await startMcpOAuthCallback(
      provider === "microsoft" ? "microsoft" : config.id,
      (value) => value === state,
    );
    void callback.authorizationCode.catch(() => {});
    const cancel = () => {
      void callback.close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      const redirect =
        provider === "microsoft"
          ? callback.redirectUrl.replace("127.0.0.1", "localhost")
          : callback.redirectUrl;
      const url = new URL(
        provider === "google"
          ? "https://accounts.google.com/o/oauth2/v2/auth"
          : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      );
      url.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: d.scopes.join(" "),
        state,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        ...(provider === "google"
          ? {
              access_type: "offline",
              prompt: "consent",
              include_granted_scopes: "false",
            }
          : {}),
      }).toString();
      await this.options.openExternal(url.href);
      const code = await callback.authorizationCode;
      signal.throwIfAborted();
      const token = await this.token(
        provider === "google"
          ? "https://oauth2.googleapis.com/token"
          : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        {
          client_id: client.clientId,
          ...("clientSecret" in client && client.clientSecret
            ? { client_secret: client.clientSecret }
            : {}),
          redirect_uri: redirect,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
        },
        signal,
      );
      if (!token.access_token || !token.refresh_token)
        throw new ConnectorAuthorizationError(
          "Offline authorization was not granted.",
        );
      const scopes = String(token.scope ?? "")
        .split(/\s+/)
        .map((s) =>
          s === "https://www.googleapis.com/auth/userinfo.email"
            ? "email"
            : s === "https://www.googleapis.com/auth/userinfo.profile"
              ? "profile"
              : s,
        );
      if (
        d.scopes
          .filter((s) => !["openid", "profile", "offline_access"].includes(s))
          .some((s) => !scopes.includes(s))
      )
        throw new ConnectorAuthorizationError(
          "Required permissions were not granted.",
        );
      const identity = await this.identity(
        provider,
        token.access_token,
        signal,
      );
      if (provider === "google") {
        for (const sibling of (await this.options.configs()).filter(
          (c) => c.id !== config.id && c.connector?.provider === "google",
        )) {
          const existing = await this.secret(sibling);
          if (existing?.subject && existing.subject !== identity.subject)
            throw new ConnectorAuthorizationError(
              "Use the same Google account for Gmail and Workspace, or disconnect the other connection first.",
            );
        }
      }
      return {
        binding: connectorBinding(config),
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
    const client = this.client("github"),
      definition = this.definition(config);
    const device = await this.token(
      "https://github.com/login/device/code",
      { client_id: client.clientId, scope: definition.scopes.join(" ") },
      signal,
    );
    if (
      device.verification_uri !== "https://github.com/login/device" ||
      !device.device_code ||
      !device.user_code
    )
      throw new Error("Invalid GitHub device authorization response.");
    this.states.set(config.id, {
      id: config.id,
      definition,
      state: "connecting",
      userCode: device.user_code,
      verificationUri: device.verification_uri,
    });
    await this.options.openExternal(device.verification_uri);
    let interval = Math.max(5, Number(device.interval) || 5);
    const deadline =
      Date.now() + Math.min(900, Number(device.expires_in) || 900) * 1000;
    while (Date.now() < deadline) {
      await delay(interval * 1000, undefined, { signal });
      const token = await this.token(
        "https://github.com/login/oauth/access_token",
        {
          client_id: client.clientId,
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
          "GitHub authorization did not return a token.",
        );
      const scopes = String(token.scope ?? "").split(/[ ,]+/);
      if (
        definition.scopes.some(
          (s) =>
            !scopes.includes(s) &&
            !(s === "public_repo" && scopes.includes("repo")),
        )
      )
        throw new ConnectorAuthorizationError(
          "Required GitHub permissions were not granted.",
        );
      return {
        binding: connectorBinding(config),
        ...(await this.identity("github", token.access_token, signal)),
        accessToken: token.access_token,
        ...(token.refresh_token
          ? {
              refreshToken: token.refresh_token,
              expiresAt: Date.now() + Number(token.expires_in ?? 28800) * 1000,
            }
          : {}),
        scopes,
      };
    }
    throw new ConnectorAuthorizationError(
      "GitHub authorization expired. Connect again.",
    );
  }
  private oauthStore(
    config: McpServerConfig,
    revision: number,
    signal?: AbortSignal,
  ) {
    const id = config.id,
      binding = connectorBinding(config);
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
    const slack =
      config.connector!.provider === "slack"
        ? this.options.clients.slack
        : undefined;
    if (config.connector!.provider === "slack" && !slack)
      throw new Error(
        "This Artemis build has no Slack public client configuration.",
      );
    const callback = await startMcpOAuthCallback(
      config.id,
      (state) => provider?.matchesState(state) ?? false,
      config.connector!.provider === "slack"
        ? "http://localhost:43827/mcp-oauth/slack"
        : undefined,
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
          binding: connectorBinding(config),
          oauth: { redirectUrl: callback.redirectUrl },
        },
        () => this.generation.get(config.id) === revision && !signal.aborted,
      );
      provider = new SecureMcpOAuthProvider(
        config.id,
        callback.redirectUrl,
        this.oauthStore(config, revision, signal),
        (url) => {
          this.assertRemoteUrl(config, url);
          return this.options.openExternal(url.href);
        },
        slack
          ? { clientId: slack.clientId, scopes: config.connector!.scopes }
          : undefined,
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
  private assertRemoteUrl(config: McpServerConfig, url: URL) {
    const hosts: Record<string, string[]> = {
      notion: ["mcp.notion.com", "api.notion.com"],
      linear: ["mcp.linear.app", "linear.app", "api.linear.app"],
      atlassian: [
        "mcp.atlassian.com",
        "auth.atlassian.com",
        "api.atlassian.com",
      ],
      slack: ["mcp.slack.com", "slack.com"],
      github: ["api.githubcopilot.com"],
    };
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !hosts[config.connector!.provider]?.includes(url.hostname)
    )
      throw new Error("Untrusted connector authorization endpoint.");
  }
  private remoteFetch(config: McpServerConfig): typeof fetch {
    return async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      this.assertRemoteUrl(config, url);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      if (config.connector!.provider === "github") {
        const context = await this.context(config);
        if (!context.accessToken)
          throw new ConnectorAuthorizationError("Reconnect GitHub.");
        headers.set("Authorization", `Bearer ${context.accessToken}`);
      }
      return this.fetcher(input, { ...init, headers, redirect: "error" });
    };
  }
  async context(config: McpServerConfig): Promise<ConnectorAuthContext> {
    await this.options.assertTrusted(config);
    const definition = this.definition(config);
    let secret = await this.secret(config);
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
        refresh = (async () => {
          const provider = definition.provider as
              "google" | "microsoft" | "github",
            client = this.client(provider);
          try {
            const token = await this.token(
              provider === "google"
                ? "https://oauth2.googleapis.com/token"
                : provider === "github"
                  ? "https://github.com/login/oauth/access_token"
                  : "https://login.microsoftonline.com/common/oauth2/v2.0/token",
              {
                client_id: client.clientId,
                ...("clientSecret" in client && client.clientSecret
                  ? { client_secret: client.clientSecret }
                  : {}),
                refresh_token: saved.refreshToken!,
                grant_type: "refresh_token",
              },
            );
            if (!token.access_token)
              throw new ConnectorAuthorizationError(
                "Authorization did not return an access token.",
              );
            if ((this.generation.get(config.id) ?? 0) !== revision)
              throw new Error("Connector was disconnected.");
            const next = {
              ...saved,
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
            if (this.refreshing.get(config.id) === refresh)
              this.refreshing.delete(config.id);
          })
          .catch(() => {});
      }
      secret = await refresh;
    }
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
      const slack =
        definition.provider === "slack"
          ? this.options.clients.slack
          : undefined;
      return {
        fetch: this.remoteFetch(config),
        oauthProvider: new SecureMcpOAuthProvider(
          config.id,
          secret.oauth.redirectUrl!,
          this.oauthStore(config, this.generation.get(config.id) ?? 0),
          () => {
            throw new ConnectorAuthorizationError("Reconnect this account.");
          },
          slack
            ? { clientId: slack.clientId, scopes: definition.scopes }
            : undefined,
        ),
      };
    }
    const context = await this.context(config);
    return definition.provider === "github" && context.accessToken
      ? { bearerToken: context.accessToken, fetch: this.remoteFetch(config) }
      : undefined;
  }
}
