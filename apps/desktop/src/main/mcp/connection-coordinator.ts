import { isMcpServerSupported } from "../computer-use/config.js";

import { shell } from "electron";
import type {
  McpConnectionAuthentication,
  McpConnectOptions,
} from "../mcp/mcp-client-manager.js";
import {
  validateMcpServerConfig,
  assertCredentialTargetUnchanged,
} from "../mcp/mcp-config-store.js";
import {
  SecureMcpOAuthProvider,
  startMcpOAuthCallback,
} from "../mcp/mcp-oauth-provider.js";
import { connectorBinding } from "../connectors/connector-service.js";
import {
  type McpServerConfig,
  type SettingsSnapshot,
} from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "settingsStore"
  | "connectorService"
  | "mcpSecretStore"
  | "mcpOAuthStore"
  | "mcpClientManager"
  | "computerUseHost"
  | "computerUseServerId"
  | "artemisPluginService"
  | "mcpConfigStore"
  | "applyAgentRuntime"
  | "activeMcpCalls"
  | "diagnosticBundleService"
  | "resetAgentThreadsForToolChange"
  | "getSettingsSnapshot"
>;
export function createConnectionCoordinator(services: Dependencies) {
  const {
    applyAgentRuntime,
    activeMcpCalls,
    resetAgentThreadsForToolChange,
    getSettingsSnapshot,
  } = services;
  async function mcpBearerToken(
    config: McpServerConfig,
  ): Promise<string | undefined> {
    if (
      config.transport !== "streamable-http" ||
      (config.auth ?? (config.credentialProviderId ? "bearer" : "none")) !==
        "bearer" ||
      !services.settingsStore
    ) {
      return undefined;
    }
    const credentialProviderId =
      config.credentialProviderId ?? `mcp.${config.id}`;
    const credential = (await services.settingsStore.runtimeConfiguration())
      .credentials[credentialProviderId];
    return credential?.type === "api_key" ? credential.key : undefined;
  }

  async function mcpAuthentication(
    config: McpServerConfig,
  ): Promise<string | McpConnectionAuthentication | undefined> {
    if (config.connector) {
      if (!services.connectorService)
        throw new Error("Connector service is not ready.");
      return services.connectorService.authentication(config);
    }
    if (config.transport === "stdio") {
      for (const name of config.envVars) {
        if (!config.env[name] && !process.env[name])
          throw new Error(`MCP environment variable is unavailable: ${name}`);
      }
      const names = config.credentialEnvVars ?? [];
      if (names.length === 0) return undefined;
      if (!services.mcpSecretStore)
        throw new Error("MCP secret service is not ready.");
      const stored = await services.mcpSecretStore.get(config.id);
      const stdioEnv = Object.fromEntries(
        names.map((name) => {
          const value = stored.env[name];
          if (!value) {
            throw new Error(`MCP credential is unavailable: ${name}`);
          }
          return [name, value];
        }),
      );
      return { stdioEnv };
    }
    const auth =
      config.auth ?? (config.credentialProviderId ? "bearer" : "none");
    if (auth === "headers") {
      if (!services.mcpSecretStore)
        throw new Error("MCP secret service is not ready.");
      const stored = await services.mcpSecretStore.get(config.id);
      const headers = Object.fromEntries(
        (config.headerNames ?? []).map((name) => {
          const value = stored.headers[name];
          if (!value) {
            throw new Error(`MCP credential is unavailable: ${name}`);
          }
          return [name, value];
        }),
      );
      return { headers };
    }
    if (auth === "bearer") {
      const token = await mcpBearerToken(config);
      if (!token) throw new Error("MCP bearer credential is unavailable.");
      return token;
    }
    if (auth !== "oauth") return undefined;
    if (!services.mcpOAuthStore) {
      throw new Error("MCP OAuth service is not ready.");
    }
    const stored = services.mcpOAuthStore.encryptionAvailable
      ? await services.mcpOAuthStore.get(config.id)
      : {};
    const redirectUrl =
      stored.redirectUrl ??
      `http://127.0.0.1:43729/mcp-oauth/${encodeURIComponent(config.id)}`;
    return {
      oauthProvider: new SecureMcpOAuthProvider(
        config.id,
        redirectUrl,
        services.mcpOAuthStore,
        () => {},
      ),
    };
  }

  async function authorizeMcpServer(config: McpServerConfig): Promise<void> {
    if (
      config.transport !== "streamable-http" ||
      config.auth !== "oauth" ||
      !services.mcpOAuthStore ||
      !services.mcpClientManager
    ) {
      throw new Error("MCP server is not configured for OAuth.");
    }
    if (!services.mcpOAuthStore.encryptionAvailable) {
      throw new Error("OS credential encryption is required for MCP OAuth.");
    }
    let provider: SecureMcpOAuthProvider | undefined;
    const callback = await startMcpOAuthCallback(
      config.id,
      (state) => provider?.matchesState(state) ?? false,
    );
    void callback.authorizationCode.catch(() => {});
    try {
      await services.mcpOAuthStore.update(config.id, () => ({
        redirectUrl: callback.redirectUrl,
      }));
      provider = new SecureMcpOAuthProvider(
        config.id,
        callback.redirectUrl,
        services.mcpOAuthStore,
        (url) => shell.openExternal(url.toString()),
      );
      const status = await services.mcpClientManager.connect(config, {
        oauthProvider: provider,
        authorizationCode: callback.authorizationCode,
      });
      if (status.state !== "connected") {
        throw new Error(status.error ?? "MCP OAuth connection failed.");
      }
    } finally {
      await callback.close();
    }
  }

  async function connectMcpServer(
    config: McpServerConfig,
    authorizeMissingOAuth = false,
    options?: McpConnectOptions,
  ): Promise<void> {
    if (!services.mcpClientManager) {
      throw new Error("MCP service is not ready.");
    }
    if (!isMcpServerSupported(config, process.platform))
      throw new Error("Computer Use is unavailable on this platform.");
    if (await services.artemisPluginService?.isComputerUseServer(config)) {
      if (!services.computerUseHost || config.transport !== "streamable-http")
        throw new Error("Computer Use is unavailable on this platform.");
      const connection = await services.computerUseHost.server.start();
      services.computerUseServerId = config.id;
      const status = await services.mcpClientManager.connect(
        { ...config, url: connection.url },
        { bearerToken: connection.bearerToken },
      );
      if (status.state !== "connected")
        throw new Error(status.error ?? "Computer Use connection failed.");
      return;
    }
    let authentication: Awaited<ReturnType<typeof mcpAuthentication>>;
    try {
      authentication = await mcpAuthentication(config);
    } catch (error) {
      await services.mcpClientManager.configurationRequired(
        config,
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    const status = await services.mcpClientManager.connect(
      config,
      authentication,
      options,
    );
    if (status.state === "failed") {
      throw new Error(
        status.error ?? `MCP server ${config.name} failed to connect.`,
      );
    }
    if (
      authorizeMissingOAuth &&
      config.transport === "streamable-http" &&
      config.auth === "oauth" &&
      status.state === "authorization-required"
    ) {
      await authorizeMcpServer(config);
    }
  }

  async function ensureConnectorReady(config: McpServerConfig): Promise<void> {
    if (!config.connector) return;
    if (!services.connectorService)
      throw new Error("Connector service is not ready.");
    await services.connectorService.authentication(config);
  }

  async function disableConnector(id: string): Promise<void> {
    await services.mcpClientManager?.disconnect(id);
    const configs = await services.mcpConfigStore?.list();
    if (configs)
      await services.mcpConfigStore?.replaceAll(
        configs.map((c) => (c.id === id ? { ...c, enabled: false } : c)),
      );
    await applyAgentRuntime();
  }

  async function disconnectMcpServers(serverIds: string[]): Promise<void> {
    if (!services.mcpClientManager)
      throw new Error("MCP service is not ready.");
    for (const call of activeMcpCalls.values())
      if (serverIds.includes(call.serverId)) call.controller.abort();
    if (
      services.computerUseServerId &&
      serverIds.includes(services.computerUseServerId)
    ) {
      services.computerUseHost?.dispose();
      services.computerUseServerId = undefined;
    }
    await Promise.all(
      serverIds.map((serverId) => {
        services.connectorService?.invalidate(serverId);
        return services.mcpClientManager!.disconnect(serverId);
      }),
    );
  }

  async function reconnectEnabledMcpServers(
    configs: McpServerConfig[],
    authorizeMissingOAuth = false,
  ): Promise<void> {
    if (!services.mcpClientManager) return;
    for (const config of configs.filter((candidate) => candidate.enabled)) {
      try {
        await connectMcpServer(config, authorizeMissingOAuth);
      } catch (error) {
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `MCP server ${config.id} did not reconnect after a plugin change: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }
  }

  function mcpSecretBinding(config: McpServerConfig): string | undefined {
    if (
      config.transport === "stdio" &&
      (config.credentialEnvVars?.length ?? 0) > 0
    ) {
      return `env:${[...(config.credentialEnvVars ?? [])].sort().join("\0")}`;
    }
    if (config.transport === "streamable-http" && config.auth === "headers") {
      return `headers:${[...(config.headerNames ?? [])].sort().join("\0")}`;
    }
    return undefined;
  }

  async function assertMcpSecretsAvailable(
    config: McpServerConfig,
  ): Promise<void> {
    if (!mcpSecretBinding(config)) return;
    if (!services.mcpSecretStore)
      throw new Error("MCP secret service is not ready.");
    const stored = await services.mcpSecretStore.get(config.id);
    const missing =
      config.transport === "stdio"
        ? (config.credentialEnvVars ?? []).find((name) => !stored.env[name])
        : (config.headerNames ?? []).find((name) => !stored.headers[name]);
    if (missing) {
      throw new Error(`MCP credential is unavailable: ${missing}`);
    }
  }

  async function removeMcpAuthentication(
    config: McpServerConfig,
  ): Promise<void> {
    if (
      (config.transport === "stdio" &&
        (config.credentialEnvVars?.length ?? 0) > 0) ||
      (config.transport === "streamable-http" && config.auth === "headers")
    ) {
      await services.mcpSecretStore?.delete(config.id);
    }
    if (
      config.transport === "streamable-http" &&
      (config.auth ?? (config.credentialProviderId ? "bearer" : "none")) ===
        "bearer"
    ) {
      await services.settingsStore?.deleteCredential(
        config.credentialProviderId ?? `mcp.${config.id}`,
      );
    }
    if (config.transport === "streamable-http" && config.auth === "oauth") {
      await services.mcpOAuthStore?.delete(config.id);
    }
  }

  async function cleanupRemovedMcpAuthentication(
    before: McpServerConfig[],
    after: McpServerConfig[],
    scopedIds: ReadonlySet<string>,
  ): Promise<void> {
    for (const previous of before) {
      if (!scopedIds.has(previous.id)) continue;
      const current = after.find((candidate) => candidate.id === previous.id);
      if (
        previous.connector &&
        (!current?.connector ||
          connectorBinding(previous) !== connectorBinding(current))
      )
        await services.connectorService?.disconnect(previous.id);
      if (
        !current ||
        current.transport !== previous.transport ||
        (mcpSecretBinding(previous) !== undefined &&
          mcpSecretBinding(current) !== mcpSecretBinding(previous)) ||
        (current.transport === "streamable-http" &&
          previous.transport === "streamable-http" &&
          (current.url !== previous.url ||
            (current.auth ??
              (current.credentialProviderId ? "bearer" : "none")) !==
              (previous.auth ??
                (previous.credentialProviderId ? "bearer" : "none")) ||
            current.credentialProviderId !== previous.credentialProviderId))
      ) {
        await removeMcpAuthentication(previous);
      }
    }
  }

  async function saveMcpConfiguration(
    input: McpServerConfig,
    bearerToken?: string,
    connectionOptions?: McpConnectOptions,
    rejectConnectionFailure = false,
    credentialEnv?: Record<string, string>,
  ): Promise<SettingsSnapshot> {
    if (
      !services.mcpConfigStore ||
      !services.mcpClientManager ||
      !services.settingsStore
    ) {
      throw new Error("MCP service is not ready.");
    }
    await resetAgentThreadsForToolChange();
    const existing = (await services.mcpConfigStore.list()).find(
      (server) => server.id === input.id,
    );
    let config = validateMcpServerConfig(input);
    if (existing) assertCredentialTargetUnchanged(existing, config);
    if (credentialEnv && Object.keys(credentialEnv).length > 0) {
      if (config.transport !== "stdio" || !services.mcpSecretStore)
        throw new Error("MCP credential service is unavailable.");
      const names = config.credentialEnvVars ?? [];
      if (Object.keys(credentialEnv).some((name) => !names.includes(name)))
        throw new Error("MCP credential variable is not declared.");
      const stored = await services.mcpSecretStore.get(config.id);
      const env = { ...stored.env, ...credentialEnv };
      if (names.some((name) => !env[name]))
        throw new Error("MCP credential value is required.");
      await services.mcpSecretStore.set(config.id, {
        env: Object.fromEntries(names.map((name) => [name, env[name]!])),
        headers: stored.headers,
      });
    }
    if (
      config.transport === "streamable-http" &&
      config.auth === "bearer" &&
      bearerToken?.trim()
    ) {
      const credentialProviderId = `mcp.${config.id}`;
      await services.settingsStore.saveCredential(credentialProviderId, {
        type: "api_key",
        key: bearerToken.trim(),
      });
      config = { ...config, credentialProviderId };
    }
    await assertMcpSecretsAvailable(config);
    const saved = await services.mcpConfigStore.upsert(config);
    if (
      existing &&
      mcpSecretBinding(existing) !== undefined &&
      mcpSecretBinding(saved) !== mcpSecretBinding(existing)
    ) {
      await services.mcpSecretStore?.delete(existing.id);
    }
    if (
      existing?.transport === "streamable-http" &&
      (existing.auth ?? (existing.credentialProviderId ? "bearer" : "none")) ===
        "bearer" &&
      (saved.transport !== "streamable-http" || saved.auth !== "bearer")
    ) {
      await services.settingsStore.deleteCredential(
        existing.credentialProviderId ?? `mcp.${existing.id}`,
      );
    }
    if (saved.enabled) {
      try {
        await connectMcpServer(saved, true, connectionOptions);
      } catch (error) {
        if (rejectConnectionFailure || saved.transport !== "stdio") throw error;
        services.diagnosticBundleService?.record({
          source: "main",
          severity: "warning",
          message: `MCP server ${saved.id} remains enabled but did not connect: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    } else {
      await services.mcpClientManager.disconnect(saved.id);
    }
    await applyAgentRuntime();
    return getSettingsSnapshot();
  }
  return {
    mcpBearerToken,
    mcpAuthentication,
    authorizeMcpServer,
    connectMcpServer,
    ensureConnectorReady,
    disableConnector,
    disconnectMcpServers,
    reconnectEnabledMcpServers,
    mcpSecretBinding,
    assertMcpSecretsAvailable,
    removeMcpAuthentication,
    cleanupRemovedMcpAuthentication,
    saveMcpConfiguration,
  };
}
