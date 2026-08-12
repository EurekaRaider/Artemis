import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { GoogleMcpHostAuth, McpServerConfig } from "../shared/api.js";

export type { McpServerConfig } from "../shared/api.js";

interface PersistedMcpConfig {
  version: 1 | 2;
  servers: McpServerConfig[];
}

function validateId(value: string): string {
  const id = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(id)) {
    throw new Error("MCP server ID is invalid");
  }
  return id;
}

function validateEnvironmentName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 128 || name.includes("=") || name.includes("\0")) {
    throw new Error("MCP environment variable name is invalid");
  }
  return name;
}

function validateHeaderName(value: string): string {
  const name = value.trim();
  if (
    !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u.test(name) ||
    [
      "accept",
      "connection",
      "content-length",
      "content-type",
      "host",
      "last-event-id",
      "mcp-protocol-version",
      "mcp-session-id",
      "proxy-authorization",
      "proxy-connection",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ].includes(name.toLowerCase())
  ) {
    throw new Error("MCP HTTP header name is invalid");
  }
  return name;
}

function credentialBinding(config: McpServerConfig): string | undefined {
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

function assertCredentialTargetUnchanged(
  previous: McpServerConfig,
  next: McpServerConfig,
): void {
  const previousBinding = credentialBinding(previous);
  const nextBinding = credentialBinding(next);
  if (!previousBinding || !nextBinding) return;
  if (previousBinding !== nextBinding) {
    throw new Error(
      "Uninstall and reinstall this MCP server to change its credential binding",
    );
  }
  if (
    previous.transport === "stdio" &&
    next.transport === "stdio" &&
    (previous.command !== next.command ||
      JSON.stringify(previous.args) !== JSON.stringify(next.args))
  ) {
    throw new Error(
      "Uninstall and reinstall this MCP server to change its credential target",
    );
  }
  if (
    previous.transport === "streamable-http" &&
    next.transport === "streamable-http" &&
    previous.url !== next.url
  ) {
    throw new Error(
      "Uninstall and reinstall this MCP server to change its credential target",
    );
  }
}

function validateResourceMetadata(input: McpServerConfig): {
  resourceKind?: "connector";
  connectorId?: string;
  hostAuth?: GoogleMcpHostAuth;
} {
  const resourceKind = (input as { resourceKind?: unknown }).resourceKind;
  if (
    resourceKind !== undefined &&
    resourceKind !== "mcp" &&
    resourceKind !== "connector"
  ) {
    throw new Error("MCP resource kind is invalid");
  }
  const rawHostAuth = (input as { hostAuth?: unknown }).hostAuth;
  let hostAuth: GoogleMcpHostAuth | undefined;
  if (rawHostAuth !== undefined) {
    if (
      !rawHostAuth ||
      typeof rawHostAuth !== "object" ||
      Array.isArray(rawHostAuth)
    ) {
      throw new Error("MCP host authentication is invalid");
    }
    const value = rawHostAuth as Record<string, unknown>;
    const scopes = Array.isArray(value.scopes)
      ? [
          ...new Set(
            value.scopes.filter(
              (scope): scope is string => typeof scope === "string",
            ),
          ),
        ]
      : [];
    if (
      value.provider !== "google" ||
      (value.grant !== "google-workspace" && value.grant !== "gmail") ||
      scopes.length === 0 ||
      scopes.length > 20 ||
      scopes.some(
        (scope) =>
          !["openid", "email", "profile"].includes(scope) &&
          !scope.startsWith("https://www.googleapis.com/auth/"),
      )
    ) {
      throw new Error("MCP Google host authentication is invalid");
    }
    hostAuth = {
      provider: "google",
      grant: value.grant,
      scopes,
    };
  }
  if (resourceKind !== "connector") return hostAuth ? { hostAuth } : {};
  if (hostAuth)
    throw new Error("Connector resources cannot use host authentication");
  const connectorId = (input as { connectorId?: unknown }).connectorId;
  if (
    typeof connectorId !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,119}$/u.test(connectorId)
  ) {
    throw new Error("Connector ID is invalid");
  }
  return { resourceKind: "connector", connectorId };
}

