# 插件项目类型与双向面板交互探索

初稿日期：2026-09-12。补充日期：2026-09-13（热插拔解耦与运行时安全）。状态：探索建议，未批准实施，未修改运行时代码。

核对基线：Artemis `08ec44b`；仓库依赖和本地安装的 `@earendil-works/pi-coding-agent` 均为 `0.85.1`。通过 Exa 分别检索扩展/SDK 与事件/RPC 两条线，共返回 10 条候选结果，对应 10 个不同 URL（含内容重叠的官方文档镜像）；补充读取官方 packages、SDK、extensions 页面，并以本地安装版本的文档和 Artemis 源码核对适用性。官方 `latest` 页面会变化，本报告不以它替代版本兼容测试。

## 1. 结论与需求对应

**可行，建议采用“Artemis 插件包契约 + 隔离插件运行时 + Pi 工具适配 + 抽屉面板桥接”。** Pi 已提供工具注册、事件订阅、用户消息注入和资源打包机制；项目类型注册、Electron 面板宿主以及跨进程双向通信需要 Artemis 自行提供。不能把安装一个普通 Pi package 等同于获得完整桌面插件能力。

| 用户需求 | 建议实现 | 当前缺口 |
| --- | --- | --- |
| 加载包后，创建项目/临时会话可选包内项目类型 | 主进程静态解析 manifest，更新类型目录；创建表单订阅目录变化 | Pi 没有 Artemis 项目类型注册表 |
| 项目和会话标记所选类型 | 项目保存类型绑定；项目内新任务复制绑定；临时会话直接保存绑定 | Project/Thread 尚无类型字段 |
| 特定类型激活右侧新 TAB，具体面板由包提供 | 通用 `plugin-panel` 页签承载隔离 Web 面板，按任务绑定筛选 | 当前页签是内置枚举和组件分支 |
| Pi tool call 驱动包内行为 | 注册有 schema 的专用工具，经过现有授权链路送到插件处理器 | 现有扩展 worker 只支持单次调用 |
| 面板输入转提示词，填入会话输入窗口并发送 | 插件生成 PromptIntent，宿主展示来源并接入统一提交/队列服务 | Pi 的 `sendUserMessage` 未接通 Artemis composer |
| 包自带双工监听 | 包声明 runtime 入口，由 Artemis 在匹配且获信任的会话中启动；长连接承载请求和事件 | 需要生命周期、路由、恢复和权限撤销机制 |

建议将“加载包”拆成**登记声明**和**激活可执行部分**。登记后类型可自动出现，但不在安装时启动所有项目的监听器；选择类型并满足信任条件后才激活对应实例。这样保留所需自动发现体验，也符合现有扩展信任边界。

**解耦目标**：完成通用宿主后，符合已开放插件协议的新业务能力，应能通过安装插件包获得，无需修改、重新打包或重启 Artemis；插件自身仍需提供业务代码与资源。新增宿主底层扩展点可能需要升级 Artemis，详见 §6.3。

**安全判断**：方案具有构建强隔离的基础，目前没有足够实现与实测证据宣称已满足。尤其必须防止插件通过提示词或修改项目脚本，让拥有更高权限的 Pi 工具代为执行；进程沙箱不能独自覆盖这条路径，详见 §8.2–8.4。

## 2. Pi 能力核查

### 2.1 包、扩展、UI 是不同层次

