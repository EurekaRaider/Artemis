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

## Computer Use native runtime

The official `computer-use` identity has one store card; main selects macOS 14+ arm64 or Windows 11 x64 assets. Ordinary MCP configurations and local lookalike plugins cannot enter the official launch bridge. The seven tools, five actions and Pi call path remain stable. Windows app grants use stable `appId`; macOS retains `bundleId`.

Native sources are separated by platform and responsibility. `apps/desktop/native/computer-use/macos/` contains the pipe entry point, Driver, app discovery, AX observation, actions, capture and input control. `windows/` contains transport, app identity, UI Automation, Windows.Graphics.Capture, input and Stop controls. Windows builds with CMake, C++20 and the Windows SDK; users do not need Python or .NET.

Each downloaded pack includes its helper, Skill, plugin manifest and MCP declaration at the same version. The dedicated manifest declares minimum OS, `hostRange`, protocol, entry point and file digests. The host verifies its pinned Ed25519 key. macOS is independently signed, notarized and stapled. Windows checks ownership and write ACLs at the final installation and its ancestors; a declared Authenticode thumbprint is mandatory to verify. Bounded private stdin/stdout JSON and a handshake connect the helper.

Installation downloads, authenticates, unpacks and probes before recovering/committing the active runtime and plugin transaction. Tasks retain their current version during updates. Idle activation removes the old revision after success, postponing deletion until its last lease closes. Failure preserves the current version. Legacy macOS installations download on first target open; offline failures can be retried in the store and app grants are retained. New Artemis packages keep store metadata without a production helper.

Windows UIA patterns perform background clicks and fills where supported. Legacy MSAA proxies that can activate the window require existing foreground consent. Coordinates, keyboard, scrolling and app launches that take focus require foreground authorization. UAC, elevated processes and protected UI can be unavailable; system denial stops execution. Capture uses [CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow); input restrictions follow [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput). Denial, takeover, Stop and stale observations must not be bypassed through another tool.

`computer-use-release.yml` builds both immutable ZIPs and signed manifests from main, publishes a candidate and verifies anonymous digest readback. Use `COMPUTER_USE_ED25519_PRIVATE_KEY`, falling back to the existing pinned `OFFICE_RUNTIME_ED25519_PRIVATE_KEY`, plus macOS signing/notarization secrets; the public key must already be pinned in `resources/computer-use/catalog.json`. Deploy a host containing the public key before rotating to a new key. The bootstrap catalog contains no fabricated release manifests.

For candidate acceptance, set `ARTEMIS_COMPUTER_USE_CANDIDATE_VERSION=x.y.z` before launching the final Artemis host. Main selects only that immutable official GitHub catalog and still verifies the existing pinned keys. Use an isolated acceptance profile and remove the environment variable afterward.

The independent release workflow builds both native runtimes and signs their manifests with the pinned Ed25519 key. Each native runner extracts and verifies its final archive, plugin identity and file inventory. macOS additionally verifies Developer ID, hardened runtime, notarization, stapling and Gatekeeper; Windows verifies the declared native signature state and installation ACLs. The workflow records these performed checks in `native-acceptance.json`, publishes immutable assets, verifies anonymous downloads and advances `computer-use-stable`. Windows uses Ed25519 package signing without requiring Authenticode or a manual Windows 11 interaction checklist. Runtime operating-system requirements remain macOS 14+ arm64 and Windows 11 x64. CI package verification does not claim that every desktop, display or application interaction has been tested. Retry promotion at the same version with `promote_existing` if only channel publication failed. Keep detailed logs under ignored `artifacts/verification/computer-use/<run>/`.