export function validateMcpServerConfig(
  input: McpServerConfig,
): McpServerConfig {
  const id = validateId(input.id);
  const resourceMetadata = validateResourceMetadata(input);
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw new Error("MCP server name is invalid");
  }
  if (input.transport === "stdio") {
    if (!input.command.trim() || input.args.length > 100) {
      throw new Error("MCP stdio command is invalid");
    }
    if (!input.workspacePath.trim()) {
      throw new Error("MCP stdio workspace is required");
    }
    const environmentEntries = Object.entries(input.env ?? {});
    const environmentVariables = input.envVars ?? [];
    const credentialEnvironmentVariables = input.credentialEnvVars ?? [];
    if (
      environmentEntries.length > 100 ||
      environmentVariables.length > 100 ||
      credentialEnvironmentVariables.length > 100
    ) {
      throw new Error("MCP stdio environment has too many entries");
    }
    const env = Object.fromEntries(
      environmentEntries.map(([key, value]) => {
        if (typeof value !== "string" || value.length > 32 * 1024) {
          throw new Error("MCP environment variable value is invalid");
        }
        return [validateEnvironmentName(key), value];
      }),
    );
    const envVars = [
      ...new Set(environmentVariables.map(validateEnvironmentName)),
    ];
    const credentialEnvVars = [
      ...new Set(credentialEnvironmentVariables.map(validateEnvironmentName)),
    ];
    if (
      credentialEnvVars.some(
        (name) => Object.hasOwn(env, name) || envVars.includes(name),
      )
    ) {
      throw new Error("MCP credential environment variable is duplicated");
    }
    return {
      ...structuredClone(input),
      ...resourceMetadata,
      id,
      name,
      command: input.command.trim(),
      env,
      envVars,
      credentialEnvVars,
      workspacePath: input.workspacePath.trim(),
      allowNetwork: true,
    };
  }
  if (input.hostAuth) {
    throw new Error("HTTP MCP servers cannot use Artemis host authentication");
  }
  const url = new URL(input.url);
  const loopback =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("MCP HTTP URL must use HTTPS or loopback HTTP");
  }
  const auth =
    input.auth ??
    (input.credentialProviderId ? ("bearer" as const) : ("none" as const));
  if (!["none", "bearer", "oauth", "headers"].includes(auth)) {
    throw new Error("MCP HTTP authentication mode is invalid");
  }
  const headerNames = (input.headerNames ?? []).map(validateHeaderName);
  if (
    new Set(headerNames.map((name) => name.toLowerCase())).size !==
    headerNames.length
  ) {
    throw new Error("MCP HTTP header names must be unique");
  }
  if (headerNames.length > 20) {
    throw new Error("MCP HTTP headers exceed the supported limit");
  }
  if ((auth === "headers") !== headerNames.length > 0) {
    throw new Error("MCP HTTP header authentication is invalid");
  }
  const {
    credentialProviderId,
    headerNames: _headerNames,
    ...withoutCredential
  } = structuredClone(input);
  return {
    ...withoutCredential,
    ...resourceMetadata,
    id,
    name,
    url: url.href,
    auth,
    ...(auth === "bearer" && credentialProviderId
      ? { credentialProviderId }
      : {}),
    ...(auth === "headers" ? { headerNames } : {}),
  };
}

export class McpConfigStore {
  private value: PersistedMcpConfig | undefined;

  constructor(private readonly filePath: string) {}

  private withDefaultWorkspace(input: McpServerConfig): McpServerConfig {
    if (input.transport !== "stdio" || input.workspacePath.trim()) return input;
    const id = validateId(input.id);
    return {
      ...input,
      id,
      workspacePath: join(dirname(this.filePath), "mcp-workspaces", id),
    };
  }

  async list(): Promise<McpServerConfig[]> {
    return structuredClone((await this.load()).servers);
  }

  async upsert(input: McpServerConfig): Promise<McpServerConfig> {
    const config = validateMcpServerConfig(this.withDefaultWorkspace(input));
    if (config.transport === "stdio") {
      await mkdir(config.workspacePath, { recursive: true });
    }
    const value = await this.load();
    const index = value.servers.findIndex((server) => server.id === config.id);
    if (index >= 0) {
      if (value.servers[index]!.transport !== config.transport) {
        throw new Error(
          "Uninstall the existing MCP server before changing its transport",
        );
      }
      assertCredentialTargetUnchanged(value.servers[index]!, config);
      value.servers[index] = config;
    } else {
      value.servers.push(config);
    }
    await this.save(value);
    return structuredClone(config);
  }

  async remove(serverId: string): Promise<void> {
    const value = await this.load();
    value.servers = value.servers.filter(
      (server) => server.id !== validateId(serverId),
    );
    await this.save(value);
  }

  async replaceAll(inputs: McpServerConfig[]): Promise<McpServerConfig[]> {
    const ids = new Set<string>();
    const current = await this.load();
    const previousById = new Map(
      current.servers.map((server) => [server.id, server]),
    );
    const servers = inputs.map((input) => {
      const config = validateMcpServerConfig(this.withDefaultWorkspace(input));
      if (ids.has(config.id)) {
        throw new Error(`Duplicate MCP server ID: ${config.id}`);
      }
      const previous = previousById.get(config.id);
      if (previous) assertCredentialTargetUnchanged(previous, config);
      ids.add(config.id);
      return config;
    });
    await Promise.all(
      servers.flatMap((server) =>
        server.transport === "stdio"
          ? [mkdir(server.workspacePath, { recursive: true })]
          : [],
      ),
    );
    const value: PersistedMcpConfig = { version: 2, servers };
    await this.save(value);
    return structuredClone(servers);
  }

  private async load(): Promise<PersistedMcpConfig> {
    if (this.value) return this.value;
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as PersistedMcpConfig;
      if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.servers)) {
        throw new Error("MCP configuration file is invalid");
      }
      this.value = {
        version: 2,
        servers: parsed.servers.map((server) =>
          validateMcpServerConfig(this.withDefaultWorkspace(server)),
        ),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.value = { version: 2, servers: [] };
    }
    return this.value;
  }

  private async save(value: PersistedMcpConfig): Promise<void> {
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
