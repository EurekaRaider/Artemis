import type { ConnectorDefinition } from "./connectors.js";

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

function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("OAuth declaration must be an object.");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ["__proto__", "prototype", "constructor"].includes(k) ||
        (keys && !keys.includes(k)),
    )
  )
    throw new Error("Unsupported OAuth declaration field.");
  return v;
}
function string(value: unknown, maximum = 2048): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    throw new Error("Invalid OAuth declaration string.");
  return value;
}
function strings(value: unknown, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error("Invalid OAuth declaration list.");
  return [...new Set(value.map((v) => string(v)))];
}
export function publicOAuthUrl(value: unknown): string {
  const text = string(value);
  const u = new URL(text);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.hash ||
    u.search ||
    u.port ||
    !u.hostname.includes(".") ||
    u.hostname.endsWith(".") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(u.hostname) ||
    /^[\d.]+$/u.test(u.hostname) ||
    u.hostname.includes(":")
  )
    throw new Error(
      "OAuth endpoints require a public HTTPS URL without credentials, query or fragment.",
    );
  return u.href;
}
function map(value: unknown): Record<string, string> {
  const v = object(value);
  if (Object.keys(v).length > 64) throw new Error("Too many OAuth parameters.");
  return Object.fromEntries(
    Object.entries(v).map(([k, v]) => [string(k, 200), string(v)]),
  );
}
const reservedParameters = new Set([
  "client_id",
  "client_secret",
  "client_assertion",
  "client_assertion_type",
  "redirect_uri",
  "response_type",
  "grant_type",
  "scope",
  "state",
  "nonce",
  "code",
  "code_verifier",
  "code_challenge",
  "code_challenge_method",
  "access_token",
  "refresh_token",
  "resource",
  "request",
  "request_uri",
]);
export function validateOAuthConnector(input: unknown): ConnectorDefinition {
  const d = object(input, [
    "version",
    "id",
    "provider",
    "displayName",
    "auth",
    "scopes",
    "capabilities",
    "requiredHostCapabilities",
    "setup",
    "oauth",
  ]);
  if (
    d.version !== 2 ||
    !["oauth-pkce", "device-code", "mcp-oauth"].includes(String(d.auth))
  )
    throw new Error("Unsupported OAuth connector version or flow.");
  for (const key of ["id", "provider"])
    if (!/^[a-z0-9][a-z0-9._-]{0,99}$/u.test(string(d[key], 100)))
      throw new Error("Invalid connector identity.");
  const scopes = strings(d.scopes);
  if (scopes.some((s) => /\s/u.test(s)))
    throw new Error("Invalid OAuth scope.");
  if (JSON.stringify(d.requiredHostCapabilities) !== '["connector-oauth-v2"]')
    throw new Error("OAuth connectors require connector-oauth-v2.");
  const v = object(d.oauth, [
    "applicationName",
    "client",
    "issuer",
    "authorizationEndpoint",
    "tokenEndpoint",
    "deviceAuthorizationEndpoint",
    "verificationOrigins",
    "discoveryUrls",
    "registrationEndpoint",
    "redirect",
    "resource",
    "mcpEndpoint",
    "requiredScopes",
    "scopeDescriptions",
    "scopeAliases",
    "authorizationParameters",
    "offlineRequired",
    "identity",
    "backend",
  ]);
  const client = object(v.client, ["type", "clientId", "url", "clientSecret"]);
  let registration: ConnectorOAuth["client"];
  if (
    client.type === "native-public" &&
    d.auth === "oauth-pkce" &&
    client.url === undefined
  )
    registration = {
      type: "native-public",
      clientId: string(client.clientId, 512),
      clientSecret: string(client.clientSecret, 2048),
    };
  else if (client.clientSecret !== undefined)
    throw new Error(
      "Only explicitly non-confidential native PKCE clients may declare a compatibility secret.",
    );
  else if (client.type === "static" && !client.url)
    registration = { type: "static", clientId: string(client.clientId, 512) };
  else if (client.type === "dynamic" && !client.clientId && !client.url)
    registration = { type: "dynamic" };
  else if (client.type === "metadata" && !client.clientId)
    registration = { type: "metadata", url: publicOAuthUrl(client.url) };
  else throw new Error("Invalid public OAuth client registration.");
  if (
    d.auth !== "mcp-oauth" &&
    registration.type !== "static" &&
    registration.type !== "native-public"
  )
    throw new Error("This flow requires a pre-registered public client.");
  const r = object(v.redirect, ["hostname", "port", "path"]);
  if (
    !["localhost", "127.0.0.1"].includes(String(r.hostname)) ||
    (r.port !== undefined &&
      (!Number.isInteger(r.port) ||
        Number(r.port) < 1024 ||
        Number(r.port) > 65535)) ||
    (r.path !== undefined && !/^\/[a-zA-Z0-9/_-]{1,180}$/u.test(String(r.path)))
  )
    throw new Error("OAuth requires an exact host-owned loopback callback.");
  const oauth: ConnectorOAuth = {
    applicationName: string(v.applicationName, 120),
    client: registration,
    issuer: publicOAuthUrl(v.issuer),
    authorizationEndpoint: publicOAuthUrl(v.authorizationEndpoint),
    tokenEndpoint: publicOAuthUrl(v.tokenEndpoint),
    redirect: {
      hostname: r.hostname as "localhost" | "127.0.0.1",
      ...(r.port !== undefined ? { port: Number(r.port) } : {}),
      ...(r.path !== undefined ? { path: String(r.path) } : {}),
    },
    requiredScopes: strings(v.requiredScopes),
  };
  if (oauth.requiredScopes.some((s) => !scopes.includes(s)))
    throw new Error("Required OAuth scope was not requested.");
  for (const key of [
    "deviceAuthorizationEndpoint",
    "registrationEndpoint",
    "resource",
    "mcpEndpoint",
  ] as const)
    if (v[key] !== undefined) oauth[key] = publicOAuthUrl(v[key]);
  for (const key of ["discoveryUrls", "verificationOrigins"] as const)
    if (v[key] !== undefined)
      oauth[key] = strings(v[key], 12).map(publicOAuthUrl);
  if (oauth.verificationOrigins?.some((s) => new URL(s).pathname !== "/"))
    throw new Error("Device verification allowlist requires origins.");
  if (
    d.auth === "device-code" &&
    (!oauth.deviceAuthorizationEndpoint || !oauth.verificationOrigins?.length)
  )
    throw new Error(
      "Device flow requires a device endpoint and verification origins.",
    );
  if (
    d.auth === "mcp-oauth" &&
    (!oauth.mcpEndpoint ||
      !oauth.resource ||
      !oauth.discoveryUrls?.length ||
      (registration.type === "dynamic" && !oauth.registrationEndpoint))
  )
    throw new Error(
      "Remote MCP requires declared discovery, resource and registration endpoints.",
    );
  const credentialEndpoints = [
    oauth.tokenEndpoint,
    oauth.registrationEndpoint,
    oauth.deviceAuthorizationEndpoint,
    oauth.mcpEndpoint,
  ].filter(Boolean);
  if (
    new Set(credentialEndpoints).size !== credentialEndpoints.length ||
    oauth.discoveryUrls?.some((url) => credentialEndpoints.includes(url))
  )
    throw new Error("OAuth endpoint roles must be distinct.");
  if (registration.type === "metadata" && (!r.port || !r.path))
    throw new Error("Client metadata registration requires a fixed callback.");
  for (const key of [
    "scopeDescriptions",
    "scopeAliases",
    "authorizationParameters",
  ] as const)
    if (v[key] !== undefined) oauth[key] = map(v[key]);
  if (
    Object.values(oauth.scopeAliases ?? {}).some((s) => !scopes.includes(s)) ||
    Object.keys(oauth.scopeDescriptions ?? {}).some((s) => !scopes.includes(s))
  )
    throw new Error("Scope metadata must refer to requested permissions.");
  if (
    Object.keys(oauth.authorizationParameters ?? {}).some(
      (k) =>
        reservedParameters.has(k.toLowerCase()) ||
        /secret|token|password|assertion/iu.test(k),
    )
  )
    throw new Error("OAuth transaction parameters cannot be overridden.");
  if (v.offlineRequired !== undefined) {
    if (typeof v.offlineRequired !== "boolean")
      throw new Error("Invalid offline authorization requirement.");
    oauth.offlineRequired = v.offlineRequired;
  }
  if (v.identity !== undefined) {
    const i = object(v.identity, [
      "endpoint",
      "subject",
      "account",
      "requiredClaims",
      "group",
    ]);
    const subject = strings(i.subject, 8),
      account = strings(i.account, 8);
    if (
      !subject.length ||
      !account.length ||
      [...subject, ...account].some(
        (s) =>
          !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/u.test(s) ||
          s
            .split(".")
            .some((p) => ["__proto__", "constructor", "prototype"].includes(p)),
      )
    )
      throw new Error("Invalid account field mapping.");
    oauth.identity = { endpoint: publicOAuthUrl(i.endpoint), subject, account };
    if (i.group !== undefined) oauth.identity.group = string(i.group, 100);
    if (i.requiredClaims !== undefined) {
      const claims = object(i.requiredClaims);
      if (
        Object.keys(claims).length > 10 ||
        Object.entries(claims).some(
          ([k, v]) =>
            !/^[a-zA-Z0-9_-]+$/u.test(k) ||
            (typeof v !== "boolean" && typeof v !== "string"),
        )
      )
        throw new Error("Invalid required account claims.");
      oauth.identity.requiredClaims = claims as Record<
        string,
        string | boolean
      >;
    }
  }
  if (v.backend !== undefined) {
    const b = object(v.backend, ["operator", "url"]);
    oauth.backend = {
      operator: string(b.operator, 120),
      url: publicOAuthUrl(b.url),
    };
  }
  const capabilities = strings(d.capabilities ?? ["read", "write"], 2);
  if (
    !capabilities.length ||
    capabilities.some((c) => !["read", "write"].includes(c))
  )
    throw new Error("Unsupported connector capabilities.");
  const setup = d.auth === "device-code" ? "device-code" : "browser";
  if (d.setup !== undefined && d.setup !== setup)
    throw new Error("OAuth setup does not match its flow.");
  return {
    version: 2,
    id: String(d.id),
    provider: String(d.provider),
    displayName: string(d.displayName, 120),
    auth: d.auth as ConnectorDefinition["auth"],
    scopes,
    capabilities: capabilities as Array<"read" | "write">,
    requiredHostCapabilities: ["connector-oauth-v2"],
    setup,
    oauth,
  };
}

/** Canonical authorization contract. Display text does not grant access. */
export function connectorSecurityContract(
  definition: ConnectorDefinition | undefined,
): unknown {
  if (!definition || definition.version !== 2) return definition;
  const { displayName: _name, oauth, ...rest } = definition;
  if (!oauth) return rest;
  const {
    applicationName: _app,
    scopeDescriptions: _descriptions,
    backend,
    ...security
  } = oauth;
  return {
    ...rest,
    scopes: [...rest.scopes].sort(),
    oauth: {
      ...security,
      requiredScopes: [...security.requiredScopes].sort(),
      ...(backend ? { backend: { url: backend.url } } : {}),
    },
  };
}
export function canonicalConnectorJson(value: unknown): string {
  const ordered = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b, "en"))
              .map(([k, item]) => [k, ordered(item)]),
          )
        : v;
  return JSON.stringify(ordered(value));
}
