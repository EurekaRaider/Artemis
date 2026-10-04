[English / 简体中文](plugin-development.md)

# Plugin development

Artemis declares plugins with `artemis.plugin.json`. Shared v2 metadata comprises `schemaVersion`, `kind`, `id`, `name`, `version` and optional `description`. Resource and interactive plugins share metadata but have distinct capability declarations. Existing v1 plugins remain readable through the compatibility layer; immediate migration is not required.

## Local tools

Run `npm ci` and `npm run build:core` in the source repository, then:

```bash
npm run plugin -- init /tmp/my-resource resource
npm run plugin -- validate /tmp/my-resource
npm run plugin -- dev /tmp/my-resource
npm run plugin -- pack /tmp/my-resource /tmp/my-resource.zip
```

On Windows, replace `/tmp/` with a user-writable directory. `init` requires a nonexistent target directory whose name uses lowercase letters, numbers, periods, underscores or hyphens. `dev` watches and validates changes. Install the local directory in Artemis Resources, then reinstall and review the new content hash after edits. It does not bypass host trust or grant authorization automatically.

`validate` checks the manifest, paths and package size. Errors contain `code`, `phase` and `message`; schema errors also contain field paths in `issues`. `pack` creates a deterministic ZIP, rejecting symlinks, `.env`, `.git` and unbundled `node_modules`. The output must be outside the plugin directory.

Types and schemas come from `@artemis/plugin-contract`, which does not import Electron, Pi or the host filesystem. The JSON Schema builds to `packages/plugin-contract/dist/manifest-v2.schema.json`. Workspace packages have not been published to npm; do not assume a package with the same name is available on the public registry.

## Resource plugins

```json
{
  "schemaVersion": 2,
  "kind": "resource",
  "id": "local.my-resource",
  "name": "my-resource",
  "version": "0.1.0",
  "contributes": {
    "skills": ["skills/hello"],
    "skins": [],
    "hooks": []
  }
}
```

Skill paths name concrete directories containing `SKILL.md`; v2 does not recursively discover undeclared resources. Skin and Hooks paths point to their declaration files. Optional `contributes.mcp` names an MCP configuration file; connectors use its existing `x-artemis` extension. See [MCP/marketplace compatibility](plugin-marketplaces-en.md), [Hooks](hooks-en.md), [Connectors](connectors.md) and [Skins](visual-skins-en.md). Paths must remain inside the package: absolute paths, drive letters, backslashes and `..` are forbidden.

Installation, enablement and authorization are separate operations. Command hooks still require individual review and content trust. Host authorization flows manage account credentials; credentials must not be packaged into plugins.

## Interactive plugins

```bash
npm run plugin -- init /tmp/my-interactive interactive
npm run plugin -- validate /tmp/my-interactive
```

The generator supplies a runtime, static panel and `notes_list` tool. `serveRuntime(pluginId, tools)` from `@artemis/plugin-sdk/runtime` wraps existing protocol 1: handshake, length-prefixed JSON frames, tool calls and results. It does not create another agent loop; Pi remains the only execution loop. stdout is reserved for the protocol; write diagnostics to stderr. Frames are limited to 256 KiB and concurrent calls are unsupported. Tools should return concise, serializable data.

An interactive manifest explicitly declares `engines`, `projectTypes`, `panels`, `runtime`, `tools` and `capabilities`. Tool effects are `state-read` or `artifact-write`. The host checks binding, content hash and permissions both when assembling tools and when executing calls. Restricted interactive plugins cannot gain extra privileges by mixing in resource-plugin MCP or Hooks fields.

Runtimes use Seatbelt on macOS arm64 and AppContainer on Windows x64. Networking is disabled; the plugin/runtime is read-only and only the task scratch directory is writable. Real project files enter the task through explicit import; runtimes cannot read the workspace directly. Platform launch failures deny execution rather than falling back to current-user privileges. Panels run in host-managed isolated views without direct Node or preload access.

## Migration and troubleshooting

`npm run plugin -- migrate DIR` creates `artemis.plugin.v2.json` without overwriting the original. Review resources previously discovered automatically and list them explicitly before replacing the manifest. Check plugin IDs, tool names, project types and panel IDs to preserve saved bindings. v1 remains usable; migration is not an installation prerequisite.

- Schema errors: locate the field through `issues[].path`, then rerun `validate`.
- Runtime handshake failure: compare the `serveRuntime` ID, manifest ID and protocolVersion, and check for logs written to stdout.
- Invalidated trust: reinstall and review modified content; do not edit the host trust database.
- Sandbox denial: move writes into task scratch. Networking and real workspace access are outside interactive-runtime permissions.
- Interrupted installation: the host recovers the durable transaction on the next plugin-state read. Keep transaction files for recovery; do not delete them to force reinstallation.

See the [resource plugin](../../examples/plugins/hello-resource/artemis.plugin.json) and [interactive plugin](../../examples/plugins/hello-interactive/artemis.plugin.json) examples. Native sandboxes and final installation paths still require target-platform verification; protocol tests do not establish platform acceptance.
