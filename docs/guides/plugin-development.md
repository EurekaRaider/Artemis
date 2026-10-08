[English / 简体中文](plugin-development-en.md)

# 插件开发

Artemis 使用 `artemis.plugin.json` 声明插件。v2 的公共元数据为 `schemaVersion`、`kind`、`id`、`name`、`version` 和可选 `description`。资源插件与交互插件共用元数据，各自拥有独立的能力声明；现有 v1 插件继续由兼容层读取，不要求立即迁移。

## 本地工具

在源码仓库执行 `npm ci`、`npm run build:core`，然后：

```bash
npm run plugin -- init /tmp/my-resource resource
npm run plugin -- validate /tmp/my-resource
npm run plugin -- dev /tmp/my-resource
npm run plugin -- pack /tmp/my-resource /tmp/my-resource.zip
```

Windows 请把 `/tmp/` 换成当前用户可写目录。`init` 要求目标目录不存在，目录名使用小写字母、数字、点、下划线或连字符。`dev` 监听并验证文件变化；在 Artemis 资源中心安装本地目录，修改后重新安装并审查新的内容哈希。它不会绕过宿主信任或自动授权。

`validate` 检查 manifest、路径和包大小，错误输出包含 `code`、`phase`、`message`；Schema 错误还包含字段路径 `issues`。`pack` 生成确定性 ZIP，拒绝符号链接、`.env`、`.git` 和未打包的 `node_modules`，输出文件必须位于插件目录之外。

类型和 Schema 来自 `@artemis/plugin-contract`，不导入 Electron、Pi 或宿主文件系统。JSON Schema 构建到 `packages/plugin-contract/dist/manifest-v2.schema.json`。仓库工作区包尚未发布到 npm；不要假设可以从公共 npm 安装同名包。

## 资源插件

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

Skill 路径指向包含 `SKILL.md` 的具体目录；v2 不递归发现未声明的资源。Skin 和 Hooks 路径指向相应声明文件。可选 `contributes.mcp` 指向 MCP 配置文件；Connector 在该文件中使用现有 `x-artemis` 扩展声明。详见 [MCP/商店兼容格式](plugin-marketplaces.md)、[Hooks](hooks.md)、[Connectors](connectors.md) 和 [Skin](visual-skins.md)。路径必须在包内，不允许绝对路径、盘符、反斜杠或 `..`。

安装、启用和授权是不同操作。命令 Hooks 仍要求单独审查和内容信任；账号凭据由宿主授权流程管理，不能打包进插件。

## 交互插件

```bash
npm run plugin -- init /tmp/my-interactive interactive
npm run plugin -- validate /tmp/my-interactive
```

生成器提供 runtime、静态 panel 和 `notes_list` 工具。`@artemis/plugin-sdk/runtime` 的 `serveRuntime(pluginId, tools)` 包装现有 protocol 1：握手、长度前缀 JSON 帧、工具调用与结果。SDK 不创建第二套 agent loop；Pi 仍是唯一执行循环。stdout 专用于协议，诊断请写 stderr。单帧上限 256 KiB，不支持并发调用；工具应返回简短、可序列化的数据。

交互 manifest 明确声明 `engines`、`projectTypes`、`panels`、`runtime`、`tools` 和 `capabilities`。工具效果分为 `state-read` 与 `artifact-write`。宿主在装配工具和执行调用时分别检查绑定、内容哈希与权限。受限交互插件不能混入资源插件的 MCP 或 Hooks 字段获得额外权限。

runtime 在 macOS arm64 使用 Seatbelt，在 Windows x64 使用 AppContainer；网络被禁用，插件/runtime 只读，只有任务临时目录可写。真实项目文件通过明确导入进入任务，不能直接读取工作区。平台启动失败时拒绝运行，不自动降级为当前用户权限。面板运行在宿主管理的隔离视图，不能直接使用 Node 或 preload 接口。

## 迁移与排错

`npm run plugin -- migrate DIR` 生成 `artemis.plugin.v2.json`，不会覆盖原文件。核对旧版自动发现的资源，全部显式列出后再替换；检查插件 ID、工具名、项目类型及面板 ID，避免破坏已保存的绑定。当前 v1 继续可用，迁移不是安装前提。

