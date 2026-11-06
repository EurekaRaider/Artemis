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

跨进程 API 类型按功能放在 `shared/api/`，`shared/api.ts` 保留兼容导出和组合接口，IPC 名称清单位于 `shared/ipc-channels.ts`。桥接实现位于 `preload/bridges/`，preload 入口只按原顺序组合并暴露 `window.artemis`。`test/preload/bridge-contracts.test.ts` 使用 `test/fixtures/preload/` 中按功能分类的基线，验证完整方法清单、参数顺序、事件隔离与监听器清理。

`main/main.ts` 与 `main/bootstrap.ts` 保留为组装入口。`renderer/main.tsx` 是页面入口，`renderer/app/` 管理应用组合与导航；跨功能组件进入 `renderer/components/`，全局样式进入 `renderer/styles/`。不要建立含义不明的 `misc/` 或把业务文件重新平铺到入口目录。

`shared/` 只收纳跨进程共享且不依赖 Node/Electron 的定义，文案与语言资源进入 `shared/i18n/`。特殊 preload 统一放在 `preload/`，worker 跟随功能；源码位置不能改变编译后的入口文件名。

`test/main/`、`test/renderer/`、`test/shared/` 镜像被测代码归属，跨进程流程进入 `test/integration/`，源码结构与打包约束进入 `test/contracts/`，共用 fixture 和测试辅助代码进入 `test/fixtures/`。源码扫描必须递归遍历，新增目录不能缩减检查覆盖。

主进程生命周期位于 `main/application/`（bootstrap、startup、main-window、lifecycle），IPC 注册位于 `main/ipc/<功能>.ts`。入口组装依赖，功能模块通过窄类型接口接收依赖；可替换服务使用实时 getter/setter，避免注册回调时捕获尚未初始化或已经关闭的实例。不要从功能模块反向运行时导入 `main.ts`。

smoke 数据和故障模拟放在 `test/fixtures/smoke/`，按会话、工作区、资源、设置和 IPC 功能分类；窗口驱动与证据采集放在 `scripts/verify/ui/smoke/`。开发构建使用 `test/fixtures/application/desktop-entry.ts` 组装验证能力，发布构建使用 `src/main/bootstrap.ts`，生产依赖图不得包含测试或验证目录。`test/main/application/`、`test/main/ipc/` 和 `test/contracts/application-boundary.test.ts` 验证通道清单、入口隔离和生命周期顺序；`tsconfig.verification.json` 将验证入口纳入常规类型检查。

任务与会话执行位于 `main/conversation/`，审批和工具分发位于 `main/broker/`；模型设置、MCP 连接、Hook、自动任务和工作区逻辑由对应功能目录管理。IM 的委派、出站、管理和命令分发通过中立依赖接口协作，原服务继续持有运行状态。数据库 DDL、迁移和行转换分别位于 `settings/store-schema.ts`、`store-migrations.ts`、`store-row-codecs.ts`，分域仓库位于 `settings/persistence/`；`AppStore` 保留公共门面、单连接与事务边界，仓库间调用仍经过当前门面方法。

`renderer/app/App.tsx` 组合导航、工作区和页面状态；`AppNavigation.tsx`、`AppWorkspaceDock.tsx` 管理相应渲染边界，侧栏交互由 `use-sidebar-navigation.ts` 管理。时间线、团队、子代理和工具活动组件进入 `renderer/conversation/`。资源中心的插件卡片、能力包卡片和确认对话框位于 `renderer/plugins/*-renderers.tsx`，只接收当前渲染的数据和回调；缓存、订阅及操作队列仍由资源中心管理。`styles.css` 与 `nocturne.css` 是按原级联顺序排列的导入入口，规则按功能拆分；验证通过 `scripts/build/css-source.mjs` 递归读取实际样式。字体作为独立本地资源发布，CSS 预算不因拆分而提高。

插件安装协调、事务提交、清单解析、市场管理与持久化分别由 `main/plugins/` 下的对应模块负责；在线资源目录位于 `plugins/catalog/`。IM 的配置、授权、连接、群组同步、事件观察、范围操作和本地执行独立于服务门面，保留同一运行状态和授权边界。