Pi package 使用 `package.json` 的 `pi` 字段声明 `extensions`、`skills`、`prompts`、`themes`，支持 npm、Git 和本地来源。这些属于资源分发机制，未提供项目类型或桌面抽屉注册契约。Pi 原生安装/扩展运行具有系统访问能力，不能原样作为 Artemis 默认安装执行策略。[官方 packages 文档](https://pi.dev/docs/latest/packages)

Pi extension 是接收 `ExtensionAPI` 的 TypeScript 模块，可用 `registerTool` 注册模型工具、`on` 订阅生命周期或拦截工具事件、`appendEntry` 存会话条目。`sendUserMessage` 可以触发新轮次，流式运行中需指定 `steer` 或 `followUp`；它不自动写入任意宿主的输入框。[官方 extensions 文档](https://pi.dev/docs/latest/extensions)

SDK 的 `createAgentSession`、`customTools` 和 ResourceLoader 适合嵌入桌面应用；外部可向 ResourceLoader 传共享 event bus，与扩展的 `pi.events` 通信。这个总线是进程内机制，不能直接跨 Electron/插件进程，也不自带项目隔离、鉴权或持久化。[官方 SDK 文档](https://pi.dev/docs/latest/sdk)

`ctx.ui.custom()` 面向 TUI，不是 React/Web 面板。RPC 支持对话框、通知、编辑器文本等受限 UI 消息，但不是通用桌面组件加载协议；现有 SDK 接入没有必要为了面板改成另一条 RPC 会话链路。[官方 RPC 类型](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/rpc/rpc-types.ts)、[官方 RPC UI 示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/rpc-extension-ui.ts)

### 2.2 兼容性承诺应有限

本次同时核对本地 `node_modules/@earendil-works/pi-coding-agent/docs/{packages,sdk,extensions}.md`。上述核心机制在安装的 0.85.1 文档中存在，但不代表 Artemis 当前允许完整调用。

建议第一版声明兼容“工具定义及有限事件桥接”，而不是“任意 Pi 扩展即插即用”。`ctx.ui`、会话切换、模型凭证访问、任意 provider 注册、TUI 渲染器、第三方依赖加载等接口须逐项声明支持范围；不支持的能力在安装检查中明确报告，不静默忽略。

## 3. Artemis 现状与可复用位置

以下为本次源码核查，不沿用旧设计提案中的状态判断。

| 位置 | 当前行为 | 对方案的影响 |
| --- | --- | --- |
| [agent-host/runtime.ts](../../../packages/agent-host/src/runtime.ts)，`DefaultResourceLoader`、`extensionTools` | 明确 `noExtensions: true`；把配置中的扩展工具包装为 `customTools`，经 `extension.call` broker 调用 | 保留代理工具模式，不打开任意扩展在 agent-host 内直接执行 |
| [extension-worker.ts](../../../apps/desktop/src/extension/extension-worker.ts)，`loadExactExtension`、`handle` | 通过内部 loader 路径加载；发现/执行为单请求；handlers/commands 等统计为 unsupported；`hasUI: false` | 当前不是完整 ExtensionRunner，也不是常驻双工服务；内部路径是升级风险 |
| [trusted-extension-manager.ts](../../../apps/desktop/src/main/trusted-extension-manager.ts)，`call`、`runSandboxed` | 执行前拒绝非 Execute；校验入口文件 hash；按调用启动沙箱 worker，60 秒超时 | 可以复用策略和启动机制，但不能将延长超时当作常驻运行时实现 |
| [codex-plugin-service.ts](../../../apps/desktop/src/main/codex-plugin-service.ts)，manifest 解析 | 读取 `.codex-plugin/plugin.json`，处理 skills/MCP/连接器信息，Hooks 等列为 unsupported | 它与 Pi package loader 是不同入口，需要归一化而非混用格式 |
| [protocol/schema.ts](../../../packages/protocol/src/schema.ts)，`projectSchema`、`threadSchema` | Project/Thread 无插件类型字段；事件已有 `protocolVersion/eventId/threadId/seq` | 增加可迁移类型绑定与插件事件 payload，延续 envelope |
| [store.ts](../../../apps/desktop/src/main/store.ts)，项目/任务表和 `upsertProject` | SQLite 持久化；项目路径唯一，重新打开已有路径复用项目 | 新类型不能只存 renderer，也不能重开路径时覆盖已有类型 |
| [temporary-conversation.ts](../../../apps/desktop/src/main/temporary-conversation.ts) | 临时会话无 projectId，有独立 workspace；仅支持 Local | 类型和信任必须按临时会话隔离，不能强造共享项目 |
| [workspace-tabs.ts](../../../apps/desktop/src/renderer/workspace-tabs.ts)、[App.tsx](../../../apps/desktop/src/renderer/App.tsx) | 页签为固定类型；DesignPanel 等按类型挂载；composer 有自己的发送逻辑 | 新增一个通用插件页签分支，并抽出可复用提交入口 |
| [main.ts](../../../apps/desktop/src/main/main.ts)，`startTaskTurn`、`queueTurn` | 已有启动、steer、follow-up 主进程流程 | 面板输入应进入这里，不另起 Pi session |
| [pi-adapter.ts](../../../packages/protocol/src/pi-adapter.ts)、[reducer.ts](../../../packages/protocol/src/reducer.ts) | Pi 原始事件转成 Artemis payload，UI 按协议还原 | 面板不能订阅原始 Pi 流；新增 payload 需幂等处理 |

## 4. 三条路径比较

| 路径 | 优点 | 主要问题 | 建议 |
| --- | --- | --- | --- |
| 完整 Pi extension 直接加载到 agent-host | 原生 API 覆盖多，进程内事件方便 | 改变当前 `noExtensions` 和隔离边界；仍没有桌面面板 | 不作为第三方插件默认路径 |
| Pi 工具适配 + Artemis 隔离 runtime + 面板 SDK | 复用唯一 Pi 循环、现有授权和队列；插件可提供业务 UI | 需要新增稳定插件协议和运行时 | **推荐** |
| MCP server + Artemis 面板 manifest | 已有工具协议和 stdio 沙箱；适合已有 MCP 后端 | MCP 本身不注册项目类型或抽屉，也不等于用户主动输入通道 | 作为后续可选后端适配器 |

MVP 只实现一种 runtime 后端，避免同时维护完整 Pi extension 宿主和 MCP 双套新桥接。插件业务代码可以共享纯函数工具定义；面向 Pi CLI 的入口是可选兼容层，不由 Artemis 不加区分地自动加载。

## 5. 包契约草案

以下文件名、字段和 API 均为**建议新增**，不是 Pi 或 Artemis 已有规范。

建议定义独立 `artemis.plugin.json`；既有 Codex 插件包和 Pi package 可附带它，统一转换成内部 PluginDescriptor。旧包无此文件时保持原行为。首版只接现有插件分发入口和本地包，npm/Git Pi 安装器集成另行实现，不默认执行安装脚本。

```json
{
  "schemaVersion": 1,
  "id": "com.example.design-studio",
  "version": "0.1.0",
  "engines": { "artemisPluginApi": "1", "pi": "0.85.1" },
  "projectTypes": [{
    "id": "design",
    "title": { "zh-CN": "界面设计", "en": "UI Design" },
    "targets": ["project", "temporary"],
    "panelIds": ["studio"]
  }],
  "panels": [{
    "id": "studio",
    "title": { "zh-CN": "设计工作台", "en": "Design Studio" },
    "entry": "panel/index.html"
  }],
  "runtime": {
    "entry": "runtime/index.mjs",
    "activation": "typed-session",
    "protocolVersion": 1
  },
  "tools": [{
    "name": "update_design",
    "description": "Update the current session design",
    "inputSchema": {
      "type": "object",
      "properties": { "brief": { "type": "string" } },
      "required": ["brief"],
      "additionalProperties": false
    },
    "handler": "design.update",
    "effect": "write",
    "projectTypeIds": ["design"]
  }],
  "capabilities": {
    "events": ["turn.completed", "tool.completed"],
    "sessionInput": "user-action",
    "network": false,
    "workspaceFiles": "read-write"
  }
}
```

全局类型键为 `pluginId/typeId`，面板键为 `pluginId/panelId`；工具名由宿主生成适合各模型供应商限制的稳定名称，保存映射并拒绝冲突。manifest 不允许覆盖核心工具。

登记阶段仅解析有大小上限、schema 校验和路径约束的静态内容。路径经 realpath 校验不得逃出包根；安装生成覆盖 manifest、runtime、面板和依赖的不可变内容摘要。当前扩展入口文件 hash 不足以代表整个插件包的信任，需要升级为包级完整性校验。

插件权限是申请值，实际能力由宿主策略、当前模式、会话绑定和已授权范围取交集。显示类型不执行入口文件；安装完成不等于已信任可执行内容。

## 6. 项目类型与生命周期

### 6.1 数据归属

建议 Project 和 Thread 均增加可选 `typeBinding`，包含 `pluginId/typeId/pluginVersion/contentHash/bindingRevision`；旧记录缺省解释为内置通用类型，不需要批量伪造第三方绑定。

项目类型是新任务默认值；任务创建时保存完整绑定快照。修改项目默认类型只影响未来任务。MVP 不开放已有任务原地换类型，后续需显式迁移插件状态并处理未提交草稿。类型与 `RunMode`、既有 design workflow 相互独立，选择设计类插件不会自动切 Execute。

| 场景 | 建议行为 |
| --- | --- |
| 新建/首次打开项目 | 通用类型为默认；可选已登记、支持 project 的类型；主进程二次核查所选版本 |
| 重开已存在项目路径 | 复用原类型，不用新选择覆盖持久化记录 |
| 项目内新任务 | 继承项目绑定，创建时固化；首版不另给任务选一个冲突类型 |
| 新临时会话 | 提供支持 temporary 的类型；绑定直接写入 Thread，首次发送前完成原子创建 |
| 同包多个临时会话 | 不共享业务状态或信任授权，使用各自独立 workspace 和 runtime 实例 |
| fork | 复制类型快照；插件状态必须支持只读快照复制或显式空状态启动，不能共享可变实例 |
| Local/worktree 交接 | 类型保留；暂停旧实例，按新 workspace 和信任范围重建；沿用现有 worktree 限额与确认规则 |
| 插件缺失、停用、版本不兼容 | 保留类型标签与状态；面板显示不可用原因，禁用插件工具，普通聊天仍可用 |
| 更新 | 先安装新版本并验证；已绑定会话不静默换包；迁移成功才切版本，失败保留旧快照 |
| 删除任务 | 停止实例、撤销通道、取消队列，按现有任务删除语义清理该任务插件数据 |

SQLite 迁移需同时覆盖列、行映射、导入/导出、任务复制和快照协议，不能只改 TypeScript。插件状态使用 `(threadId, pluginId, stateSchemaVersion)` 分区；项目共享素材另设显式 project scope，禁止默认把所有临时任务写到同一处。

### 6.2 自动发现与面板激活

已打开的创建表单订阅类型目录 revision，安装/停用后即时刷新。所选包在提交前变为不可用时保留输入并提示重新选择，不能自动回退为另一个类型。

任务激活时，宿主根据绑定生成插件 TAB 入口；第一次进入新建的类型任务时可默认打开首个面板，后续尊重关闭状态和焦点。普通状态推送不抢占当前页签。多个面板按 manifest 顺序提供；只有当前匹配会话的面板可见。

运行时按 `(threadId, pluginId, contentHash)` 建立实例，建议状态为 `registered → waiting-trust → starting → ready → stopping/stopped`，失败进入 `failed` 并可手动重试。关闭 TAB 只卸载视图；运行中的工具任务继续，重新打开从快照恢复。无活动和订阅的实例可超时回收，插件不得依赖永久驻留。

### 6.3 热插拔与无需修改宿主的边界

Artemis 应只依赖类型、面板、工具、事件、存储和会话提交等通用契约，不根据具体 pluginId 编写业务分支。例如，“界面设计”“数据分析”“流程建模”应由各自包声明项目类型、面板资源、业务工具和提示词转换，宿主无需增加专用组件或工具处理器。

| 扩展需求 | 是否应修改 Artemis |
| --- | --- |
| 新项目类型、类型名称、面板入口 | 否，由 manifest 注册 |
| 新面板布局、业务逻辑、工具 schema、提示词转换 | 否，由包内资源和 runtime 提供 |
| 已授权范围内的业务状态存取、事件订阅 | 否，通过版本化宿主 API 调用 |
| 接入已支持且获授权的网络服务 | 否，但必须遵守现有能力和网络策略 |
| 接管整个窗口布局、新原生设备能力、未开放的底层接口 | 可能需要；先扩充通用宿主契约，再由插件使用 |
| 所需插件 API 与已安装宿主不兼容 | 拒绝激活并提示升级，不通过加载私有宿主模块绕过 |

热插拔需要明确安装、激活、运行中更新与权限撤销的不同时间点：

| 操作 | 预期行为 |
| --- | --- |
| 安装 | 无需重启，自动登记类型和资源；信任检查完成前不启动可执行内容 |
| 启用 | 为匹配会话建立实例和面板；运行中轮次在安全边界刷新工具目录 |
| 停用 | 立即拒绝新调用并撤销消息通道；取消在途操作、终止进程树，保留历史状态 |
| 更新 | 新旧版本可并存；完成验证、授权和必要迁移后，在空闲或轮次结束时切换绑定 |
| 更新失败 | 保留旧绑定和可恢复状态，不自动执行内容已变化的版本 |
| 卸载 | 先完成停用；保留任务类型与数据，显示插件缺失，不删除会话 |

热插拔不承诺在一个工具执行过程中替换其代码。安全撤销应即时生效；正常版本切换等待安全边界。宿主还需维护插件 API 版本、能力协商、资源加载和依赖隔离，避免某个插件依赖全局模块状态而只能靠重启生效。

**解耦验收标准**：固定同一份 Artemis 构建产物，先加载设计插件，再加载一个业务不同的第二插件；不改宿主源码、不重新构建、不重启应用，完成类型发现、面板交互、Pi 工具调用与当前会话提交。停用任一插件后，另一插件和普通会话仍正常工作。

## 7. 双向通信的具体语义

### 7.1 Pi 调用插件

1. 宿主按任务类型、当前模式和信任状态选出可用工具，注册 Pi 代理工具；新安装包对已有运行中轮次在下一安全边界生效。
2. Pi 调用专用工具，代理捕获真实 `toolCallId`，沿现有 broker 做模型自动审批和主进程校验。
3. 主进程向目标插件实例发送 `tool.invoke`，携带已绑定的线程、轮次、参数、deadline 和 operationId。
4. 插件处理器执行业务行为，发回进度、结果或结构化错误；面板状态由宿主校验并持久化后发布。
5. Pi 收到正常 tool result 继续同一循环。面板没有打开，也不影响工具完成。

**执行入口是专用工具调用，不是观察到 `tool_call` 就执行。** 生命周期监听仅用于观察，否则同一调用可能在审批前运行或被重复处理。第一版只分发插件自身工具摘要和必要会话生命周期；跨工具监听须额外声明并脱敏，原始 Pi 对象仍止于 PiAdapter。

短操作在返回成功前提交状态；长操作返回 operationId 和真实的 accepted 状态，再由查询工具取得完成结果。不得把“事件已收到”伪装成业务成功，也不能让 tool execute 一直等待用户在面板中产生下一轮消息。

### 7.2 面板输入 → 提示词 → Artemis 执行

目标体验：用户在面板输入“把主色改成深绿”并点“发送到会话”；插件结合当前选中对象生成提示词；Artemis 输入区显示插件来源和提交内容，随后进入当前会话发送或排队。在现有授权范围内，一次明确的发送动作无需额外确认；提交消息不等于授权插件生成文本所要求的全部副作用，扩大执行权限另按 §8.3 处理。

推荐链路：面板 `panel.action` → 隔离 runtime 转换 → `session.prompt.request` → 宿主 PromptSubmissionService → composer 提交状态/现有 `startTaskTurn` 或 `queueTurn` → Pi。

PromptIntent 建议包含 `requestId/actionId/panelInstanceId/text/contextRefs/delivery/origin`，另由宿主保存用户动作对应的原始输入、插件生成内容和有效授权引用，避免合并为不可区分的一段用户指令。`threadId/pluginId/version/mode` 与来源记录由宿主根据连接和当前绑定确定，不信任插件自行指定。转换模板和最终文本都记录来源；插件提供的上下文是低于系统和用户请求的材料，不能变成 system 指令。

| 状态 | 行为 |
| --- | --- |
| 空闲且输入框无草稿 | 将生成内容作为带来源的提交项展示并发送，成功后清理该项 |
| 输入框已有草稿 | 原草稿保持不变；插件内容在输入区独立提交条目中展示并发送，不串接用户半成品 |
| 当前任务运行中 | 默认作为 follow-up 排队并显示队列位置；steer 由用户显式选择 |
| 插件动作只有“填入” | 保存为草稿，不发送 |
| 发送失败 | 保留插件提交项和错误，用户可用同一 requestId 重试 |
| 转换期间切任务/关面板 | 自动提交资格失效，内容留在原任务待处理；不转发到新活动任务 |
| Plan/Review | 不启动可执行插件转换器；可读宿主保存的状态，宿主提供“发送原始文字”以当前模式聊天 |

PromptSubmissionService 是建议抽取的新服务，不是源码现有类名。composer 和插件桥接共用提交校验、附件、队列、取消及来源记录；不要通过 DOM 设置 textarea 再模拟点击。`sendUserMessage` 证明 Pi 具备消息注入能力，但本方案不向第三方直接暴露它，以免绕过宿主历史、队列和模式检查。

“新的会话交互”在本报告中按**当前会话的新轮次**处理。若面板要创建另一个独立任务，应另设显式用户动作和创建契约，不把当前需求扩成自动创建任务。

### 7.3 传输、隔离与恢复

主进程到 runtime 建议使用带长度限制的 stdio 双向 JSON 帧：stdin 不再等到 EOF 才处理；stdout 只承载协议，日志走 stderr。无需向本机网络开放监听端口。UI 到宿主使用独立 MessagePort，经宿主验证后才能触达主进程；这不是 Pi `pi.events` 的网络化直通。

每帧包含 `protocolVersion/requestId/instanceId/generation/type/payload`；宿主补齐线程/插件/轮次上下文。持久化 UI 事件继续使用 Artemis 的 `protocolVersion/eventId/threadId/turnId/seq/timestamp` envelope，插件 payload 另含状态 schema 版本。可靠性约束如下：

- 双向 handshake 协商协议版本；退出、崩溃或切 workspace 后递增 generation，丢弃旧响应。
- 接收请求后持久化去重记录；以 `(threadId, pluginId, requestId)` 和内容摘要识别重试；相同 ID 不同内容拒绝。
- 业务变更以 operationId 幂等提交；用 outbox 在状态落盘后发布事件。UI 按 eventId/seq 去重，重连先取快照再补事件。
- PromptIntent 的接收记录与队列写入需事务衔接；接收成功不等于 Pi 已完成。崩溃后状态不明时要求核对，不能无条件重发非幂等操作。
- 请求有 deadline、取消消息、输出大小和队列上限；进度可合并，终态不可丢。重启次数设限，避免崩溃循环。
- 绑定来源为 `user-panel/tool/system` 并保留 causationId；工具产生的状态变化不能自行变成新用户输入。自动提交要求消费宿主签发的一次性用户动作凭证，防止工具→面板→提示词无限循环。

## 8. 面板容器与执行边界

### 8.1 基础隔离方案

建议独立 PluginPanelHost：包内静态 HTML/JS 由宿主受控资源协议提供，在隔离 iframe 或专用 WebContents 容器内运行。第一阶段原型验证两者的焦点、嵌套预览与权限表现后定型；不能直接把第三方 React bundle import 到 Artemis renderer。

容器无 Node、Electron 或通用 preload 能力；仅获狭窄面板 SDK。禁止任意导航、弹窗和本地文件 URL，CSP 默认禁网络和任意外部脚本；资源服务校验包摘要、路径与 MIME。连接握手同时核对实际 frame/source、实例和一次性 token；不把 iframe 自报的 pluginId 当作身份。

Plan/Review 下默认呈现宿主渲染的持久化状态与不可用提示，不挂载可执行插件面板/runtime；恢复 Execute 后重新检查信任并启动。已经启动的插件切入只读模式时，先撤销权限与通道，再取消任务并终止进程树，不能只隐藏写按钮。已执行的外部副作用不能声称已撤回，需在状态中如实记录。

执行端复用 Seatbelt/AppContainer，限定当前实际 workspace、私有运行目录、只读包资源及显式网络权限。临时会话使用任务级信任范围，等价执行项目/内容摘要检查但不扩散授权。包升级或依赖变化重新校验并失效旧信任。

`Full local access` 仍只影响可执行 Pi 扩展；若新 runtime 纳入该设置，应明确作为该扩展执行类别，不能让面板或 MCP 顺带获得它。Pi bash 和用户终端现有权限语义保持。当前 worker 启动路径存在 `process.env` 合并，是否在平台启动器中清理需要单独验证；新运行时应显式采用环境白名单，不能声称现实现已证明无凭证继承。

### 8.2 安全目标与强度判断

面向可信或经过审核的插件，这条技术路线合理；面向可能恶意的第三方插件，应以“直接访问和经宿主间接调用都不能突破授权范围”为独立验收目标。目前报告只能确认方案方向，不能证明已达到该目标。

AppContainer 提供文件、网络等资源隔离；Electron 官方要求启用进程沙箱、上下文隔离、限制暴露的 API 并验证 IPC 发送者。这些能力为方案提供基础，安全效果仍取决于具体策略、宿主代码及依赖版本。[Microsoft AppContainer 文档](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)、[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)

| 层面 | 必须成立的约束 | 不能单独作为安全证明的措施 |
| --- | --- | --- |
| 执行进程 | 操作系统强制文件、网络与进程限制；最小环境；权限在执行前校验 | 单独开子进程、设置工作目录、模型认为安全 |
| 插件面板 | 无 Node/Electron 权限；沙箱、上下文隔离和有限 API；默认拒绝浏览器权限请求 | 仅 iframe 标签、仅隐藏按钮 |
| 消息桥接 | 验证真实发送者、实例、任务、generation 和参数；每次调用重查授权 | 插件自报 pluginId/threadId、只在启动时校验一次 |
| 能力调用 | 实际能力不超过宿主策略、当前模式和明确授权的交集 | 插件自行声明权限、点击发送后授予整个宿主能力 |
| 热插拔 | 立即撤销入口，再取消操作和回收进程树；更新重新验证内容 | 只移除 TAB、只杀父进程、仅丢弃迟到消息 |

授权范围本身也决定风险：允许读取整个项目就可能读到其中的敏感文件，允许写入项目就可能破坏其中的数据；不能把“限制在 workspace 内”解释为“工作区内容不会受损”。两个任务使用同一个 Local checkout 时，即使消息和插件私有状态隔离，获准访问的项目文件仍共享；任务绑定不能提供不存在的文件隔离。

启用 `Full local access` 的可执行扩展属于明确受信任的执行模式，不能继续承诺相同的文件和网络隔离强度。严格隔离目标也不包含消除所有操作系统、Chromium 或依赖漏洞；需持续更新依赖并验证最终打包产物。

### 8.3 防止通过 Pi 间接越权

需要覆盖两类具体路径：一是插件本身无权读取工作区外文件，却生成提示词让 Pi 的全权限 bash 代为读取；二是插件在获准写入的项目中修改脚本，再通过提示词或正常工作流诱导 Pi 执行。两者都可能发生在插件没有逃出自身沙箱的情况下。

建议增加以下宿主约束；这些是待实现的安全要求，不是当前系统已有保证：

1. **来源不能由插件提升。** 区分用户原始输入、插件转换内容、工具结果及文件来源；来源信息经过队列、重试、历史恢复和上下文压缩后仍由宿主保留，不能因再次发送就变成新的用户授权。若业务输入完全由插件面板采集，也不能仅凭插件声称“这是用户输入”扩大权限。
2. **用户动作只授权约定范围。** 一次性动作凭证证明某个动作可被处理，不证明插件生成的任意命令都获准执行；发送按钮不会自动授权读取凭证、跨项目写入或外部网络操作。
3. **插件自动化采用受限能力集合。** 代理工具与后续调用由宿主检查有效授权。需要范围外能力时拒绝自动调用，交由宿主按现有策略处理；确需用户授权时，展示具体操作、资源和来源，插件不能自行批准。
4. **全权限 bash 不能被当作受限插件接口。** 保持现有 Pi bash 与用户终端的权限契约；若不能用硬性策略约束某条插件链路，就不向该链路开放自动使用全权限工具的入口。不能声称根据命令文本简单匹配路径，就能安全限制任意 shell 脚本的副作用。
5. **文件路径不能抹去来源。** 插件改写的脚本进入宿主执行前，不能仅因它位于用户项目目录就继承更高授权。若无法可靠跟踪来源与执行范围，强隔离模式应限制自动执行，或使用插件私有产物加受控交接；不能只依靠提示词提醒模型谨慎。

模型风险判断继续作为现有审批流程的辅助；它不能替代操作系统沙箱与宿主执行前策略。对混合了用户输入和插件材料的会话，如何跨后续轮次保持授权边界仍需原型验证；完成前只能承诺已验证的受限链路，不能宣称任意恶意插件可安全自动驱动宿主全部能力。

### 8.4 当前证据缺口

| 待补齐项 | 当前依据与限制 | 后续要求 |
| --- | --- | --- |
| 包及依赖完整性 | 当前 trusted extension 路径主要校验入口文件 hash | 对 manifest、runtime、面板和依赖形成不可变快照；验证执行内容与授权内容一致；摘要证明内容一致，不证明内容无害 |
| 环境变量隔离 | worker 启动路径存在 `process.env` 合并 | 审核平台启动链路，使用显式白名单；验证进程和后代无法获得未授权凭证 |
| 常驻实例回收 | 当前单次 worker 有超时与 `child.kill()` 路径 | 原生验证整个进程树、在途请求、网络连接及旧通道的撤销，不将逻辑停用当作物理终止 |
| 自动提交的间接权限 | 本报告原有来源与防循环约束不足以独立限制宿主副作用 | 补有效授权传播与执行前校验，覆盖提示词和文件两条路径 |
| 平台与资源限制 | 尚未运行插件原型或最终包验证 | 明确并测试 CPU/内存/进程数、消息和磁盘配额；验证沙箱失败时拒绝启动，不静默降级为完整本地权限 |

安全验收要分别记录“已具备的代码约束”“已通过的原生测试”和“仍未验证的风险”，不能从单元测试通过推导出 Windows/macOS 强隔离已完成。

## 9. 与设计模式专项的关系

现有 [设计方案](solution.md) 和 [执行计划](plan.md) 聚焦内置 design workflow。新插件项目类型是横向基础能力，本报告不把原有计划替换掉，也不立即迁移全部 DesignPanel/DesignService。

建议用一个最小“设计工作台”示例验证：选择类型 → 自动出现面板 → 模型调用更新设计工具 → 面板显示版本 → 用户面板输入 → 当前会话新轮次。先复用已存在的设计结果或简化 JSON 文档，不复制整套预览、版本和实施管线。闭环稳定后，再决定内置设计功能是否作为第一方插件注册；迁移必须保留历史设计数据和 `/design` 兼容。

## 10. 分阶段验证与实施落点

下列为后续建议，并非本次已完成的实现或测试。

| 阶段 | 交付 | 验收出口 |
| --- | --- | --- |
| S0 契约原型 | 固定 Pi 0.85.1；最小包、静态类型目录、单会话双工 echo、面板隔离实验 | 单个 Pi session 完成工具→面板→用户输入闭环；不依赖 Pi 私有 loader 路径或明确封装其兼容风险 |
| S1 类型持久化 | schema、SQLite、创建输入、主进程验证、类型标签与目录推送 | 项目/临时会话重启不丢类型；旧任务兼容；停用包不会错绑或覆写数据 |
| S2 工具和运行时 | 进程管理、包级信任摘要、策略 broker、工具结果与取消 | 同包双任务的消息/私有状态隔离；Plan/Review 在执行前拒绝；沙箱失败不降级；取消/崩溃不虚报成功 |
| S3 面板和提交 | 通用 TAB、面板 SDK、PromptSubmissionService、来源/有效授权传播、队列 UI | 不覆盖草稿、不串任务、重试不双发；插件输入和文件不能自动扩大宿主执行权限；面板卸载重开状态一致 |
| S4 生命周期与发布 | 版本迁移/回滚、卸载保留、断线恢复、第二业务插件、资源限额、平台打包验证 | 同一构建产物完成两类插件的无重启安装和停用；通过强隔离目标与最终 Windows/macOS 包验证后，才声明相应支持范围 |

建议代码落点：`packages/protocol` 增类型绑定、面板事件和请求 schema；main 增 PluginRegistry/RuntimeManager/PanelHost 与提交服务；agent-host 增按会话选择的代理工具；renderer 仅消费协议并渲染目录、标签与通用页签；现有插件管理页接入声明预览和失效状态。以上模块名为工作划分建议，不要求一次性拆分现有大文件。

### 必须验证的失败路径

| 测试 | 预期 |
| --- | --- |
| 类型目录更新与创建并发 | 主进程拒绝过期版本，保留用户表单 |
| 两项目/两临时任务使用同包，伪造 threadId | 工具、面板、状态和提示词只能访问绑定任务 |
| 重复请求、乱序事件、重启、Pi 忙碌 | 一个提交至多形成一个已确认队列项；状态不明进入核对，不盲目重放 |
| tool result 引起面板更新 | 没有用户发送动作便不会触发下一轮 |
| 用户有草稿、切任务、关闭面板后迟到转换 | 不覆盖、不串发、旧资格失效 |
| Execute 切 Plan/Review、信任撤销 | 写操作在 executor/文件调用前被拒；旧实例停止，迟到消息失效 |
| 包内依赖/面板内容被改、目录穿越、伪造桥接 | 信任失效或请求拒绝，无宿主 API 泄露 |
| TAB 未打开、崩溃、重新打开 | 工具状态独立于 UI；恢复展示真实结果 |
| 更新失败/卸载后重新安装 | 保留旧类型和状态，不静默重置或运行未信任内容 |
| 同一 Artemis 构建加载第二个不同业务插件 | 不修改源码、不重打包、不重启，完整跑通类型/面板/工具/会话；停用一个不影响另一个 |
| 运行中更新或撤销插件 | 更新在安全边界切换；撤销即时拒绝新请求，旧进程树与连接回收，已发生副作用如实记录 |
| 面板生成超出用户动作范围的提示词 | 不因来源被包装成用户消息而扩大权限；未授权调用在执行前拒绝 |
| 插件改写项目脚本并诱导全权限执行 | 项目路径不自动提升信任；超出授权范围的自动执行受阻 |
| 来源经过 follow-up、重试、压缩、恢复 | 宿主来源与有效授权不丢失；插件不能自行清除限制 |
| 沙箱启动失败、后代进程、环境凭证和资源耗尽 | 拒绝不受隔离的启动；原生检查回收、最小环境和配额；未验证项不能标为通过 |
| 打包后 macOS/Windows | 实测沙箱、进程树终止、网络、环境、最终路径及权限 |

实现时先写政策回归测试，再增加能力；运行相关单测、`npm test`、`npm run typecheck` 和 `npm run build`。跨平台完成证据遵循根级 AGENTS：macOS 要有 arm64/x64 打包及 PTY、Seatbelt、签名、公证、stapling、更新/回滚证据；Windows 检查用户实际运行路径的最终产物及有效 ACL。协议测试不能替代这些验收。

## 11. 建议进入下一步的决策

可先认可这四项方向，再立 S0 原型任务：**一份显式 Artemis manifest、任务级类型快照、独立隔离运行时、宿主统一消息提交**。项目类型不扩展 RunMode；自动发现不等于自动信任；面板发送使用当前会话；Pi 保持唯一 agent loop。

立项时将两项结果列为独立验收门槛：**固定宿主构建可热插拔第二个不同业务插件**，以及**插件直接访问和经 Pi 间接调用均不突破已授予的范围**。热插拔成功不能代替安全通过，安全通过也不能代替解耦验证。

待原型验证的主要未知项是面板容器选型、常驻进程沙箱与撤销行为、跨轮次来源和有效授权传播、提交队列崩溃恢复、现有 DesignPanel 迁移成本。这些不影响功能扩展的可行性结论，但决定实现规模与可承诺的安全范围。目前没有足够实测依据给出可靠工期、宣称第三方插件全面兼容，或宣称恶意插件强隔离已完成。

本次产物为源码与文档核查后的探索报告；未安装待研究插件、未改变扩展权限、未运行插件原型，也未进行平台验证。
