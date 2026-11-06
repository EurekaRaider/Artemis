export interface ConnectorOAuth {
  applicationName: string;
  client:
    | { type: "static"; clientId: string }
    | { type: "native-public"; clientId: string; clientSecret: string }
    | { type: "dynamic" }
    | { type: "metadata"; url: string };
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  deviceAuthorizationEndpoint?: string;
  verificationOrigins?: string[];
  discoveryUrls?: string[];
  registrationEndpoint?: string;
  redirect: {
    hostname: "127.0.0.1" | "localhost";
    port?: number;
    path?: string;
  };
  resource?: string;
  mcpEndpoint?: string;
  requiredScopes: string[];
  scopeDescriptions?: Record<string, string>;
  scopeAliases?: Record<string, string>;
  authorizationParameters?: Record<string, string>;
  offlineRequired?: boolean;
  identity?: {
    endpoint: string;
    subject: string[];
    account: string[];
    requiredClaims?: Record<string, string | boolean>;
    group?: string;
  };
  backend?: { operator: string; url: string };
}
