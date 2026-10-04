[English / 简体中文](connectors-zh-CN.md)

# Connectors v1

Artemis connects directly to official services. It does not need an Artemis
backend. Pi, tool approval and per-server MCP sandbox policies remain in place.

## User flow

Load ArtemisPluginShop, then install a signed plugin. Installation opens that
plugin's connection dialog automatically; loading the marketplace does not start
authorization. Reopen the same dialog with Configure on the installed plugin.
There is no separate connector page. Closing a pending dialog cancels authorization.
Google and Microsoft open the system browser; GitHub displays a device code;
QQ asks for an email address and authorization code; Figma checks its desktop
MCP endpoint. Public client IDs are publisher configuration, never user input.
Gmail and Workspace have separate grants but share one Google account identity.
One connection for each service is allowed. There is no persistent background
polling after the app exits.

All existing connector plugins must be updated and reconnected. The runtime does
not read or convert historical authorization records. Their files remain on disk.
Unsupported versions, old connector aliases and old authentication declarations
are rejected independently so unrelated plugins and manual MCP servers can load.

## Contract and execution

Each plugin declares exactly one MCP server. Its `x-artemis.connector` object has
`version: 1`, stable `id`, `provider`, `displayName`, `auth`, `scopes`,
`capabilities`, `requiredHostCapabilities: ["connector-v1"]`, and `setup`.
The containing MCP server is the sole runtime reference; a second application
declaration is not created. The host validates provider, grant, transport and
official endpoint against its supported connector registry. Connector v1 itself
is the required host capability: an older host is not a supported pairing.

Example (Figma desktop):

```json
{
  "mcpServers": {
    "figma": {
      "type": "http",
      "url": "http://127.0.0.1:3845/mcp",
      "auth": "none",
      "x-artemis": {
        "connector": {
          "version": 1,
          "id": "figma",
          "provider": "figma",
          "displayName": "Figma",
          "auth": "none",
          "scopes": [],
          "capabilities": ["read"],
          "requiredHostCapabilities": ["connector-v1"],
          "setup": "desktop-mcp"
        }
      }
    }
  }
}
```

The renderer/preload API is `listConnectorDefinitions`,
`listConnectorConnections`, `connectConnector`, `cancelConnectorAuthorization`,
`reconnectConnector`, and `disconnectConnector`. Account state contains no tokens.
Manual MCP remains an advanced feature with its own standard MCP configuration.

ConnectorService verifies the pinned marketplace signing key, exact installed
content digest, owning plugin, config binding, provider and scopes before handing
credentials to an executor. Credentials live only in OS-encrypted
`connector-credentials-v1.json`. Access tokens travel to trusted local adapters in
the private `com.artemis.connector/auth` context. Refresh tokens remain in the
host. QQ authorization codes reach only its trusted mail adapter. Official remote
MCP authentication is supplied through host transport headers or OAuth providers.
Configuration exports contain declarations, never credential records.

Changes to the connector declaration disable its tools until reauthorization.
Tool registration and execution both require a valid connection. Disconnect
closes MCP clients and invalidates outstanding refresh generations. A platform
may already have accepted an in-flight write; cancellation cannot undo it. Mail
sends are never automatically retried after an uncertain outcome.

## Publisher configuration

OAuth v2 is configured entirely in the signed plugin. See the [v2 declaration and developer backend contract](plugin-oauth.md).
Artemis no longer reads `connector-clients.json`; packaging excludes legacy client files. Confidential server secrets remain forbidden. Explicit `native-public` PKCE declarations may include a distributable native-client compatibility secret, used only for token exchange and refresh. Google Desktop uses this declaration; real account authorization and refresh remain release acceptance requirements.

Figma desktop and QQ Mail retain their non-OAuth configuration. Candidate services without validated registrations must remain outside the published marketplace.

## Acceptance and release gates

Local mocked tests and stdio smoke runs do not establish live provider acceptance.
Before publishing a paired host/marketplace release, record evidence for:

- Each of the six first-wave services: connection, read, supported write, missing
  scopes, revocation, cancellation, timeout and disconnect during a pending call.
- Official remote MCP client registration/admission, tool availability and scope
  behavior. Keep unapproved remote services out of a public release.
- macOS arm64 and Windows x64 packaged browser callback, OS encryption, local
  runtime sandbox, Figma loopback, signing and installation/update behavior.
- Google verification covering data sent to the selected model provider.
- Signature/file-list/offline-archive verification after the final package build.

Public Microsoft, GitHub and Slack registrations and controlled account access
are external release prerequisites. Never substitute another application's client
ID or ask end users to register developer applications.

## Local validation

The OAuth declaration and trust contract are described in the [OAuth guide](plugin-oauth.md). Validate paired host and marketplace changes against the actual release inputs.
