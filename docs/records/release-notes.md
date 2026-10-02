# Artemis v1.6.18

## 中文

- **视觉皮肤**：在设置中预览、应用皮肤或恢复默认，应用后的选择在重启时恢复。Skin v2 支持明暗壁纸、静音视频背景、字体、语义图标与宿主动效预设，并提供高对比度和减少动态效果支持。
- **资源生命周期**：皮肤从已安装插件提供；插件变更时释放旧资源。窗口隐藏、最小化、系统休眠或锁屏时暂停背景视频。
- **Artemis 原生插件格式**：插件使用 `artemis.plugin.json`，市场使用 `.artemis/marketplace.json`，均声明 `schemaVersion: 1`。已有插件数据在保留备份后迁移；开发指南、内置插件和 Hooks 示例同步到新格式。
- **Pi 引擎**：升级 Pi SDK 至 **1.0.0**，继续由 Artemis 管理工具暴露、执行权限与唯一 Agent 循环。
- **文档与开发工具**：正式指南和图片归入 `docs/guides`、`docs/assets`，示例、原型与方案分别归入根级目录；新增皮肤验证、打包、预览工具和完整示例。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Visual skins**: preview, apply or restore the default skin in Settings, with applied selections restored after restart. Skin v2 supports light/dark wallpapers, muted video backgrounds, fonts, semantic icons and host motion presets, plus high-contrast and reduced-motion support.
- **Resource lifecycle**: installed plugins provide skins, and plugin changes release previous resources. Background video pauses while the window is hidden or minimized, or the system sleeps or locks.
- **Native Artemis plugin format**: plugins use `artemis.plugin.json`, marketplaces use `.artemis/marketplace.json`, and both declare `schemaVersion: 1`. Existing plugin data migrates with a retained backup. Developer guides, bundled plugins and Hooks examples use the new format.
- **Pi engine**: upgrade the Pi SDK to **1.0.0**, with Artemis retaining control of tool exposure, execution permissions and the single agent loop.
- **Documentation and developer tools**: consolidate guides and images under `docs/guides` and `docs/assets`, and move examples, prototypes and plans to dedicated root directories. Add skin validation, packaging and preview tools with complete examples.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
