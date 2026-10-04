[English / 简体中文](repository-layout-en.md)

# 工程目录与文件归属

## 顶层

- `apps/desktop/`：Electron 桌面应用；`apps/ui-gallery/`：UI 基础组件展示与验证。
- `packages/`：已有共享包。包名、公开导出与协议边界保持稳定，不按页面随意增加包。
- `scripts/`：跨工程构建、CI、依赖维护、发布、基准、UI 和插件工具。测试及 JSON 契约跟随工具。
- `docs/`：正式指南、持续维护记录和视觉资产；`examples/`：完整可运行示例。
- `vendor/`：随仓库分发的依赖代码；`third-party/`：第三方许可证。`vendor/image-size-parser-blocker/` 保留依赖接口并拒绝图片解析。
- `artifacts/`：Git 忽略的构建输入缓存、验收证据及历史归档，不是源码。

## 桌面源码与测试

`src/main/`、`renderer/`、`preload/`、`agent/`、`extension/`、`shared/` 分别保留运行环境边界。主进程与界面按 conversation、workspace、plugins、design、office、capabilities、mcp、connectors、im、automation、appearance 等功能归类。功能样式和辅助函数随功能放置。

`main/main.ts` 与 `main/bootstrap.ts` 保留为组装入口。`renderer/main.tsx` 是页面入口，`renderer/app/` 管理应用组合与导航；跨功能组件进入 `renderer/components/`，全局样式进入 `renderer/styles/`。不要建立含义不明的 `misc/` 或把业务文件重新平铺到入口目录。

`shared/` 只收纳跨进程共享且不依赖 Node/Electron 的定义，文案与语言资源进入 `shared/i18n/`。特殊 preload 统一放在 `preload/`，worker 跟随功能；源码位置不能改变编译后的入口文件名。

`test/main/`、`test/renderer/`、`test/shared/` 镜像被测代码归属，跨进程流程进入 `test/integration/`，源码结构与打包约束进入 `test/contracts/`，共用 fixture 和测试辅助代码进入 `test/fixtures/`。源码扫描必须递归遍历，新增目录不能缩减检查覆盖。

## UI Gallery

`apps/ui-gallery/src/` 仅保留启动入口和环境声明。`app/` 负责页面组合，`pages/` 放各类展示页，`components/` 放通用组件，`themes/` 放主题 fixture 与声明，`conformance/` 放契约及矩阵，`styles/` 放 Gallery 样式。两个测试继续集中在 `test/`；新增页面按所属功能归类。

## 共享包与工具

`agent-host/src/` 按 runtime、sessions、context、models、tools、policy 分组；`gateway/src/` 按 channels、groups、authorization、i18n 分组，入口与服务组合保留顶层。其他体量较小的包保留已有结构。

桌面专用脚本放在 `apps/desktop/scripts/{build,packaging,release,verify,dev}/`；verify 下区分 ui、native、features。跨工程脚本留在根级 scripts，按职责分组；`scripts/artifacts/` 提供证据路径工具。

## 产物与迁移检查

- 新的桌面验证输出默认使用 `artifacts/verification/<主题>/<运行标识>/`；可通过工具原有输出参数指定位置。
- 基准输出进入 `artifacts/benchmarks/`，开发演示材料进入 `artifacts/dev/`。
- `artifacts/office/`、`artifacts/slack-cli/`、能力包与皮肤工具产物是现有构建链输入，保持约定位置。
- 常规 dist、release 输出位置保持不变；编辑器默认排除这些目录。桌面的 build 目录也含图标、安装器配置等受跟踪输入，不能整目录清理。
- 历史证据保留；一次性材料不进入正式 docs。已退役应用产物放 `artifacts/legacy/`。

迁移时同时更新 import、动态路径、源码断言、npm 命令、CI 的路径过滤和资源入口。npm 命令名与包公开导出保持兼容；不建立旧内部路径的转发文件。

说明文档保留原路径，中文原文配 `-en.md`，英文原文配 `-zh-CN.md`，两版互相链接并保持内容同步。运行时 `SKILL.md` 和第三方许可证原文不纳入翻译；发布说明保留文件内双语。`npm run verify:docs` 检查配对、语言链接和本地 Markdown 链接，翻译完整性仍需人工审阅。

执行 `npm run verify:layout` 检查入口目录与公开导出，再执行受影响测试、完整测试、类型检查和构建。打包与原生验证分别记录平台和证据，不以单元测试代替运行时验证。
