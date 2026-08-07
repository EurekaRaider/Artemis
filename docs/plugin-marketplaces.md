# Developing a GitHub plugin marketplace

Artemis can subscribe to custom application marketplaces backed by
public GitHub repositories. A marketplace is a declarative catalog: it points
to plugin directories in the same repository, and each plugin can contribute
Skills, MCP server definitions and Connector definitions.

Users add a source from **Plugins → Add → Git marketplace** with either
`owner/repository` or `https://github.com/owner/repository`. Marketplace
subscriptions, ordering and the selected source persist across restarts.

## Runtime behavior

- Opening **Plugins** reads cached repositories and does not contact GitHub.
- **Refresh** downloads a bounded archive of the selected source's default
  branch over HTTPS and validates it before replacing the previous cache. It
  does not invoke or require a local Git executable.
- A failed refresh keeps the last valid cache visible and marks it stale.
- Searching with no query shows the selected source. A query searches all
  cached Git sources and groups matching plugins by marketplace.
- Removing a marketplace deletes its subscription and cache but does not
  uninstall plugins that were already installed from it.
- Installed plugins retain their normalized source identity, so removing and
  later re-adding the same repository reconnects them to that source.

## 1. Create the repository

Use this layout as a starting point:

```text
my-marketplace/
├── .agents/
│   └── plugins/
│       └── marketplace.json
└── plugins/
    └── example-tools/
        ├── .codex-plugin/
        │   └── plugin.json
        ├── skills/
        │   └── example-skill/
        │       ├── SKILL.md
        │       └── references/        # optional
        ├── mcp/
        │   └── server.mjs             # optional local MCP implementation
        ├── .mcp.json                   # optional
        ├── .app.json                   # optional
        └── assets/
            └── logo.png               # optional
```

`.agents/plugins/marketplace.json` is the recommended manifest location.
Artemis also reads `.claude-plugin/marketplace.json` and a root-level
`marketplace.json` for compatibility.

All paths declared by the marketplace or a plugin must stay inside their
respective repository/plugin directory. Symlinks, path escapes and non-file
entries are rejected during strict Git marketplace validation.

## 2. Declare the marketplace

Create `.agents/plugins/marketplace.json`:

```json
{
  "name": "my-marketplace",
  "interface": {
    "displayName": "My Marketplace"
  },
  "plugins": [
    {
      "name": "example-tools",
      "source": {
        "source": "local",
        "path": "./plugins/example-tools"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

Marketplace rules:

- `name` is the stable marketplace identity. Use lowercase letters, numbers,
  dots, underscores or hyphens, beginning with a letter or number.
- `interface.displayName` is optional display text; it does not replace the
  stable `name` identity.
- Every plugin entry needs a unique `name` and an in-repository local `source`.
  A string such as `"./plugins/example-tools"` is also accepted as `source`.
- `category` is optional and overrides the category shown for this marketplace
  entry.
- `policy.installation: "NOT_AVAILABLE"` hides an entry. Other entries remain
  eligible if their plugin contents are installable.
- Omit `policy.products` unless product gating is needed. If present, the array
  must include `CODEX` for Artemis's compatibility loader to expose the
  plugin.

Keep the marketplace `name` unchanged after publishing. If it changes,
Artemis rejects refresh as an identity change; users must remove and add
the source again.

## 3. Declare each plugin

Every plugin directory needs `.codex-plugin/plugin.json`:

```json
{
  "name": "example-tools",
  "version": "1.0.0",
  "description": "Example tools for Artemis.",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "apps": "./.app.json",
  "interface": {
    "displayName": "Example Tools",
    "shortDescription": "Reusable example workflows and tools.",
    "category": "Developer Tools",
    "brandColor": "#2563EB",
    "logo": "./assets/logo.png"
  }
}
```

Remove `skills`, `mcpServers` or `apps` when that capability does not exist.
The plugin must ultimately contain at least one valid Skill, importable MCP
server or Connector URL. Use the same plugin name in the marketplace entry and
plugin manifest so source identity, display state and updates remain obvious.

`interface` is optional. `brandColor` uses `#RRGGBB`; `logo` must point to a PNG
inside the plugin. A missing `version` is treated as `0.0.0`, but publishers
should always use an explicit version and bump it for every released update.

## 4. Add a Skill

Each Skill lives in its own directory and starts with `SKILL.md` containing
valid frontmatter:

```markdown
---
name: example-skill
description: Use this Skill for the example workflow.
---

Workflow instructions go here.
```

Skill names are global in Artemis. Installation is blocked if the same
name is already owned by another plugin or by a standalone installed Skill.
Put supporting files beside `SKILL.md` or in subdirectories such as
`references/`, `scripts/`, `examples/` and `templates/`.

## 5. Add MCP servers

Reference `.mcp.json` from `mcpServers` in the plugin manifest. A plugin can
declare local stdio and remote Streamable HTTP servers:

```json
{
  "mcpServers": {
    "example-local": {
      "command": "node",
      "args": ["${PLUGIN_ROOT}/mcp/server.mjs"],
      "env": {
        "EXAMPLE_API_KEY": "$EXAMPLE_API_KEY"
      }
    },
    "example-remote": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "auth": "oauth"
    }
  }
}
```

