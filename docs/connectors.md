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

Create `apps/desktop/resources/connector-clients.json` with the following shape;
omit unregistered providers. The file is ignored by Git and included in desktop
packaging. Do not put user access tokens, refresh tokens or server secrets here.

```json
{
  "version": 1,
  "google": { "clientId": "PUBLISHER_DESKTOP_CLIENT_ID" },
  "microsoft": { "clientId": "PUBLISHER_PUBLIC_CLIENT_ID" },
  "github": { "clientId": "PUBLISHER_DEVICE_FLOW_CLIENT_ID" },
  "slack": { "clientId": "PUBLISHER_PUBLIC_CLIENT_ID" }
}
```

- **Google:** register a Desktop app in Google Auth Platform. If its installed-app
  client requires the desktop `client_secret`, the optional Google `clientSecret`
  field accepts it. This is not a confidential web-server secret. Enable the APIs
  used by Gmail, Drive, Docs, Sheets, Slides and Calendar. Complete production
  consent/verification for the actual scopes and data flows. Model processing of
  restricted data may require additional assessment even without an Artemis
  backend. [Google requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- **Microsoft:** Entra admin center → App registrations → New registration;
  support organizational accounts and personal Microsoft accounts. Register the
  desktop public client redirect `http://localhost/mcp-oauth/microsoft` (the host uses a dynamic loopback port). Configure
  delegated User.Read, Mail.ReadWrite and Mail.Send permissions, with openid,
  profile and offline_access. Copy Application (client) ID; do not create a client
  secret. [Desktop registration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration).
- **GitHub:** Settings → Developer settings → OAuth Apps → New OAuth App. Enable
  Device Flow and copy Client ID. Device token issuance and refresh do not require
  a client secret. [Registration](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app).
- **Slack:** register an application at Slack App Management. Enable PKCE in
  OAuth & Permissions; add user scopes matching the plugin. Register the fixed
  desktop redirect **`http://localhost:43827/mcp-oauth/slack`**. This URL is chosen
  by Artemis; it is not obtained from a cloud server. Only a local listener runs
  during authorization. Copy Client ID from Basic Information. MCP does not
  support dynamic client registration; public distribution also needs Slack's
  directory/client admission requirements. [PKCE](https://docs.slack.dev/authentication/using-pkce/),
  [MCP admission](https://docs.slack.dev/ai/slack-mcp-server/).

Notion, Linear and Atlassian use official MCP discovery and dynamic registration
where the service allows it. Discovery does not replace client admission policies.
Figma desktop needs a running supported Figma app with its MCP server enabled;
there is no PAT fallback. QQ users enable IMAP/SMTP and generate a mail
authorization code in QQ Mail; server names and TLS ports are fixed by the adapter.

## Acceptance and release gates

Local mocked tests and stdio smoke runs do not establish live provider acceptance.
Before publishing a paired host/marketplace release, record evidence for:

- Each of the six first-wave services: connection, read, supported write, missing
  scopes, revocation, cancellation, timeout and disconnect during a pending call.
- Official remote MCP client registration/admission, tool availability and scope
  behavior. Keep unapproved remote services out of a public release.
- macOS arm64 and x64 and Windows packaged browser callback, OS encryption, local
  runtime sandbox, Figma loopback, signing and installation/update behavior.
- Google verification covering data sent to the selected model provider.
- Signature/file-list/offline-archive verification after the final package build.

Public Microsoft, GitHub and Slack registrations and controlled account access
are external release prerequisites. Never substitute another application's client
ID or ask end users to register developer applications.

## Local validation for this change

- Desktop production build and typecheck pass. Full desktop regression: 1,878
  passed and 11 skipped (before the optional paired-package test was added).
- Plugin installation opens a dialog scoped to that plugin; closing it cancels
  authorization. Installation, reopening, cancellation and account state were
  verified using the actual renderer with synthetic IPC data.
- Shop typecheck and 16 unit tests pass. Four self-contained local adapters pass
  runtime smoke tests on macOS arm64, including refusal of calls without private
  host credentials. All ten declarations and signatures pass verification.
- The host imports the paired signed offline archive, installs all ten plugins,
  verifies their trust, and leaves every tool connection disabled until authorized.
  Reproduce with `ARTEMIS_CONNECTOR_MARKETPLACE_ARCHIVE=/absolute/path/to/archive.tar.gz`
  and `npx vitest run apps/desktop/test/connector-marketplace-acceptance.test.ts`.
- Public Microsoft, GitHub and Slack registrations/admission remain to be supplied
  by the publisher. Controlled-account business operations and packaged macOS
  arm64/x64 and Windows acceptance remain unverified. No package was published.
