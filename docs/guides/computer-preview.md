[English / 简体中文](computer-preview-en.md)

# Computer Use 实时预览开发契约

实时预览只服务已授权、已观察的 Computer Use 目标。它不增加模型截图频率，也不将视频、音频、GPU 句柄或逐帧消息写入协议事件、聊天记录或 React 状态。

## 浏览器与桌面窗口

Browser 的实例由主进程按聊天和标签页持有。沙箱化的 offscreen BrowserWindow 使用 Electron 43.2.0 的 sharedTexture；完整 Browser 和只读预览订阅同一实例，切换聊天、隐藏预览或 React 重挂载不会重建页面。关闭标签页、删除或归档聊天、关闭 Artemis 窗口会释放实例。页面没有 Node、preload 或宿主 IPC 权限。人工鼠标、键盘、文本及 IME 输入通过绑定到当前可见表面的受限命令传递；调试和 Computer Use 共用一个 debugger 连接。

macOS 14+ 的桌面预览使用 ScreenCaptureKit，并校验已观察窗口的 PID、进程创建时间、bundle ID 和唯一匹配的窗口 ID。Windows 11 使用 WGC，并校验 HWND、进程实例、所属应用路径和交互桌面。窗口关闭、权限变化或桌面不可用时停止采集；不会回退到整屏采集。macOS 输出 IOSurface，Windows 在 D3D11 中缩放并共享 GPU 纹理。桌面输入仍由既有 helper 管理，预览只读。

主窗口中的卡片可以移动和缩放。桌面悬浮窗无原生标题栏，使用 showInactive，并随 Artemis 前后台状态切换。点击小画面即可展开，左上角 × 只隐藏画中画，不中断任务，之后可重新显示。两种预览只显示当前聊天的目标；切换聊天会隐藏原聊天的预览，原任务继续运行，切回后恢复。Browser 的展开操作返回原聊天中的原标签页；桌面目标展开为只读大画面。暂停保留已显示画面，隐藏停止该预览的订阅，独立完整 Browser 的可见订阅仍可继续。

## GPU 生命周期和预算

- 本地采集预算为 60 fps，常规最大边为 1280，桌面大画面为 1920；持续负载下先降低像素数。
- 每个流至多一个传送中的帧和一个最新待处理帧。新的待处理帧立即替换并释放旧帧。
- sendSharedTexture 的 Promise 不代表 GPU 已消费完毕。源纹理必须保持到 allReferencesReleased 回调；渲染端完成绘制后关闭 VideoFrame 并释放导入纹理。
- GPU 消费超过一秒会停止该流并显示不可用状态。关闭、崩溃、隐藏或权限撤销不能提前释放仍被 GPU 使用的纹理。
- FPS 和采集至绘制的 p95 延迟来自实际绘制，按秒报告；静止或停止的流不能显示配置帧率。

## 能力包兼容与签名

Computer Use manifest 可选声明 `preview: { protocol: 1, module: "相对路径.node" }`。模块必须在签名文件清单中标为可执行文件。helper 的 hello 可选返回 `previewIdentity: 1`；未声明的旧包保持原有控制功能，桌面预览明确提示更新能力包。

macOS 将模块放入 helper 应用的 Frameworks，先签模块再签应用；安装校验要求相同 Team ID，并继续校验应用的 hardened runtime、notarization 和 staple。Windows 校验 helper 与模块的 Authenticode 策略及实际安装路径的 ACL；提供已签 helper 时，构包也必须提供已签模块。模块使用 Electron 的 delay-load hook，不能绕过沙箱、内容哈希信任或原有授权流程。

## 验证

macOS 的开发验证命令：

```sh
npm run build
node apps/desktop/scripts/build/build-computer-use.mjs arm64 --development
ARTEMIS_PREVIEW_DURATION_SECONDS=1800 caffeinate -di node apps/desktop/scripts/verify/native/verify-computer-preview.mjs
```

验证使用隔离 profile 和本机合成页面，只采集验证应用自身的窗口。Screen Recording 和 Accessibility 必须已可用。证据放在被忽略的 `artifacts/verification/computer-preview/`，包含逐秒绘制报告、内存采样、中文输入和隐藏/重挂载检查。

动态画面在 60 Hz 或更高刷新率、1280×720、预热后应达到平均至少 55 fps，采集至绘制 p95 不超过 150 ms，并完成 30 分钟稳定性运行。Browser 与原生目标分别验收。该命令目前是 macOS 验证入口；Windows CI 编译 helper 和 GPU 模块，但编译不能替代 Windows 11 实机的帧率、停止时限和最终安装 ACL 验收。开发模块运行也不能替代签名能力包、macOS arm64 包装、notarization、stapling、更新和回滚验收。
