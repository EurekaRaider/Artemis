# Build an Artemis plugin and Git marketplace

[简体中文](plugin-marketplaces.md) · English · [Documentation index](../README.md)

This guide describes the current Artemis source contract, checked on 2026-10-02.
Test against the Artemis version you distribute to users; source support does not
prove that an older installed release supports the same capabilities.

A plugin is a directory containing `artemis.plugin.json` and its declared
resources. A marketplace is a catalog of plugin directories in one public GitHub
repository. It does not require a storefront website, registry service or changes
to Artemis. Start with the Skill-only example below; add MCP and authentication
only when your workflow needs them.

## 1. Choose the capability

| Capability              | What you ship                                     | Requirements                                                    |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| Skill                   | `SKILL.md` and supporting files                   | Instructions, not an automatically executed install hook        |
| Ordinary MCP            | `.mcp.json` and a local server or remote endpoint | stdio or Streamable HTTP; user configures and enables it        |
| Artemis Connector       | MCP plus `x-artemis.connector`                    | Trusted signed marketplace; OAuth v2 for new OAuth integrations |
| Executable Pi extension | Separate extension workflow                       | Not installed by the Git marketplace                            |

Command Hooks require separate review and content-hash trust after installation.
Commands, agents, browser extensions and scheduled-task templates remain unsupported.
Declare only capabilities implemented by the host.

## 2. Create a minimal marketplace

Create these three files in a new repository. The example is usable without an
MCP server, build step or signature:

```text
my-marketplace/
├── .artemis/marketplace.json
└── plugins/example-tools/
    ├── artemis.plugin.json
    └── skills/acme-example-review/SKILL.md
```

`.artemis/marketplace.json`:

```json
{
  "schemaVersion": 1,
  "name": "acme-marketplace",
  "interface": { "displayName": "Acme Marketplace" },
  "plugins": [
    {
      "name": "example-tools",
      "source": { "source": "local", "path": "./plugins/example-tools" },
      "policy": { "installation": "AVAILABLE" },
      "category": "Development"
    }
  ]
}
```

`plugins/example-tools/artemis.plugin.json`:

```json
{
  "schemaVersion": 1,
  "name": "example-tools",
  "version": "1.0.0",
  "description": "Review a project and report actionable findings.",
  "skills": "./skills/",
  "interface": {
    "displayName": "Example Tools",
    "shortDescription": "A reusable project review workflow.",
    "category": "Development",
    "brandColor": "#2563EB"
  },
  "localizations": {
    "en": {
      "displayName": "Example Tools",
      "description": "Review a project and report actionable findings.",
      "shortDescription": "A reusable project review workflow."
    },
    "zh-CN": {
      "displayName": "示例工具",
      "description": "检查项目并报告可操作的问题。",
      "shortDescription": "可复用的项目审查流程。"
    }
  }
}
```

`plugins/example-tools/skills/acme-example-review/SKILL.md`:

```markdown
---
name: acme-example-review
description: Use when the user requests a project review with actionable findings.
---

1. Read the project instructions and identify the requested review scope.
2. Inspect relevant files without changing them.
3. Report concrete findings with file locations and suggested fixes.
4. Respond in the user's language. State any verification you could not perform.
```

## 3. Follow the manifest and Skill rules

- Marketplace `name` and catalog entry names: 1–120 characters, matching
  `[a-z0-9][a-z0-9._-]*`. Plugin manifest `name`: the same character set, at most
  64 characters. Keep the catalog entry and plugin manifest names identical.
- Names are stable identities, not translated labels. Do not rename a published
  marketplace, plugin or Skill as part of a routine update.
- Catalog `source` must refer to a directory in the same repository. A string
  such as `"./plugins/example-tools"` is also accepted. External Git URLs, npm
  packages and submodules are not a replacement for a local plugin directory.
- The sole plugin manifest is root `artemis.plugin.json`; the sole catalog is
  `.artemis/marketplace.json`. Both require `schemaVersion: 1`; legacy paths and unknown versions are rejected.
