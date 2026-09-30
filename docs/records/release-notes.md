# Artemis v1.6.15

## 中文

- **Pi 引擎升级**：Pi Agent 及配套模型依赖升级至 `0.99.1`，继续由 Artemis 管理工具入口与执行权限。
- **依赖修复**：更新 HTTP 与 glob 相关依赖，修复发布审计发现的高危漏洞。

- **动态 SVG 时间线预览**：回复中的本地 SVG 图片与文件链接可直接显示预览，保留 CSS／SMIL 动画，并保留文件链接入口。
- **连续播放与去重**：同一文件的图片和链接只生成一个预览，后续文字继续输出时保持已有图片节点，避免动画重新开始。
- **安全与失败提示**：SVG 使用隔离的图片上下文显示，不执行内嵌脚本；文件读取继续受工作区边界和大小限制保护，加载失败时显示提示。
- **代码块复制**：时间线 Markdown 代码块新增语言标签和复制按钮，支持复制成功提示及失败重试。
- **生成文件管理**：移除本地 Office 验证产物的 Git 跟踪，并忽略 `outputs/`，保留本地文件。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Pi engine upgrade**: updated Pi Agent and its model dependencies to `0.99.1`, retaining Artemis control over tool exposure and execution permissions.
- **Dependency fixes**: patched HTTP and glob dependencies to resolve high-severity findings from the release audit.

- **Animated SVG timeline previews**: local SVG images and file links in assistant replies now display directly in the timeline, retaining CSS/SMIL animation and the file link entry point.
- **Continuous playback and deduplication**: image and link references to the same file share one preview. Further streamed text preserves the existing image node so animation does not restart.
- **Safe rendering and failure feedback**: SVG uses an isolated image context without executing embedded scripts. File reads retain workspace and size limits, and failed previews show a visible message.
- **Code block copying**: timeline Markdown code blocks now show a language label and copy button, with success feedback and retry after failure.
- **Generated file hygiene**: local Office verification artifacts are no longer tracked by Git, and `outputs/` is ignored while local files are preserved.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
