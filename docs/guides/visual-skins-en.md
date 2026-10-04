# Visual skin plugin development

Native Artemis plugins can contribute Skin v1 token packages or Skin v2 visual packages. Visual skins change colors, image and muted video wallpapers, fonts, semantic icons and host motion presets. Components, layout and business interactions remain controlled by Artemis. Skins execute no plugin code and download no remote resources.

## Native contribution

Save this declaration in `artemis.plugin.json`:

```json
{
  "schemaVersion": 1,
  "name": "ocean-visual-skins",
  "version": "1.0.0",
  "interface": { "displayName": "Ocean Skins", "category": "Design" },
  "skins": ["./skins/ocean.artemis-skin/"]
}
```

`skins` is optional and accepts up to 32 declared directories. Undeclared directories are not discovered. Pure skin plugins and mixed Skill/MCP/Hook plugins use the existing lifecycle. Installation adds skins to Settings without changing the user's selection.

Skin IDs are unique across installed plugin owners. Reinstalling or updating the same plugin identity may retain its skin IDs; another owner claiming an existing ID is rejected before commit. Identity includes the plugin name and source, so moving a local source or changing its Git source may create another identity. Disabling preserves the selection and temporarily uses the default; re-enabling restores it. Removing the plugin or deleting the selected skin during update clears the selection. Plugins awaiting native format migration do not contribute available skins. Enabling skins grants no Connector, Hook or executable extension permission.

## Skin v2

Use `init` to generate a complete manifest and token files. Add assets and declarations such as:

```json
{
  "assets": {
    "poster": { "path": "assets/poster.png", "kind": "image" },
    "video": { "path": "assets/dark.webm", "kind": "video" },
    "ui": { "path": "assets/ui.woff2", "kind": "font" }
  },
  "backgrounds": {
    "light": { "type": "image", "asset": "poster" },
    "dark": {
      "type": "video",
      "asset": "video",
      "poster": "poster",
      "fit": "cover",
      "position": [50, 50],
      "opacity": 1,
      "blur": 0,
      "scrim": "#10182244"
    }
  },
  "fonts": { "ui": [{ "asset": "ui", "weight": 400, "style": "normal" }] },
  "icons": "icons.json",
  "motion": "motion.json"
}
```

This shows additional fields, not a complete manifest. Version 2 retains the v1 identity, version, UI compatibility, modes, token document and capability requirements. Both light and dark configurations are required. Declaring high contrast requires its token document; otherwise Artemis temporarily uses its default high-contrast skin. Skin v1 validation and file restrictions remain unchanged; v2 has a separate version dispatch validator and reuses the token rules.