`${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` resolve to the installed plugin
snapshot. Other command variables must be resolvable later from the user's
environment. For environment values, declare only a same-name reference such
as `"EXAMPLE_API_KEY": "$EXAMPLE_API_KEY"`; literal values are deliberately
discarded. Credential-looking command arguments make an MCP definition
non-importable.

Remote endpoints must use HTTPS, except `http://localhost`, `127.0.0.1` or
`::1` during local development. Do not embed credentials, query parameters or
fragments in endpoint URLs. Unsupported custom HTTP headers prevent import;
bearer and OAuth credentials are configured through Artemis's encrypted
credential flow after installation.

All plugin-provided MCP servers install disabled. The user must inspect,
configure and explicitly enable them before their tools are auto-approved.

## 6. Add Connectors

Connectors are standard Streamable HTTP MCP endpoints. Reference `.app.json`
with `apps`, or reference `.connector.json` with `connectors`:

```json
{
  "apps": {
    "example-mail": {
      "id": "example-mail",
      "url": "https://connector.example.com/mcp",
      "auth": "oauth",
      "required": false
    }
  }
}
```

`endpoint` is accepted as an alias for `url`. `auth` may be `oauth`, `bearer`
or `none` and defaults to `oauth` when a URL is present. Remote URLs require
HTTPS; loopback HTTP is allowed for development. A provider-specific ID without
a protocol URL is not independently installable.

Connectors install disabled and never carry OAuth tokens, bearer tokens or
other credentials in the plugin bundle.

## 7. Validate and publish

1. Validate every JSON file with a JSON parser and make sure every declared
   file and directory exists with the exact case used in the manifest.
2. In Artemis, use **Plugins → Add → Local plugin** to inspect the plugin
   directory and fix all warnings before publishing.
3. Review the repository for secrets, generated dependency trees, symlinks and
   files that are not required at runtime.
4. Push the repository's default branch to a public `github.com` repository.
   Private repositories and URLs with embedded credentials are intentionally
   unsupported.
5. Add `owner/repository` under **Plugins → Add → Git marketplace**. This is the
   end-to-end validation for the marketplace manifest, repository-relative
   paths and every plugin's bounded file set.
6. Install each plugin in a test project, configure its disabled MCP servers or
   Connectors, and exercise the contributed Skills in a new task.

To release an update, change the plugin contents, increment the plugin manifest
`version`, push the default branch, then use **Refresh** and **Update** in
Artemis. Updates and removals stop if a managed Skill, plugin snapshot
or structural MCP definition was modified outside the plugin manager, avoiding
silent overwrites of local changes.

## Validation limits

| Item                                  |                                               Limit |
| ------------------------------------- | --------------------------------------------------: |
| User-added marketplaces               |                                                  20 |
| Plugins per marketplace               |                                               1,000 |
| Marketplace JSON                      |                                               5 MiB |
| Plugin manifest or MCP/Connector JSON |                                          1 MiB each |
| Files per plugin                      |                                               2,500 |
| Individual plugin file                |                                              50 MiB |
| Total plugin contents                 |                                             200 MiB |
| Files per Skill                       |                                                 200 |
| Individual Skill file                 |                                               5 MiB |
| Total Skill contents                  |                                              20 MiB |
| PNG logo                              | 128 KiB, at most 2,048 × 2,048 and 4,194,304 pixels |

Marketplace and plugin identifiers are bounded, case-sensitive names. Avoid
renaming a published marketplace, plugin or Skill; stable identifiers are what
make installed-state matching and safe updates predictable.

## Compatibility and trust boundary

- Supported marketplace capabilities are Skills, MCP servers and Connectors.
- Hooks, commands, agents, browser extensions and scheduled-task templates are
  reported as unsupported and are not executed.
- Executable Pi extensions are not installed from a Git marketplace. They use
  Artemis's separate file selection, content-hash trust, sandbox and
  network-permission workflow.
- Literal environment values, bearer tokens, OAuth material and other
  credentials are never imported from a plugin.
- Adding a marketplace trusts Artemis to download and parse that public
  repository; enabling an installed local stdio MCP server is the separate
  decision that grants it the current desktop user's filesystem and network
  permissions.

## Common validation errors

- **Repository not found or authentication requested:** confirm that the
  repository exists on `github.com` and is public.
- **Marketplace download is blocked:** allow HTTPS access to `api.github.com`
  and GitHub's redirected archive host. Installing Git does not affect the
  marketplace downloader.
- **Marketplace manifest missing:** add
  `.agents/plugins/marketplace.json` with valid JSON.
- **No installable plugins:** ensure every entry points inside the repository
  and exposes a valid Skill, importable MCP server or Connector URL.
- **Marketplace identity changed:** restore the original marketplace `name`, or
  remove and add the source again as a deliberate identity change.
- **Skill already installed:** rename the Skill or remove the existing owner;
  two plugins cannot own the same global Skill name.
- **Refresh failed but old entries remain:** this is expected cache protection.
  Correct the repository and retry **Refresh**; the previous cache is kept until
  a complete new archive passes validation.