- Schema 错误：按 `issues[].path` 定位字段，再执行 `validate`。
- runtime 握手失败：核对 `serveRuntime` 的 ID、manifest ID 与 protocolVersion；检查是否向 stdout 打印日志。
- 信任失效：修改安装内容后重新安装、审查；不要修改宿主的信任数据库。
- 沙箱拒绝：将写入移到任务临时目录，网络或真实工作区访问不属于交互 runtime 的权限。
- 安装中断：宿主在下一次读取插件状态时恢复持久事务；保留事务文件以便恢复，不手动删除后强行重装。

示例见 [资源插件](../../examples/plugins/hello-resource/artemis.plugin.json) 和 [交互插件](../../examples/plugins/hello-interactive/artemis.plugin.json)。原生沙箱与最终安装路径仍须在目标平台验证，协议测试不等同于平台验收。

## Computer Use 原生运行时

官方 `computer-use` 在商店中只有一张卡片，主进程选择 macOS 14+ arm64 或 Windows 11 x64 资产。普通 MCP 配置和同名本地插件不能进入官方启动桥。七个工具、五种动作和 Pi 调用链保持稳定，Windows 应用授权使用稳定 `appId`，macOS 保留 `bundleId`。

原生源码按平台和职责拆分：`apps/desktop/native/computer-use/macos/` 包含通信入口、Driver、应用发现、AX 观察、动作、截图和输入控制；`windows/` 包含通信、应用身份、UI Automation、Windows.Graphics.Capture、键鼠与停止按钮。Windows 使用 CMake、C++20 和 Windows SDK 构建，不依赖用户安装 Python 或 .NET。

下载包包含同版本的 helper、Skill、插件 manifest 和 MCP 声明。专用能力包声明最低系统版本、`hostRange`、协议、入口和逐文件摘要，宿主使用固定 Ed25519 公钥验证。macOS 独立签名、公证和 staple；Windows 检查最终安装目录及祖先目录的所有者和写权限，声明 Authenticode thumbprint 时强制验证。helper 使用有界的私有 stdin/stdout JSON 并握手。

安装先下载、验证、解包和探测 helper，再通过可恢复事务提交活动版本与插件。更新期间任务继续使用旧版，空闲后才切换；成功后删除旧版，租约未释放时延迟清理。失败保留当前版本。旧 macOS 安装记录首次打开目标时下载迁移，离线失败可在商店重试，应用授权保留。新 Artemis 包只保留商店元数据，不再携带生产 helper。

Windows UIA 控件模式在应用支持时执行后台点击与填写；可能激活窗口的旧式 MSAA 代理要求已有前台授权。坐标、键盘、滚动和会抢焦点的应用启动需要前台授权。UAC 安全桌面、管理员进程和受保护界面可能不可控，系统拒绝时停止。窗口捕获使用 [CreateForWindow](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow)，输入限制见 [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)。拒绝、接管、停止和过期观察不能由其他工具绕过。

`computer-use-release.yml` 从 main 构建两个不可变 ZIP 与签名清单，公开候选版本并匿名回读摘要。使用 `COMPUTER_USE_ED25519_PRIVATE_KEY`，未配置时复用已固定公钥对应的 `OFFICE_RUNTIME_ED25519_PRIVATE_KEY`，以及 macOS 签名、公证 secrets；私钥的公钥必须已固定在 `resources/computer-use/catalog.json`。新密钥必须先发布含公钥的宿主。引导目录不包含伪造的发布清单。

验收候选包时，在启动最终 Artemis 之前设置 `ARTEMIS_COMPUTER_USE_CANDIDATE_VERSION=x.y.z`，主进程只会选择该版本的官方 GitHub 目录，仍验证原有固定公钥；不替换信任配置。使用独立的验收用户数据目录，验收后移除该环境变量。

独立发布工作流构建两个平台的原生运行时，并使用固定 Ed25519 公钥对应的私钥签署清单。每个平台在原生 runner 上解包最终资产，核对插件身份、文件清单与完整性。macOS 额外验证 Developer ID、hardened runtime、公证、stapling 与 Gatekeeper；Windows 验证声明的原生签名状态及安装 ACL。工作流在 `native-acceptance.json` 中记录实际执行的检查，发布不可变资产，验证匿名下载，再推进 `computer-use-stable`。Windows 使用 Ed25519 包签名，不要求 Authenticode 或人工 Windows 11 交互清单。运行时仍要求 macOS 14+ arm64 或 Windows 11 x64；CI 包检查不代表所有桌面、显示器与应用交互场景均已测试。只有目录发布失败时，可用同版本的 `promote_existing` 重试。详细日志放入忽略的 `artifacts/verification/computer-use/<run>/`。
