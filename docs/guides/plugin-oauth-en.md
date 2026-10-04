[English / 简体中文](plugin-oauth.md)

# Plugin OAuth v2

Plugins declare integration details; Artemis executes authorization flows. Public client IDs may be included in signed plugins. Server secrets, user tokens and private keys must not enter plugin packages, except distributable compatibility parameters explicitly declared for native public clients. Platforms requiring confidential server credentials must use a developer backend.

## Declaration

In `.mcp.json`, set `mcpServers.<name>.x-artemis.connector` to `version: 2` and `requiredHostCapabilities: ["connector-oauth-v2"]`. `provider` is a plugin-defined identifier, not proof of official platform certification. Complete types and validation live in `apps/desktop/src/shared/connector-oauth.ts`; the corresponding PluginShop file follows the same rules.

- Common fields: `id`, `provider`, `displayName`, `auth`, `scopes`, `capabilities`.
- `oauth.applicationName`: registered application name.
- `oauth.client`: `{type:"static",clientId}`, `{type:"native-public",clientId,clientSecret}` (PKCE only), `{type:"dynamic"}`, or `{type:"metadata",url}`. The last two apply only to Remote MCP; metadata documents must preregister the fixed local callback.
- `issuer`, `authorizationEndpoint`, `tokenEndpoint`: a fixed issuer and purpose-separated endpoints.
- `redirect`: `hostname` is `127.0.0.1` or `localhost`. A fixed `port` and `path` may be declared; otherwise the host chooses the port and connection path.
- Device Flow additionally declares `deviceAuthorizationEndpoint` and `verificationOrigins`.
- Remote MCP additionally declares `resource`, `mcpEndpoint` and the complete `discoveryUrls`; dynamic registration also requires `registrationEndpoint`. Discovery cannot introduce new destinations.
- `requiredScopes` must be a subset of requested scopes. `scopeDescriptions` supplies display copy, and `scopeAliases` maps server responses to declared scopes.
- `authorizationParameters` contains only public additional parameters and cannot override state, client, redirect, scope, resource, code, PKCE or any token parameter.
- `identity` may declare an account-query `endpoint`, lists of `subject`/`account` field paths, `requiredClaims` and a `group`. Grouping applies only within the same signing identity, marketplace origin and issuer. Plugins without an account endpoint do not display fabricated identities.
- `backend: {operator,url}` explicitly names the developer-backend operator and domain. It grants no additional network permissions.

All OAuth network addresses must use public HTTPS without credentials, fragments, query parameters or custom ports. Local HTTP is reserved for host callbacks. Host HTTP requests pin validated DNS results at connection time and prohibit redirects. The system browser manages its own connections; the host checks the destination before launch and sends no existing tokens to it. A plugin cannot use one broad domain allowlist to receive every kind of credential. Authorization and refresh results are both constrained by connection generations and cancellation signals.

## Flows and responsibilities

`oauth-pkce` uses the system browser, S256, random state and a local callback. `device-code` polls at the server-provided interval and handles slow_down. `mcp-oauth` uses constrained discovery and public-client registration through the MCP SDK.

The host encrypts stored credentials. Refresh tokens, authorization codes and verifiers do not enter adapters, the renderer or configuration exports. Local business adapters obtain access tokens on demand through existing private call metadata. They are trusted plugin code; a signature does not prove their business requests are safe. Adapters still require review before publication.

Cancel authorization and refresh before plugin updates, disabling or removal; late results cannot restore the connection. Credentials are bound to the signing publisher, plugin, connection, client, issuer, resource and authentication declaration. Authentication changes require reauthorization. Changes only to application names, display names, scope descriptions or backend-operator copy do not alter the credential binding.

v1 OAuth connections remain only to show an update notice; old OAuth credentials are selectively deleted. The host does not fall back to old client configuration. QQ Mail, Figma and ordinary MCP retain their protocols. Packaging excludes `connector-clients*.json` and old `*oauth-client.json` files without deleting developers' local originals.

## Developer backend protocol

The backend holds upstream secrets and tokens and exposes public-client Authorization Code + PKCE or standard MCP OAuth to Artemis. It must validate S256, exact callbacks, single-use codes, client IDs, scope and resource. Tokens it issues may access only the declared resource; upstream tokens must never be returned to Artemis. Its resource service validates issuer, audience, expiry and permissions and rejects tokens intended for another resource. The backend implements refresh-token rotation and revocation.

Developers own platform registration, callback registration, review, backend maintenance and hosting client-metadata documents. Artemis does not deploy a backend. Confidential client credentials must remain on the developer backend.

## Validation and examples

PluginShop's `examples/oauth-v2` supplies PKCE, Device, Remote MCP and developer-backend declarations. Replace example client IDs after real registration; examples are not ready-to-publish working plugins.

```sh
node scripts/validate-oauth.mjs examples/oauth-v2/pkce.json
node scripts/verify-oauth-contract.mjs /path/to/Artemis
npm run build
npm run sign
npm run check
```

Later paired host/plugin updates still require real-platform and final-package verification. Local tests cannot replace those checks.

## TUN / Fake-IP networking

The system browser uses its own proxy and DNS configuration. The host checks authorization-URL syntax, including HTTPS, hostname and credentials, without using host DNS results to block browser navigation.

Host HTTPS requests still pin validated public addresses. If system DNS returns a virtual address from the TUN-common `198.18.0.0/15` range, the host queries real A records through Cloudflare DNS-over-HTTPS at fixed public entry `1.1.1.1`, preserving TLS validation for `cloudflare-dns.com`. Only the destination hostname is sent to the resolver, never OAuth parameters, codes or tokens. Connections then use the real public IP while validating TLS against the original destination hostname.

Fake-IP addresses themselves remain forbidden connection targets. Private-network, loopback, link-local or mixed unsafe answers do not receive a compatibility exception. Encrypted-DNS failure does not fall back to connecting to Fake-IP. This path supports TUN compatibility; it does not add explicit HTTP/SOCKS proxy configuration.

## Native public-client compatibility parameters

`native-public` is only for static client parameters that a platform allows native apps to distribute, such as a Google Desktop registration's `client_secret`. Publishers must verify the registration type; declaration validation cannot prove a value actually belongs to a public client. Web/server client secrets must not be distributed this way. The parameter is readable from the plugin package and cannot establish client authentication or a confidentiality boundary.

During PKCE code exchange and refresh, the host sends the parameter only to the declared token endpoint. It is not added to browser URLs, account queries or plugin-runtime authentication context. S256, state, callback checks, signatures and endpoint protection remain effective. Changing the parameter changes the authentication fingerprint and requires reauthorization. User access/refresh tokens remain forbidden in plugin packages; only the host manages refresh tokens. The host does not read legacy client-detail files.

References: [Google OAuth for native applications](https://developers.google.com/identity/protocols/oauth2/native-app) and [RFC 8252 section 8.5](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.5).