前端控制逻辑按功能放在 `app/controllers/`、`plugins/controllers/`、`settings/controllers/` 和 `workspace/environment/`。草稿、历史、提交、Review、Goal、队列、资源安装和 Git 订阅各自维护操作逻辑；共享视图状态通过明确类型传入。拆分时保留 hook 顺序、effect 清理和过期请求保护；后声明的回调按需读取，原本提前保存的函数声明保留兼容委托。资源缓存位于 `plugins/resource-cache.ts`，样式副作用留在原视图入口。`renderer-controller-boundary.test.ts` 约束已拆出的职责和组合入口预算。

## UI Gallery

`apps/ui-gallery/src/` 仅保留启动入口和环境声明。`app/` 负责页面组合，`pages/` 放各类展示页，`components/` 放通用组件，`themes/` 放主题 fixture 与声明，`conformance/` 放契约及矩阵，`styles/` 放 Gallery 样式。两个测试继续集中在 `test/`；新增页面按所属功能归类。

## 共享包与工具

`agent-host/src/` 按 runtime、sessions、context、models、tools、policy 分组；`gateway/src/` 按 channels、groups、authorization、i18n、http、runtime 分组，入口与服务组合保留顶层。HTTP 入口保持公开能力链接、浏览器来源拒绝、管理员鉴权及设备鉴权的原有顺序；管理员与设备操作分别由 `http/` 下的路由模块处理。渠道接入、附件缓存、投递和群组同步由 `runtime/` 下的模块负责，共享状态通过中立依赖接口访问。UI 组件契约复用 `ui/src/internal/compare-contract.ts`，公共验证函数保留各自的错误消息规则。broker、路由、OAuth、更新和附件任务的共享契约放在中立类型模块，消费者使用显式 `import type` / `export type`。其他体量较小的包保留已有结构。

渠道的连接配置、契约和错误类型独立；飞书与企业微信实现分别位于 `channels/feishu/`、`channels/wecom/`，`channels/channels.ts` 保留兼容导出。

桌面专用脚本放在 `apps/desktop/scripts/{build,packaging,release,verify,dev}/`；verify 下区分 ui、native、features。跨工程脚本留在根级 scripts，按职责分组；`scripts/artifacts/` 提供证据路径工具。

Agent host 的 `runtime.ts` 保留公共门面和状态组装；模型与准入、会话观察、主/子会话、团队协调及生命周期分别由 `runtime/` 下的对应模块负责。会话工具按功能位于 `runtime/tools/`，Plan 计数和 MCP 动态工具集合仍按会话隔离。子会话通过实时读取的上下文共享工具工厂，保持取消传播和并发租约释放顺序。Gateway 路由位于 `routing/`，原生群组合作位于 `groups/cooperation/`，门面保留兼容方法和持久化状态。

## 产物与迁移检查

- 新的桌面验证输出默认使用 `artifacts/verification/<主题>/<运行标识>/`；可通过工具原有输出参数指定位置。
- 基准输出进入 `artifacts/benchmarks/`，开发演示材料进入 `artifacts/dev/`。
- `artifacts/office/`、`artifacts/slack-cli/`、能力包与皮肤工具产物是现有构建链输入，保持约定位置。
- 常规 dist、release 输出位置保持不变；编辑器默认排除这些目录。桌面的 build 目录也含图标、安装器配置等受跟踪输入，不能整目录清理。
- 历史证据保留；一次性材料不进入正式 docs。已退役应用产物放 `artifacts/legacy/`。

迁移时同时更新 import、动态路径、源码断言、npm 命令、CI 的路径过滤和资源入口。npm 命令名与包公开导出保持兼容；不建立旧内部路径的转发文件。

说明文档保留原路径，中文原文配 `-en.md`，英文原文配 `-zh-CN.md`，两版互相链接并保持内容同步。运行时 `SKILL.md` 和第三方许可证原文不纳入翻译；发布说明保留文件内双语。`npm run verify:docs` 检查配对、语言链接和本地 Markdown 链接，翻译完整性仍需人工审阅。

执行 `npm run verify:layout` 检查入口目录与公开导出，再执行受影响测试、完整测试、类型检查和构建。打包与原生验证分别记录平台和证据，不以单元测试代替运行时验证。
