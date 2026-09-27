# Artemis v1.6.8

## 中文

### 本次更新

- **新增 macOS Computer Use 插件**：在资源中心安装后，可使用当前支持图片的模型操作 Artemis 内置浏览器与原生应用。插件自带原生助手，无需额外安装运行时或配置模型密钥；仅在 Execute 模式使用，要求 macOS 14 或更新版本。
- **应用授权与操作接管**：支持仅本轮或长期应用授权，并可随时撤销。原生坐标点击、按键和滚动需要单独允许本轮前台操作；后台操作不移动系统鼠标。点击停止或手动操作目标界面会暂停控制，并保留暂停原因，恢复前不能重新打开目标绕过暂停。
- **更可靠的连续操作**：一次最多执行八步，逐步核验填写结果与界面变化；原生控件 ID 保持稳定，读数变化不会无故打断后续操作。结果直接返回新观察、已完成和剩余步骤，减少重复截图与模型往返。
- **修复浏览器观察与填写**：等待浏览器面板尺寸稳定后返回首次观察；短暂截图失败会有限重试，不重放输入。修复嵌入式网页输入框聚焦、替换已有内容及中文填写行为，并刷新导航后的目标名称。
- **优化控制界面**：控制条随输入区排布，保留停止与恢复入口；macOS 使用原生侧边栏玻璃材质，并提供原生浮动停止按钮。Windows 不展示此 macOS 专用插件，也不连接迁移配置中遗留的 Computer Use 服务。
- **调整插件安装后的启用行为**：新增 MCP 服务及 Connectors 默认启用，缺少配置、授权或连接失败时显示设置状态；更新保留用户已经关闭的服务，关闭的插件不会因更新重新启用。

### 安装与范围

- **macOS Apple Silicon（arm64）**：Developer ID 签名、公证的 DMG/ZIP，支持应用内更新。原生应用操作仍需要 macOS 辅助功能与屏幕录制授权。
- **Windows x64**：无签名 ZIP。解压到新文件夹，退出旧版后启动新版；保留 `%APPDATA%` 中的 Artemis 用户数据。应用提示新版本后手动下载替换。
- 本版 CD 发布 macOS arm64 和 Windows x64；macOS Intel x64 仍为本地打包目标。Computer Use 不包含外部 Chrome 扩展；自动化检查不代表真实模型路由、所有应用工作流或 Intel 安装包已经完成验收。

## English

### What's changed

- **New Computer Use plugin for macOS**: install it from the Resource Center to operate Artemis Browser and native apps with the current image-capable model. The native helper is bundled, with no extra runtime or model key required. Available in Execute mode on macOS 14 or later.
- **App permissions and user takeover**: grant access for one turn or persistently, and revoke it at any time. Native coordinate clicks, keys and scrolling require separate foreground permission for the current turn; background actions leave the system pointer in place. Stop or manual interaction with the target pauses control, preserves the reason and prevents reopening the target to bypass the pause.
- **More reliable action batches**: run up to eight actions with per-step checks of field values and interface changes. Native control IDs remain stable, and changing readouts no longer interrupt otherwise valid actions. Results include a fresh observation, completed actions and remaining steps, reducing redundant captures and model round trips.
- **Browser capture and form fixes**: the first observation waits for the browser panel to settle. Transient capture failures receive bounded retries without replaying input. Embedded fields now focus and replace existing text correctly, including Chinese input, and target names refresh after navigation.
- **Refined control UI**: the control bar follows the composer with Stop and Resume controls. macOS uses the native sidebar glass material and a floating native Stop button. Windows hides this macOS-only plugin and skips legacy Computer Use connections imported from another platform.
- **Plugin enablement after installation**: new MCP services and Connectors start enabled, with setup states for missing configuration, authorization or failed connections. Updates preserve manually disabled services and do not re-enable disabled plugins.

### Installation and scope

- **macOS Apple Silicon (arm64)**: Developer ID signed and notarized DMG/ZIP, with in-app updates. Native app control still requires macOS Accessibility and Screen Recording permission.
- **Windows x64**: unsigned ZIP. Extract into a new folder, quit the old version and launch the new one. Preserve Artemis user data in `%APPDATA%`; download and replace the app manually when an update is announced.
- This CD release ships macOS arm64 and Windows x64; Intel macOS x64 remains a local packaging target. Computer Use does not include an external Chrome extension. Automated checks do not establish real-model routing accuracy, acceptance for every app workflow or Intel package acceptance.