- `policy.installation: "NOT_AVAILABLE"` hides an entry. Omit `policy.products`
  normally; a nonempty list must include `ARTEMIS`.
- Paths are relative to the repository for catalog sources and to the plugin
  for plugin resources. Keep exact filename case; do not use symlinks, path
  escapes, sockets or other non-file payloads.
- Declare only resources that exist. A plugin needs a valid Skill or importable
  MCP server. Unsupported or unavailable Connector declarations can block the
  entire plugin even when it also contains Skills.
- Always publish an explicit version (semantic versioning is recommended).
  A missing plugin version is rejected.
- `interface.logo` optionally points to a PNG inside the plugin. `brandColor`
  is `#RRGGBB`. Standard localized categories are `Communication`, `Productivity`,
  `Development` and `Design`.
- A Skill name is globally unique across standalone Skills and all plugins.
  Use a publisher prefix. It must be at most 64 characters and match
  `[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*`. Its frontmatter needs a single-line `description`
  of at most 1,024 characters. Do not rely on multiline YAML descriptions.
- Put supporting files in the Skill directory, for example `references/`,
  `scripts/`, `examples/` and `templates/`. Document their usage, prerequisites
  and any side effects. Installation does not run these scripts.

### Bilingual plugin metadata

Place `localizations` at the top level of `plugin.json`, as above. Supported keys
are `en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `es`, `fr`, `de`, `pt-BR`, `it`, `ru`, `ar`,
`hi` and `id`. Display fallback is selected locale → English → base metadata,
field by field. Do not translate identifiers or filesystem paths.

A locale entry accepts `displayName` (120 characters), `description` (2,000),
`shortDescription` (300), `longDescription` (10,000) and `defaultPrompt` (at most
20 strings of 2,000 characters each). Unknown locale keys, unknown fields and
empty text are rejected. Metadata localization does not translate Skill bodies
or server responses; provide those languages yourself where needed.

## 4. Add an ordinary MCP server when needed

Add `"mcpServers": "./.mcp.json"` to `plugin.json`, then create `.mcp.json` in the
plugin root. This optional example shows two independent servers; replace the
remote placeholder and supply the local implementation before publishing:

```json
{
  "mcpServers": {
    "example-local": {
      "command": "${ARTEMIS_NODE}",
      "args": ["${PLUGIN_ROOT}/mcp/server.mjs"],
      "env": { "EXAMPLE_API_KEY": "$EXAMPLE_API_KEY" }
    },
    "example-remote": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "auth": "oauth"
    }
  }
}
```

`${ARTEMIS_NODE}` is supported as the entire `command` and uses Artemis's
executable in Node mode. `node` instead requires Node on the user's PATH.
`${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` resolve to the installed snapshot
in commands and arguments. Other unresolved command/argument variables prevent
import; they are not deferred shell expansion.

Bundle or otherwise provide all runtime dependencies before publishing. Artemis
copies the plugin snapshot; it does not automatically run `npm install`, build
TypeScript or execute `postinstall`. A `.mjs` that still imports absent packages
will fail at runtime. Test native dependencies on every claimed OS/architecture.
stdio stdout is reserved for protocol traffic; send diagnostics to stderr and
never log credentials.

Environment declarations accept same-name references such as
`"EXAMPLE_API_KEY": "$EXAMPLE_API_KEY"`, or names in `envVars` / `env_vars`.
Literal values are discarded and require manual setup; never package secrets.
Credential-looking arguments prevent import. A declared `cwd` is not honored;
Artemis uses a private managed workspace.

Remote endpoints use HTTPS, with HTTP allowed only for loopback development.
Credentials, query strings and fragments in URLs are rejected. Custom headers
other than `Authorization` prevent import; header credential values are not
imported. `auth: "oauth"` selects OAuth. For bearer setup declare
`bearer_token_env_var` with a variable name, then let the user configure the token
in Artemis; `auth: "bearer"` alone does not select bearer mode in this parser.
Legacy SSE transport is not supported here.

New servers install enabled. Missing configuration or authorization is reported
separately; updates preserve existing switches and new servers follow the plugin
switch. Historical configurations are never enabled in bulk. Local stdio servers
use the native sandbox by default. The current importer sets `allowNetwork: true`.
The per-server full-access compatibility option grants desktop
user permissions and is a separate explicit choice. Extension **Full local
access** does not change MCP permissions. Skills do not bypass Plan
restrictions, and enabling a server is not blanket consent for every action.

In Work and Codemode, a discovered local MCP tool can request
`sandbox_escalation: { justification }` with a fresh `model_approval` after a
sandbox denial. The model explains the restriction, necessity, and retry safety;
the host treats the call as high risk, so agent approval requires the exact
action and target to match an explicit user request. The call uses a temporary
connection that closes afterward, without changing server settings or the
default environment. Do not reuse process-local handles from the original
connection. Remote account authorization, Plan restrictions, and extension
trust cannot be bypassed. Failures do not automatically escalate or replay an
entire script.

## 5. Add an Artemis Connector / OAuth integration

Use `.mcp.json` → `mcpServers.<name>.x-artemis.connector` for Artemis-managed
connections. **Do not use `apps`, `connectors`, `.app.json`, `.connector.json`, or
`x-artemis.auth` for new plugins**: the current loader treats them as legacy
and shows an update/reconnect requirement.

Ordinary MCP authentication from section 4 and an Artemis Connector are distinct
contracts. Every `x-artemis.connector` requires installation from a signed
marketplace whose fingerprint the user confirmed. Local plugin import and an
unsigned Git marketplace cannot satisfy this trust requirement.

For a new OAuth provider, put a declaration like the following inside the
server's `x-artemis.connector` field (this is a declaration fragment, not a whole
`.mcp.json` or a working service):

```json
{
  "version": 2,
  "id": "sample-api",
  "provider": "sample-platform",
  "displayName": "Sample API",
  "auth": "oauth-pkce",
  "scopes": ["records.read"],
  "capabilities": ["read"],
  "requiredHostCapabilities": ["connector-oauth-v2"],
  "oauth": {
    "applicationName": "Sample Desktop",
    "client": {
      "type": "static",
      "clientId": "REPLACE_WITH_REGISTERED_PUBLIC_CLIENT_ID"
    },
    "issuer": "https://auth.example.com/",
    "authorizationEndpoint": "https://auth.example.com/authorize",
    "tokenEndpoint": "https://auth.example.com/token",
    "redirect": { "hostname": "127.0.0.1" },
    "requiredScopes": ["records.read"],
    "scopeDescriptions": { "records.read": "Read records" },
    "resource": "https://api.example.com/"
  }
}
```

Implement this PKCE example with a stdio business adapter. A remote v2 Connector
must declare `oauth.mcpEndpoint`, use Streamable HTTP, and match that endpoint
exactly. Complete the appropriate OAuth contract before choosing a transport:

- `oauth-pkce`: public client, system browser, S256, state and loopback callback.
- `device-code`: device authorization endpoint and allowed verification origins.
- `mcp-oauth`: resource, MCP endpoint and explicit discovery URLs; dynamic
  registration also needs its registration endpoint. Discovery cannot add
  undeclared destinations.

Register a real application and callback with the provider, replace every
placeholder, request minimum scopes and describe them to the user. Public client
IDs may be packaged; client secrets, user tokens and private keys may not.
OAuth network endpoints require public HTTPS without credentials, query strings,
fragments or custom ports; loopback HTTP is for the host callback only.

If the provider requires a client secret, operate a developer backend that keeps
upstream secrets and tokens. Expose public-client PKCE or standard MCP OAuth to
Artemis, issue resource-bound tokens, validate issuer/audience/expiry/scopes,
and never return upstream tokens to the desktop. Artemis does not deploy this
backend for you.

The host encrypts credentials and binds them to publisher, source, plugin,
connection and authentication declaration. Security-relevant changes require
reauthorization. Adapters must not log or persist the access token they receive;
refresh tokens, authorization codes and PKCE verifiers belong to the host.
Review adapter behavior: a valid signature is not a security audit.

See the [OAuth contract](plugin-oauth.md) (Chinese) and the linked
[source validator](../../apps/desktop/src/shared/connector-oauth.ts) for
complete fields. v1 OAuth is not a fallback for a new provider. Validate real
login, cancellation, refresh, revocation and update behavior in the target build.

## 6. Sign a marketplace

Signing is optional for Skill-only and ordinary MCP Git marketplaces, mandatory
for Artemis Connectors and offline marketplace imports. This is an Ed25519
content signature, separate from Git commit signing and macOS app signing.

Create `.artemis/integrity.json` after building the final plugin files:

1. Generate one Ed25519 publisher key pair. Store and back up the private key
   outside the repository; keep using that key for updates. Publish its SHA-256
   fingerprint through a channel users can verify independently.
2. Hash the exact catalog bytes with SHA-256 as `marketplaceHash`. For each
   catalog entry, recursively collect every regular file in its plugin directory,
   including dotfiles. Reject symlinks and paths outside that directory.
3. Record each file as `{path, size, sha256}` using `/`-separated plugin-relative
   paths, byte sizes and lowercase hex hashes. Sort by
   `left.path.localeCompare(right.path, "en")`.
4. Compute `contentHash` as SHA-256 over the sorted concatenation of each UTF-8
   `path`, a NUL byte, hex `sha256`, and another NUL byte. Record each plugin as
   `{name, version, contentHash, size, files}`; `size` is the sum of file bytes.
   Include all catalog entries, including entries hidden by policy.
5. Construct an unsigned object with `schemaVersion: 1`, `marketplaceName`,
   `marketplaceHash`, `signatureAlgorithm: "Ed25519"`, `publicKey` (base64 SPKI DER),
   `signingKeyFingerprint` (SHA-256 of that DER), `signedAt` (ISO timestamp),
   `sourceUrl` (`https://github.com/owner/repository.git`) and `plugins`.
6. Recursively sort object keys with `localeCompare`, retain array order, then
   serialize with `JSON.stringify` and sign the UTF-8 bytes with Ed25519.
   Add the base64 result as `signature` and save the JSON. Do not include
   `signature` in the bytes being signed.
7. Publish the catalog, plugin contents and integrity file together. Test through
   **Git marketplace** and confirm the fingerprint. Any catalog byte or plugin
   file change requires regeneration; even reformatting signed JSON changes hashes.

The host's [signature verifier](../../apps/desktop/src/main/artemis-plugin-service.ts)
and the `signMarketplaceRepository` reference implementation in
[its tests](../../apps/desktop/test/artemis-plugin-service.test.ts) define the
exact format. Reuse that algorithm in your release tooling; do not invent a
signature schema. Ordinary publishers do not need to modify Artemis source.

Artemis pins the confirmed key. Key changes or signature removal cause refresh to
fail; users must deliberately remove and re-add the source and trust the new key.
Third parties can host their own marketplace and sign it with their own key; no
listing in an official Artemis store or purchased certificate is required. Users
should compare the fingerprint with an independently published value. A signature
proves content integrity and key continuity, not publisher reputation.

### Optional offline distribution

Package only `.artemis/marketplace.json`, `.artemis/integrity.json`, and
all signed plugin files, retaining their relative paths. Include `sourceUrl` in
the signed declaration. Exclude `.git`, private keys, unrelated source files and
unsigned extras. Import the extracted directory or `.tar.gz` / `.tgz` through
**Resource Center → Plugins → Add → Offline marketplace package**, confirm the
fingerprint, then install. This is distinct from **Local plugin bundle**.
Offline browsing and installation use the imported cache; distribute and import
a newly signed package for updates. A checksum file alone is not an importable
marketplace.

## 7. Test, publish and update

1. Parse all JSON and check declared paths and Skill frontmatter. Review secrets,
   licenses, runtime dependencies and payload sizes. Add a README with setup,
   supported Artemis versions/platforms, permissions and troubleshooting.
2. Use **Resource Center → Plugins → Add → Local plugin bundle** and select
   `plugins/example-tools`, not the marketplace root. Install the minimal Skill,
   invoke it in a new task and switch between English and Chinese. Ordinary MCP
   can also be checked locally; signed Connector testing uses step 4 instead.
3. Create a public `github.com` repository and publish the completed files on its
   default branch. A release tag or release attachment alone is insufficient.
   Private repositories, SSH URLs, other Git hosts and arbitrary branch/tag paths
   are not supported by the user-added marketplace flow.
4. In **Plugins → Add → Git marketplace**, enter `owner/repository` or
   `https://github.com/owner/repository`. Inspect the source and, if signed, verify
   its fingerprint before confirming. Install each plugin from this source.
5. Configure and enable each MCP/Connector, test actual tools, permission denial
   and authentication as applicable. Restart Artemis and verify persistence.
   Test on each supported OS/architecture; parser tests do not prove a live
   provider, sandbox or packaged runtime works.
6. For an update, build the final payload, increase `plugin.json.version`,
   regenerate signatures if used, and publish to the default branch. Use
   **Refresh**, then **Update**; refreshing the catalog does not update installed
   snapshots automatically. Test updating an existing installation and uninstall.

Artemis downloads a bounded archive over HTTPS; users do not need Git installed.
Opening Plugins reads caches without fetching. Refresh failure preserves the last
valid cache as stale. Empty search shows the selected source; a search query
searches cached Git sources. Removing a source removes its subscription/cache,
not its installed plugins; re-adding the same repository restores source identity.

Updates/removals stop when managed Skills, snapshots or structural MCP definitions
were externally modified. Back up and resolve those changes rather than silently
overwriting them. Keep stable names and document any required reauthorization.

## 8. Limits and troubleshooting

| Item                                            |                               Host limit |
| ----------------------------------------------- | ---------------------------------------: |
| User-added marketplaces / plugins per catalog   |                               20 / 1,000 |
| Catalog / plugin or MCP JSON                    |                       5 MiB / 1 MiB each |
| Downloaded archive / unpacked archive / entries |               100 MiB / 500 MiB / 20,000 |
| Plugin files / individual file / total          |                 2,500 / 50 MiB / 200 MiB |
| Skill files / individual file / total           |                     200 / 5 MiB / 20 MiB |
| PNG logo                                        | 128 KiB; 2,048 × 2,048; 4,194,304 pixels |

Your publishing tooling may impose stricter limits.

| Symptom                                                | Check                                                                                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Repository unavailable                                 | Public GitHub repository, correct owner/name, HTTPS access to API and archive hosts                                           |
| Manifest missing / no installable plugins              | Catalog location, local paths, policy filters, valid Skill or importable MCP; strict validation can reject the entire refresh |
| Update plugin and reconnect                            | Remove legacy app/Connector declarations and implement the current contract                                                   |
| Connector requires a trusted signed marketplace plugin | Install from a signed, fingerprint-confirmed Git or offline source; local import is insufficient                              |
| Signing key changed / content signature failed         | Same publisher key, rebuilt hashes, exact catalog bytes, no post-sign edits                                                   |
| Marketplace identity changed                           | Restore the original name or deliberately remove and re-add the source                                                        |
| Skill already installed                                | Resolve the global name conflict; use publisher-prefixed Skill names                                                          |
| MCP starts then exits                                  | Installed paths, dependencies, transport, stdout protocol, sandbox/network settings; inspect logs without exposing secrets    |
| Old entries after failed refresh                       | Expected cache protection; fix the repository and refresh again                                                               |

Implementation references: [marketplace loader](../../apps/desktop/src/main/artemis-plugin-service.ts),
[Skill parser](../../apps/desktop/src/main/resource-catalog.ts),
[localization](../../apps/desktop/src/shared/plugin-localization.ts),
[Connector contract](../../apps/desktop/src/shared/connectors.ts).
