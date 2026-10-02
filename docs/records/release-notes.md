# Artemis v1.6.17

## 中文

- **时间线媒体预览**：图片支持内嵌显示和放大，动态 SVG 保留动画；本地音频提供播放控件，与已有视频预览一起保留流式回复期间的播放状态。
- **图表与公式**：Mermaid 代码块渲染为可放大的图表，LaTeX 行内与块级公式直接显示；保留源码查看、复制和渲染失败提示。
- **交互式 HTML**：本地 HTML 在隔离预览中加载同目录脚本、样式、图片与字体，支持交互和刷新；不开放网络、Node.js、应用接口或任意本地文件访问。
- **Office 与 PDF 文件卡片**：时间线统一显示文件卡片，点击进入现有右侧预览流程；不在时间线加载 Office 编辑器或启动文档转换。
- **加载与恢复**：预览靠近视口时加载，重复文件引用复用预览；追加消息保留图片、播放器和 HTML 交互状态，加载失败可重试。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Timeline media previews**: display and enlarge images, preserve animated SVGs, and play local audio with native controls. Audio and existing video previews retain playback state while replies stream.
- **Diagrams and formulas**: render Mermaid code blocks as expandable diagrams and display inline or block LaTeX formulas, with source viewing, copying and render-failure feedback.
- **Interactive HTML**: load local scripts, styles, images and fonts from the document directory in an isolated preview with interaction and refresh controls. Network, Node.js, application APIs and arbitrary local files remain inaccessible.
- **Office and PDF file cards**: display compact timeline cards that open the existing right-side preview flow, without loading Office editors or starting document conversion in the timeline.
- **Loading and recovery**: load previews near the viewport, reuse duplicate file references, and preserve image, playback and HTML interaction state as messages grow. Failed previews can be retried.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
