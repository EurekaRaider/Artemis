export type ConnectorProvider =
  | "google"
  | "microsoft"
  | "github"
  | "qq"
  | "figma"
  | "notion"
  | "linear"
  | "atlassian"
  | "slack";
export type ConnectorAuth =
  "oauth-pkce" | "device-code" | "app-password" | "mcp-oauth" | "none";
export interface ConnectorDefinition {
  version: 1;
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
export const CONNECTOR_AUTH_META = "com.artemis.connector/auth";
const profiles: Record<
  ConnectorProvider,
  { auth: ConnectorAuth; ids: string[]; scopes: string[]; endpoint?: string }
> = {
  google: {
    auth: "oauth-pkce",
    ids: ["gmail", "google-workspace"],
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/calendar",
    ],
  },
  microsoft: {
    auth: "oauth-pkce",
    ids: ["outlook"],
    scopes: [
      "openid",
      "profile",
      "offline_access",
      "User.Read",
      "Mail.ReadWrite",
      "Mail.Send",
    ],
  },
  github: {
    auth: "device-code",
    ids: ["github"],
    scopes: ["read:user", "public_repo", "repo"],
    endpoint: "https://api.githubcopilot.com/mcp/",
  },
  qq: { auth: "app-password", ids: ["qq-mail"], scopes: [] },
  figma: {
    auth: "none",
    ids: ["figma"],
    scopes: [],
    endpoint: "http://127.0.0.1:3845/mcp",
  },
  notion: {
    auth: "mcp-oauth",
    ids: ["notion"],
    scopes: [],
    endpoint: "https://mcp.notion.com/mcp",
  },
  linear: {
    auth: "mcp-oauth",
    ids: ["linear"],
    scopes: ["read", "write", "issues:create", "comments:create"],
    endpoint: "https://mcp.linear.app/mcp",
  },
  atlassian: {
    auth: "mcp-oauth",
    ids: ["atlassian"],
    scopes: [],
    endpoint: "https://mcp.atlassian.com/v2/mcp",
  },
  slack: {
    auth: "mcp-oauth",
    ids: ["slack"],
    scopes: [
      "search:read.public",
      "search:read.private",
      "channels:history",
      "groups:history",
      "im:history",
      "mpim:history",
      "chat:write",
      "users:read",
    ],
    endpoint: "https://mcp.slack.com/mcp",
  },
};
export function validateConnectorDefinition(
  input: unknown,
): ConnectorDefinition {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Connector declaration is invalid.");
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "version",
          "id",
          "provider",
          "displayName",
          "auth",
          "scopes",
          "capabilities",
          "requiredHostCapabilities",
          "setup",
        ].includes(k),
    )
  )
    throw new Error("Unsupported connector declaration field.");
  const p =
    typeof v.provider === "string" && Object.hasOwn(profiles, v.provider)
      ? profiles[v.provider as ConnectorProvider]
      : undefined;
  if (
    v.version !== 1 ||
    !p ||
    !p.ids.includes(String(v.id)) ||
    v.auth !== p.auth ||
    typeof v.displayName !== "string" ||
    !v.displayName.trim() ||
    v.displayName.length > 120 ||
    !Array.isArray(v.scopes) ||
    v.scopes.length > 20 ||
    v.scopes.some((s) => typeof s !== "string" || !p.scopes.includes(s))
  )
    throw new Error(
      "Unsupported connector version, provider, identity or permissions.",
    );
  const setup =
    v.auth === "none"
      ? "desktop-mcp"
      : v.auth === "app-password"
        ? "authorization-code"
        : v.auth === "device-code"
          ? "device-code"
          : "browser";
  const capabilities =
    v.capabilities ?? (v.provider === "figma" ? ["read"] : ["read", "write"]);
  if (
    !Array.isArray(capabilities) ||
    !capabilities.length ||
    capabilities.some(
      (c) =>
        !["read", "write"].includes(c) ||
        (v.provider === "figma" && c === "write"),
    )
  )
    throw new Error("Unsupported connector capabilities.");
  if (v.setup !== undefined && v.setup !== setup)
    throw new Error(
      "Connector setup does not match its authentication method.",
    );
  const requiredHostCapabilities = v.requiredHostCapabilities ?? [
    "connector-v1",
  ];
  if (
    !Array.isArray(requiredHostCapabilities) ||
    requiredHostCapabilities.length !== 1 ||
    requiredHostCapabilities[0] !== "connector-v1"
  )
    throw new Error(
      "Update Artemis to use this connector's host capabilities.",
    );
  if (v.provider === "google") {
    const allowed =
      v.id === "gmail"
        ? [
            "openid",
            "email",
            "profile",
            "https://www.googleapis.com/auth/gmail.modify",
          ]
        : p.scopes.filter((s) => !s.includes("gmail"));
    if (
      v.scopes.some((s) => !allowed.includes(s)) ||
      !allowed.every((s) => (v.scopes as string[]).includes(s))
    )
      throw new Error(
        "Google connector grant does not match its capabilities.",
      );
  }
  return {
    version: 1,
    id: v.id as string,
    provider: v.provider as ConnectorProvider,
    displayName: v.displayName.trim(),
    auth: v.auth as ConnectorAuth,
    scopes: [...new Set(v.scopes as string[])],
    capabilities: [...new Set(capabilities)] as Array<"read" | "write">,
    requiredHostCapabilities: ["connector-v1"],
    setup,
  };
}
export function assertConnectorTransport(
  definition: ConnectorDefinition,
  transport: string,
  url?: string,
): void {
  const profile = profiles[definition.provider];
  if (
    profile.endpoint
      ? transport !== "streamable-http" || url !== profile.endpoint
      : transport !== "stdio"
  )
    throw new Error(
      "Connector transport or resource endpoint does not match its provider.",
    );
}
