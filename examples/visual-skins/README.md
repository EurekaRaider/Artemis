[English / 简体中文](README-zh-CN.md)

# Artemis visual skin examples

`plugins/ocean-visual-skins` is one native plugin containing two complete Skin v2 packages:

- Ocean Still: light and dark PNG wallpapers, bundled fonts, semantic icons and host motion presets.
- Ocean Motion: light PNG wallpaper and muted dark WebM wallpaper with a mandatory PNG poster, the same font roles and icon overrides.

Both include high-contrast token documents. Fonts are unmodified KaTeX fonts under MIT; see `FONT-LICENSE.txt` and `FONT-SOURCES.md`. Wallpapers and the silent video are generated for this example. Font coverage is intentionally limited: CJK and other missing characters use system fallback.

Build and validate from the repository:

```sh
npm run build:skin-tools
node artifacts/skin-tools/artemis-skin-tools-1.0.0/cli.mjs validate examples/visual-skins/plugins/ocean-visual-skins
node artifacts/skin-tools/artemis-skin-tools-1.0.0/cli.mjs preview examples/visual-skins/plugins/ocean-visual-skins/skins/ocean-video.artemis-skin
```

Install the plugin directory through Artemis Resources, then select a skin in Settings. `.artemis/marketplace.json` is an example Git marketplace layout; signed offline distribution also requires the existing marketplace integrity/signing workflow.

Developer contract: [中文](../../docs/guides/visual-skins.md) · [English](../../docs/guides/visual-skins-en.md).
