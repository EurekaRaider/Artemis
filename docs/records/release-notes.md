# Artemis v1.7.20

## 中文

- 修复浏览历史对话时的滚动顿挫：由历史轮次组件统一管理离屏内容高度，避免重复的尺寸估算引起页面跳动，即使没有任务运行也能稳定滚动。
- 修复 macOS 浏览器连续滚动时回落到 60 帧的问题。浏览器改用与真实显示器刷新率同步的原生视图，本地 120 Hz 屏幕验证中，连续 2,500 次滚轮输入的合成帧率保持约 120 帧。
- 保留浏览器弹层、响应式尺寸、中文输入、元素批注和截图操作。弹层遮挡页面时保留可截图的渲染状态，并串行处理截图与视口变更，避免标注截图超时或尺寸冲突。
- 浏览器画中画按可见状态管理采集资源，隐藏后释放采集轨道；普通浏览器面板无需持续采集。其他平台保留共享纹理预览，并按所在显示器配置刷新率、保留精细滚轮增量。

## English

- Fix uneven scrolling through conversation history by letting history turns own offscreen height measurements. Removing competing size estimates prevents page jumps even when no task is running.
- Fix the macOS browser's fallback to 60 FPS during continuous scrolling. Native browser views follow the actual display refresh rate; a local 120 Hz display sustained approximately 120 compositor FPS across 2,500 consecutive wheel inputs.
- Preserve browser overlays, responsive layouts, Chinese text input, element annotations and screenshots. Covered pages retain a capturable rendering surface, and screenshot and viewport commands run sequentially to prevent annotation timeouts and conflicting dimensions.
- Manage browser picture-in-picture capture according to visibility and release capture tracks when hidden. Ordinary browser panels need no continuous capture. Other platforms retain shared-texture previews with display-aware frame rates and precise wheel deltas.
