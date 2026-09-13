# 自定义子智能体实施状态（PR1–PR5 交付记录）

本文档对应 [plan.md](plan.md) 第九节的 PR 拆分，记录各 PR 的落地提交与验证结果，并明确当前已知限制。最终发布验收（PR6）证据见文末。

## 交付记录

| PR                 | 内容                                                                                                                                                                                  | 提交                                                  | 验证                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR1 协议与策略契约 | 定义/引用/快照类型、错误码、目录预算（20 定义 / 4096 字符）、P1 规范化（NFC + 大小写折叠 + 拉丁词边界 / CJK 子串）、调用状态机                                                        | `b418ca1`                                             | `packages/protocol/test/custom-agents.test.ts`（策略回归先行）                                                                                                  |
| PR2 存储与项目目录 | SQLite 迁移 v13（定义、项目关联、调用去重记录）、CRUD、revision 冲突、projectId 过滤                                                                                                  | `1070605`                                             | `apps/desktop/test/store.test.ts`（旧库升级、删除最后关联、无项目 selected 拒绝）                                                                               |
| PR3 运行时定义执行 | 统一接受入口、模型/思考解析、能力交集（plan/review 收窄）、快照冻结、撤销取消、重试复检                                                                                               | `f75e249`、`8c00622`                                  | `packages/agent-host/test/custom-agent-dispatch.test.ts`                                                                                                        |
| PR4 管理与手动闭环 | 设置管理区块、结构化 @（光标跟踪、IME 安全）、幂等派发（同 ID 同文复用 / 异内容拒绝）、实例身份展示、能力预览                                                                         | `a0b2767`、`5d64f9f`、`3a9f814`、`0f285ed`、`5255ef0` | `apps/desktop/test/custom-agents-settings.test.tsx`、`custom-agent-mention.test.tsx`、`custom-agent-identity.test.ts`                                           |
| PR5 自动委派       | 轮内自动目录注入、P1 精确名称纠偏（零实例/零预算）、P2 触发词建议、P3 `custom-agent.route` 持久审计（invocationSource 与 selectionBasis 分列）、目录溢出停用自动路由 + 设置页预算提示 | `8f1dca8`                                             | 三个发布阻断测试经真实工具入口：`packages/agent-host/test/custom-agent-routing.test.ts`；评估：`eval/custom-agent-routing-report.md`（确定性门禁 100%，可复现） |

## 已知限制（本阶段）

- **@ 调用要求线程空闲**：结构化 @ 只在发送新轮时生效；运行中线程的跟随便携带自定义引用在发送侧被拒绝（`customAgentWhileRunning` 提示）。排队消息携带引用留待后续阶段。
- **概率性语义选择未随附实测数字**：评估报告的模型语义层（P2 从目录中选择）只记录方法论与关闭自动路由的基线；实时模型对比需在固定模型/配置下运行后补充，不承诺 100% 语义匹配。
- **仓库共享定义**不在本期范围（M4 另立讨论，需重新审核信任来源与优先级）。
- **原型页面未扩展**：`docs/ui-prototype` 未新增子智能体页面；设置/输入区改动直接落在产品侧并复用既有组件与 token，验证以渲染测试和真实桌面运行为准（静态原型不作为生产交互验证）。

## 回退演练

- 数据库为增量迁移（v13 新增表，不改动既有表结构）；回退不删除定义数据。
- 旧版本二进制读取 v13 库：既有表与事件可读，但 `custom-agent.route` 等新事件载荷不在旧协议并集内——**不要**让旧二进制直接打开升级后的库；按升级前备份恢复（`~/Library/Application Support/artemis` 下的库文件在升级前已由应用自动备份机制覆盖范围以发布说明为准）。
- 自动委派可独立关闭：定义的“允许自动调用”开关或清空自动集合即可让路由退化为纯手动 @，显式调用链路不依赖自动目录。
- 定义执行能力异常时，运行时对失效定义返回编码错误（`CUSTOM_AGENT_DISABLED` / `CUSTOM_AGENT_NOT_FOUND`），显式请求不会静默退化为自由角色。

## PR6 发布验收证据（2026-09-13 执行，main @ `8505bbc`）

- 门禁：`npm test` 全链通过（pre-push 校验、gateway/protocol/platform/agent-host/theme-contract/ui/theme-artemis/ui-gallery 测试、皮肤包与一致性、UI 收敛/UI 边界/UI 包消费者、desktop 构建、UI 性能、ui-gallery 校验、desktop 测试；exit 0）；`npm run typecheck` exit 0；`npm run build` exit 0。
- 真实桌面运行（隔离用户数据）：`--user-data-dir` 指向 `/tmp/artemis-acceptance-home/desktop` 启动 v1.5.8 桌面构建；预置合成项目 `PR6 合成验收项目`（`/tmp/artemis-acceptance-project`）；供应商配置自本机 Keychain 同身份拷贝解密。
- 桌面流程：设置 → 智能体配置 → 新建子智能体 `acceptance-release-drafter`（scope=selected 绑定合成项目、仅手动 @、触发词"发布说明/release notes"、专用提示词 0.2 KiB，保存后列表"1 项"）→ 合成项目会话结构化 @ 调用（提及弹窗仅列出生效定义，项目过滤实时生效）→ 任务"为本项目 README 起草 5 条发布说明要点"→ 34 s 完成 → 主智能体整合交付。
- 实例展示：环境面板行与 Agent 团队面板成员行均为 `@acceptance-release-drafter · r1 · kimi-coding/k3 · @ 调用`；团队消息含子代理交接（5 条要点）与主 Agent 整合确认。截图存于 `/tmp/pr6-e2e-*.png`、`/tmp/artemis-running.png`（临时目录，仅作执行当日凭证）。
- 自动路由/调用审计：`custom_agent_invocations` 恰一条记录（invocation `fd08f89e…`、`definition_revision=1`、`status=finished`）；`custom_agents.revision=1`、`scope='selected'`、`enabled=1`；`custom_agent_projects` 绑定 1 条。
- 未验证平台范围：Windows 与 macOS 打包产物（签名/公证/更新/回滚）按项目合同在发布时另行提供证据；本次为 macOS 桌面（开发构建）+ 真实模型运行。

## PR #192 审核修复

- 工具授权按具体工具 ID 检查：空白名单不提供业务工具，内置/附件/远程工具与 MCP 均受冻结策略及执行前授权检查约束。设置页补齐可选读取工具。
- 实例冻结完整工具策略及模型对象；后续扩大白名单不影响已接受实例，收窄工具授权或移出项目会阻止后续工具调用，未启动实例取消。
- 固定模型不存在时，在注册实例及扣减预算之前拒绝。自动目录溢出同时关闭模型引用和名称纠偏，手动调用保留。
- 调用去重先于初始回合事件，避免冲突调用留下运行状态；已提交的相同调用复用原回合。
- 恢复检查点不保存完整定义或专用指令。进程重启后该恢复回合不自动委派自定义实例；用户发送新回合后重新读取当前有效定义。
- 回归覆盖真实子会话工具注册、撤销后执行拒绝、MCP 稳定引用、模型拒绝零预算、范围收窄和检查点最小化。完整发布平台验证仍以以上平台范围为准。
