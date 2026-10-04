[English / 简体中文](README.md)

# Artemis 视觉皮肤示例

`plugins/ocean-visual-skins` 是一个原生插件，包含两套完整的 Skin v2 包：

- Ocean Still：浅色和深色 PNG 壁纸、内置字体、语义图标与宿主运动预设。
- Ocean Motion：浅色 PNG 壁纸和静音深色 WebM 壁纸，后者带必需的 PNG 海报图，使用相同的字体角色和图标覆盖。

两套皮肤都包含高对比度 token 文档。字体是 MIT 许可下未修改的 KaTeX 字体，参阅 `FONT-LICENSE.txt` 与 `FONT-SOURCES.md`。壁纸和静音视频为本示例生成。字体字符覆盖有意保持有限，CJK 等缺失字符由系统字体回退补足。

在仓库中构建与验证：

```sh
npm run build:skin-tools
node artifacts/skin-tools/artemis-skin-tools-1.0.0/cli.mjs validate examples/visual-skins/plugins/ocean-visual-skins
node artifacts/skin-tools/artemis-skin-tools-1.0.0/cli.mjs preview examples/visual-skins/plugins/ocean-visual-skins/skins/ocean-video.artemis-skin
```

通过 Artemis 资源中心安装插件目录，再到设置中选择皮肤。`.artemis/marketplace.json` 展示 Git 商店布局；签名离线分发仍需遵循现有商店完整性与签名流程。

开发契约：[中文](../../docs/guides/visual-skins.md) · [English](../../docs/guides/visual-skins-en.md)。