| Field         | Contract                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assets`      | Up to 128 IDs; lowercase letter followed by letters/digits/hyphens. Unique relative paths under `assets/`; no URL, absolute path, escape or traversal              |
| `backgrounds` | none/image/video, mandatory image poster for video; cover/contain; two position percentages 0–100; opacity 0–1; blur 0–24 px; six/eight digit hex scrim            |
| `fonts`       | ui/conversation/code roles; 1–8 WOFF2 faces per role; weights 400/500/600/700, normal/italic; duplicate weight/style pairs rejected                                |
| `icons`       | Fixed `icons.json` name, structured path/circle/rect/line geometry. Host supplies currentColor and built-in fallback                                               |
| `motion`      | Fixed `motion.json` name; background/surface/controls boundaries; none/fade/slide/scale/pulse/float; duration 0–500 ms, distance 0–12 px; loops only on background |

An icon document:

```json
{
  "schemaVersion": 1,
  "icons": {
    "send": [{ "type": "path", "d": "M12 20V4 M5 11l7-7 7 7", "fill": false }]
  }
}
```

Geometry uses a 24×24 viewport; non-path coordinates are 0–24. Each semantic icon has at most 32 shapes. Names are listed in the tool bundle's `schema/icons.json` and [source coverage list](../../packages/theme-contract/src/skin-icon-names.ts). The public icon entry covers semantic buttons and menus; desktop send/stop/copy/download/expand/collapse/undo/branch/compare/commit/worktree/PR/external/resource controls use it. Brand logos, avatars, external content and illustrations retain their own sources.

A motion document:

```json
{
  "schemaVersion": 1,
  "targets": {
    "controls": { "preset": "scale", "duration": 120, "distance": 0 },
    "background": {
      "preset": "float",
      "duration": 500,
      "distance": 4,
      "loop": true
    }
  }
}
```

The host does not transform or filter the application root. Backgrounds accept no input. High contrast disables wallpaper, decorative motion and glass. Reduced motion shows the poster and disables host skin animations. Videos are forced muted and looped, and pause while hidden, minimized, locked or asleep.

## Integrity and fallbacks

Limits: JSON 1 MiB, PNG/JPEG/WebP 10 MiB and 20 million decoded pixels, MP4/WebM 50 MiB and 1920×1080 for at most 60 seconds, WOFF2 20 MiB. Plugin limits remain 2,500 files, 200 MiB total and 50 MiB per file.

`integrity.json` uses `schemaVersion: 2`, `algorithm: "sha256"`, and a `files` map covering the manifest, every token document, declared icons, motion and assets. It excludes itself. Undeclared files inside the skin directory, links, incorrect hashes, format signatures and exceeded limits are rejected. Assets stay inside plugin snapshots and use temporary opaque `artemis-skin:` leases. The main window's session serves them; the Browser partition has no handler.

Main validation inspects signatures and container metadata; renderer preparation checks actual decoding. Invalid tokens reject the entire skin. Fonts time out after two seconds and fall back to system fonts; non-monospaced code fonts fall back for the code role. Missing CJK glyphs use system fonts. Image failures use the skin background color; video failures use the poster. Settings shows non-blocking diagnostics. Update, disable and uninstall revoke URLs and close streams before replacing snapshots. Only the latest valid switch commits.

## Standalone tools and examples

Maintainers run `npm run build:skin-tools` to produce `artifacts/skin-tools/artemis-skin-tools-1.0.0.tar.gz`. The extracted bundle runs with Node.js 24 or newer without dependency installation or network access. Workspace packages are private; this tool is not published to npm.

```sh
node /path/to/artemis-skin-tools-1.0.0/cli.mjs init ./my-plugin com.example.ocean
node /path/to/artemis-skin-tools-1.0.0/cli.mjs validate ./my-plugin
node /path/to/artemis-skin-tools-1.0.0/cli.mjs build ./my-plugin ./my-plugin-built
node /path/to/artemis-skin-tools-1.0.0/cli.mjs preview ./my-plugin-built 8787
node /path/to/artemis-skin-tools-1.0.0/cli.mjs convert-icons ./svg ./icons.json
```

init/build/convert-icons require a new output. Build copies into a new directory and recalculates integrity without changing the source. Validate accepts a plugin or standalone v1/v2 skin. Preview listens only on 127.0.0.1, shows the first declared skin, or accepts a specific skin directory. It demonstrates the contract; install in Artemis to verify the complete application. SVG conversion supports 24×24 basic shapes and groups, rejects scripts/events/external references/transforms/styles, and emits geometry that must be declared and hashed.

Schemas for manifest-v2, integrity-v2, icons and motion ship in the bundle. Validate additionally checks cross-file references and hashes. [Two complete examples](../../examples/visual-skins/README.md) include high-contrast tokens, font roles, icons and motion. Follow the [native marketplace guide](plugin-marketplaces-en.md) for Git and signed offline distribution.

## Verification

`npm run verify:visual-skins` builds the standalone tools, runs external consumer tests, then launches real Electron with isolated data in two processes to check installation, media, switching, update, restart and removal. Evidence goes to ignored `artifacts/visual-skins/`. `npm run verify:desktop-skin` remains the v1 matrix and artifact verifier and requires a clean checkout.

Release acceptance also requires full typecheck/tests/build, skin package and conformance gates, UI boundaries/convergence/performance and external consumers. macOS arm64 and Windows final installers, signing/notarization, update/rollback and real local/Git/signed offline installation paths require independent platform evidence.
