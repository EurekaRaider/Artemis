import type { McpExposureSettings } from "@artemis/protocol";
import type { ConnectorDefinition } from "../connectors.js";
import type { McpRuntimeTool } from "@artemis/protocol";
import type { SettingsSnapshot } from "./settings.js";
export interface McpApi {
  saveMcpServer(
    config: McpServerConfig,
    bearerToken?: string,
    credentialEnv?: Record<string, string>,
  ): Promise<SettingsSnapshot>;
  setMcpServerEnabled(
    serverId: string,
    enabled: boolean,
  ): Promise<SettingsSnapshot>;
  reconnectMcpServer(serverId: string): Promise<SettingsSnapshot>;
  authorizeMcpServer(serverId: string): Promise<SettingsSnapshot>;
  removeMcpServer(serverId: string): Promise<SettingsSnapshot>;
  confirmResourceAction(message: string): Promise<boolean>;
  listMcpServers(): Promise<McpServerStatus[]>;
  searchMcpCatalog(query: string): Promise<McpCatalogItem[]>;
  installMcpCatalog(
    request: McpCatalogInstallRequest,
  ): Promise<SettingsSnapshot>;
}

export interface McpResourceMetadata extends McpExposureSettings {
  resourceKind?: "mcp" | "connector";
  connectorId?: string;
  connector?: ConnectorDefinition;
}

export type McpServerConfig = (
  | {
      id: string;
      name: string;
      transport: "stdio";
      enabled: boolean;
      command: string;
      args: string[];
      env: Record<string, string>;
      envVars: string[];
      credentialEnvVars?: string[];
      workspacePath: string;
      allowNetwork: boolean;
      fullAccess?: boolean;
    }
  | {
      id: string;
      name: string;
      transport: "streamable-http";
      enabled: boolean;
      url: string;
      auth?: "none" | "bearer" | "oauth" | "headers";
      credentialProviderId?: string;
      headerNames?: string[];
    }
) &
  McpResourceMetadata;

export interface McpServerStatus {
  config: McpServerConfig;
  state:
    | "disconnected"
    | "connecting"
    | "configuration-required"
    | "authorization-required"
    | "authorizing"
    | "connected"
    | "failed";
  error?: string;
  tools: McpRuntimeTool[];
}

export interface McpCatalogItem {
  configId: string;
  registryName: string;
  title: string;
  description: string;
  version: string;
  installable: boolean;
  installMode: "ready" | "needs-input" | "unsupported";
  installed: boolean;
  installOption?: McpCatalogInstallOption;
  remoteUrl?: string;
  repositoryUrl?: string;
  reason?: string;
}

export interface McpCatalogInstallInput {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  secret: boolean;
  defaultValue?: string;
}

export interface McpCatalogInstallOption {
  id: string;
  kind: "remote" | "npm-stdio";
  label: string;
  detail: string;
  inputs: McpCatalogInstallInput[];
}

export interface McpCatalogInstallRequest {
  registryName: string;
  version: string;
  optionId: string;
  inputValues: Record<string, string>;
  operationId: string;
}
