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
