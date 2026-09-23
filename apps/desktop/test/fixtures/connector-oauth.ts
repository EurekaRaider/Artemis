import type { ConnectorDefinition } from "../../src/shared/connectors.js";
export const futureConnector = {
  version: 2,
  id: "future-service",
  provider: "future-platform",
  displayName: "Future Service",
  auth: "oauth-pkce",
  scopes: ["records.read"],
  requiredHostCapabilities: ["connector-oauth-v2"],
  oauth: {
    client: { type: "static", clientId: "public-future-client" },
    applicationName: "Future Desktop",
    issuer: "https://identity.example.com/",
    authorizationEndpoint: "https://identity.example.com/authorize",
    tokenEndpoint: "https://identity.example.com/token",
    redirect: { hostname: "127.0.0.1" },
    resource: "https://api.example.com/",
    requiredScopes: ["records.read"],
    identity: {
      endpoint: "https://api.example.com/me",
      subject: ["id"],
      account: ["email"],
    },
  },
} as ConnectorDefinition;

export const futureOwner = {
  pluginId: "signed-future-plugin",
  signingKeyFingerprint: "trusted-test-key",
  marketplaceUrl: "https://example.com/marketplace",
};
export const futureRemoteConnector: ConnectorDefinition = {
  ...futureConnector,
  id: "notion",
  auth: "mcp-oauth",
  scopes: [],
  oauth: {
    ...futureConnector.oauth!,
    requiredScopes: [],
    client: { type: "dynamic" },
    mcpEndpoint: "https://mcp.notion.com/mcp",
    resource: "https://mcp.notion.com/mcp",
    discoveryUrls: [
      "https://identity.example.com/.well-known/oauth-authorization-server",
    ],
    registrationEndpoint: "https://identity.example.com/register",
  },
};

// Remote fixtures do not require an account endpoint.
delete futureRemoteConnector.oauth!.identity;
