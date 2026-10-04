[English / 简体中文](hooks-en.md)

# Artemis 钩子开发指南

钩子是在现有 Pi 生命周期中触发的本地命令脚本。它使用当前桌面用户的文件与网络权限，不自动提权，也不受可执行扩展的 **Full local access** 开关控制。

## 配置与授权

1. 用户级配置放在 `~/.artemis/hooks.json`，项目级配置放在当前工作区的 `.artemis/hooks.json`。工作树读取自己的配置。
2. 将受检测脚本放在同目录下的 `hooks/`。可以复制[示例配置](../../examples/hooks/hooks.json)，并将三个 `.mjs` 文件放入 `.artemis/hooks/`。示例需要 Node.js；完成检查示例需要项目提供 npm `test` 脚本。
3. 打开「设置 → 钩子」。项目菜单、已安装插件卡片和输入框上方的待审核提示都进入同一个审核界面。
4. 查看来源、事件、匹配条件、完整命令、工作目录、超时、脚本内容和变更；主动勾选钩子，选择范围，点击「信任并启用」。不会自动全选。
5. 未审核钩子跳过运行；已信任且未变化的钩子自动运行，不逐次确认。授权从下一个匹配事件生效，不补跑历史事件。

用户钩子作用于所有本地项目；项目钩子只作用于对应项目，相同内容的同项目工作树可沿用信任。插件钩子默认仅授权选定项目，也可明确选择所有本地项目。插件安装、签名校验、项目可信与钩子信任分别处理。停用插件会停止其钩子，卸载会撤销钩子信任。

信任和运行记录保存在应用数据目录，不写入项目或插件包。定义、受检测脚本或插件内容变化会使旧授权失效。任意外部脚本依赖和解释器不在完整内容锁定范围内，需要自行审核。受检测脚本目录不允许符号链接。内容查看最多展示 30 个、不超过 64 KiB 的文本文件；完整受检测文件列表展示哈希。

Plan 不执行命令钩子，跳过钩子后仍可正常对话。Work 和 Codemode 模式下，本地交互任务、IM 私聊和群聊、自动化及其子代理使用相同的钩子信任规则；IM 任务仍须通过当前会话授权检查。没有配置或信任钩子时直接继续；提交钩子拦截初始消息时会显示失败原因。切换任务不会结束会话。

## 命令接口

配置采用 Codex 风格的「事件 → matcher → hooks」JSON 结构。参见[示例](../../examples/hooks/hooks.json)和[英文接口表](hooks-en.md#configuration-and-command-protocol)。多个来源累加，同事件处理器并发执行，拒绝优先；多个参数改写发生冲突时阻止调用。

`matcher` 使用有长度限制的 JavaScript 正则（不支持量化分组、环视、反向引用及超过两个重复量词）；省略、空串或 `*` 匹配全部。`UserPromptSubmit` 和 `Stop` 不使用 matcher。优先使用 Artemis 实际工具名；`shell` 也匹配 `Bash`，`write` 也匹配 `Write`、`Edit`。`tool_input` 保留 Artemis 参数结构及必需的审批元数据，因此这是明确的 Codex 风格兼容子集，并非所有工具脚本可以原样迁移。

首版只执行同步 `command`，支持 `commandWindows`、`timeout` 和 `statusMessage`。异步、`prompt`、`agent` 处理器报错。默认超时 30 秒，上限 600 秒；`SessionEnd` 默认 1 秒，上限 3 秒。macOS 使用用户 Shell 的 `-lc`，Windows 使用 `cmd.exe /d /s /c`，工作目录是任务工作区。

脚本从 stdin 读取一个 JSON 对象：`version: 1`、`hook_event_name`、`session_id`、可选 `turn_id`、`cwd`、`permission_mode` 和事件字段。当前 `transcript_path` 为 null，不依赖 Pi 内部会话格式。工具事件提供 `tool_name`、`tool_use_id`、`tool_input`，后置事件另有 `tool_response`。子代理事件提供 `agent_id`、`agent_type`。

- 退出码 0 且无输出表示成功；结构化输出写 stdout，诊断写 stderr。
- `SessionStart`、`SubagentStart`、`UserPromptSubmit` 支持纯文本或 `hookSpecificOutput.additionalContext` 补充上下文。
- `UserPromptSubmit` 使用 `decision: "block"` 和 `reason` 拒绝提示词。
- `PreToolUse` 使用 `hookSpecificOutput.permissionDecision: "deny"` 拒绝调用；`"allow"` 加 `updatedInput` 改写参数。改写后重新校验，不能绕过原执行策略。
- `PermissionRequest` 使用 `hookSpecificOutput.decision.behavior: "allow" / "deny"`。不返回决定则继续正常审批；硬性权限拒绝仍生效。授权这个钩子意味着允许脚本参与工具审批，审核界面会明确说明。
- `PostToolUse` 支持补充上下文；`decision: "block"` 或 `continue: false` 将反馈交给模型，但不能撤销工具已发生的副作用。
- `PreCompact` 的 `continue: false` 阻止压缩；`PostCompact` 的相同输出停止压缩后的继续生成。手动和自动压缩均覆盖。
- `Stop` 和 `SubagentStop` 的 `decision: "block"` 请求补做一轮，每个原始回合最多一次。`continue: false` 优先停止，`stop_hook_active` 标记已经续跑。
- `SessionStart` 在首次 Work 或 Codemode 使用、恢复及压缩后触发；`SubagentStart` 在子代理开始执行时触发。
- `SessionEnd` 在归档、删除及正常退出时做尽力清理，不保证崩溃时执行，不会因为输出继续保留会话。

退出码 2 通过 stderr 返回前置拒绝、后置反馈或结束续跑原因。前置执行失败阻止当前操作；审批钩子失败回到正常审批；后置失败记录错误并保留原结果。取消和预算终止优先于续跑。长 Shell 命令的等待不会重复执行前置钩子，后续等待返回最终结果时执行后置钩子。

stdout/stderr 合计上限 256 KiB，超限终止进程。模型反馈最多 10,000 字符。最近 200 次运行保留至多 16,000 字符输出和 4,000 字符错误。不要输出凭据。取消、超时、撤销信任会清理进程树。重启后标记中断，不自动重放，外部副作用不承诺 exactly-once。

## 插件开发

manifest 可通过 `hooks` 声明 `./` 开头的相对路径、路径数组、内联配置或内联配置数组；无声明则发现 `hooks/hooks.json`。路径必须留在插件根目录。脚本环境提供 `PLUGIN_ROOT`、`PLUGIN_DATA` 及对应 `CLAUDE_PLUGIN_*` 别名。[示例插件](../../examples/hooks/plugin/artemis.plugin.json)包含会话开始钩子，安装后仍需单独审核。

## 验证

```sh
npm run build:core
npx vitest run apps/desktop/test/main/hooks/hooks-service.test.ts packages/agent-host/test/runtime/hooks-bridge.test.ts apps/desktop/test/renderer/hooks/hooks-settings.test.tsx
npm run typecheck
npm run build
```

服务测试会启动真实本机进程并检查超时、取消。需要分别在 macOS 和 Windows 运行，不能用协议测试代替原生验收。最终安装包还需分别验证设置页、三个快捷入口、内容变化后重新审核及实际脚本执行。

CI 工作流可用 `hooks_only=true` 在 GitHub 托管的 macOS arm64 与 Windows x64 runner 上运行原生验收。界面测试使用隔离用户目录和无需激活的正常启动路径。Windows 打包检查验证实际产物与有效 ACL；真实桌面人工验收另行记录。
