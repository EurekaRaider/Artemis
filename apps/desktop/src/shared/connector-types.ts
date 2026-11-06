import type { ConnectorOAuth } from "./oauth-contracts.js";

export type ConnectorProvider = string;

export type ConnectorAuth =
  "oauth-pkce" | "device-code" | "app-password" | "mcp-oauth" | "none";

export interface ConnectorDefinition {
  version: 1 | 2;
  oauth?: ConnectorOAuth;
  id: string;
  provider: ConnectorProvider;
  displayName: string;
  auth: ConnectorAuth;
  scopes: string[];
  capabilities?: Array<"read" | "write">;
  requiredHostCapabilities?: string[];
  setup?: "browser" | "device-code" | "authorization-code" | "desktop-mcp";
}

export interface ConnectorCatalogEntry extends ConnectorDefinition {
  serverId: string;
  installed: boolean;
  pluginId?: string | undefined;
}

export interface ConnectorConnection {
  id: string;
  definition: ConnectorDefinition;
  state:
    | "disconnected"
    | "connecting"
    | "connected"
    | "authorization-required"
    | "unavailable";
  account?: string;
  error?: string;
  userCode?: string;
  verificationUri?: string;
}

export interface ConnectorConnectInput {
  serverId: string;
  email?: string;
  appPassword?: string;
}

export interface ConnectorAuthContext {
  version: 1;
  provider: ConnectorProvider;
  connectionId: string;
  account?: string;
  accessToken?: string;
  appPassword?: string;
}
