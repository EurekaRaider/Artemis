# 测试与 CI 精简审计

审计日期：2026-09-13。范围：9 个 workspace 的测试入口、测试文件清单与覆盖类型，根级验证脚本，以及 CI、Release、PR Auto Review 三份 workflow。对删除候选逐条审阅并核对保留覆盖；不把文件盘点等同于逐条证明所有测试都有价值。

## 结论与盘点

修改前共有 301 个 `*.test.ts/tsx` 文件（含工作区当时新增的 3 个未跟踪测试），删除后 297 个。文件数包含单元、组件、集成和源码契约测试，不能统称为单元测试。下表为删除前数量。

| 范围           | 文件数 | 处理                                         |
| -------------- | -----: | -------------------------------------------- |
| protocol       |     12 | 保留事件、schema、幂等 reducer 和协议边界    |
| platform       |      5 | 保留路径、模式策略与沙箱参数验证             |
| agent-host     |     48 | 保留运行时、恢复、上下文、并发和工具权限行为 |
| gateway        |     14 | 保留鉴权、配对、撤权、消息投递与打包集成     |
| theme-contract |      1 | 保留公开主题契约                             |
| ui             |     17 | 保留组件行为、键盘和无障碍契约；消除重复执行 |
| theme-artemis  |      1 | 保留 token、对比度和产物校验                 |
| ui-gallery     |      2 | 保留运行时矩阵与公开契约；消除重复执行       |
| desktop        |    201 | 删除 4 个历史源码字符串测试文件，保留 197 个 |

## 删除的测试

以下 4 个文件共 22 条测试、374 行，删除前全部通过。它们读取源码后匹配函数名、JSX、CSS 数值或文案，没有执行相应产品操作。

| 文件                              | 条数 | 删除理由与保留覆盖                                                                                                                                                                                                                                     |
| --------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reported-issues-31-42.test.ts`   |    7 | 混合历史像素、文案和接线断言。保留 `project-order` 的排序/持久化队列、`model-selection` 的模型选择、`encrypted-settings-store` 的头像持久化、`user-profile-integration` 的展示与隐私检查。精确间距和菜单文案不再由本文件锁定。                         |
| `reported-issues-48-54.test.ts`   |    6 | 对 hook 名、定时器写法、文案和箭头有无的匹配。保留 `prompt-history`、`automation-schedule`、`screenshot-regressions` 中完成计划实际延时消失的测试，以及头像展示覆盖；不再锁定空白页原文。                                                              |
| `reported-issues-56-59.test.ts`   |    3 | 将状态变量名、源码出现次数和旧侧栏布局作为验收条件。保留 `boolean-preference-persistence`、`encrypted-settings-store` 的真实持久化与并发写入测试、`project-thread-tree` 键盘/折叠测试，以及 Electron 截图矩阵。精确 JSX 结构和旧创建按钮布局不再锁定。 |
| `reported-issues-104-129.test.ts` |    6 | 锁定内部变量、提示词、README 句子和动画常量。保留 `task-plan` 的增量/失效状态、`codex-conversation-shell` 的模式边界、`permanent-worktree` 的工作区行为、主题 token 契约和侧栏行为测试。移除 README 文案充当工作区策略证明的断言。                     |

这不是完全等价的断言迁移：主动放弃上述历史外观细节和实现写法的单独门禁。组件行为测试与三平台 Electron 验证保留，但不声称它们逐条覆盖被删的每个 CSS 数值。

`renderer-layout`、其他历史问题文件和源码安全契约没有批量删除：其中仍有独立的 IPC、安全接线及产品行为检查；`renderer-layout` 另有用户未提交修改。读取源码不自动等于无用。小型纯函数测试也保留，其边界条件成本很低。

## CI 和命令链

- 删除 `ui-gallery-conformance` 三平台任务。它执行 Node/Vitest、静态 conformance、类型检查和 Vite 构建；相同检查已经包含在 portable CI。代价是这些便携检查不再单独在 macOS/Windows 重复；三平台真实 Electron 验证仍保留。
- Windows native sandbox job 移除单独的 `verify:workspace-dock` 步骤。同一 Windows runner 类型的 visual-convergence job 仍执行该脚本的 `terminal-and-browser` workload。
- CI 实际执行任务由 8 个减到 5 个：portable、Windows native sandbox、macOS arm64/macOS x64/Windows x64 visual-convergence。
- `npm test` 先完整构建，再执行 workspace 测试和产物检查。UI、Gallery 测试各由两轮变一轮；根级展开的 UI 三库及 Gallery 构建各由三轮变一轮。Desktop 自身的构建依赖仍保留，避免破坏独立 workspace 构建。
- 展开修改前后的根级 `test` 脚本，唯一叶子命令集合相同：只减少重复次数，没有丢弃独立的验证器或其负向测试。
- `verify:ci` 移除末尾重复 `build`，完整生产构建已由 `npm test` 执行。Release 复用 `verify:ci`，保留相同的依赖审计开关；版本、打包、签名检查与发布步骤不变。
- `verify:visual-convergence` 移除完整 build 后重复的 Gallery build；删除无人再使用的 `verify:ui-gallery-conformance` 别名。
- 保留 PR Auto Review：它提供独立的人工可读代码审阅，不等价于测试重复。保留所有原生安全、Windows 最终 ZIP/ACL、macOS 双架构打包和发布门禁。

## 验证边界

删除前候选测试：4 文件、22 条全部通过。完整测试的首次沙箱运行因不允许监听 `127.0.0.1` 失败；在允许本地服务与原生进程的环境重跑后通过，没有为此删除 Gateway 测试。

最终本地结果：

- `npm test` 退出码 0：9 个 workspace 合计 296 个文件通过、1 个文件跳过；2686 条 Vitest 测试通过、12 条跳过。另含 pre-push、依赖审计验证器、皮肤/UI 契约负向 fixtures 与产物检查。
- 完整生产 build 已包含在上述测试链并通过。
- `npm run typecheck`、`npm run format:check`、`actionlint .github/workflows/ci.yml .github/workflows/release.yml`、`git diff --check` 通过。
- 本机 Node 为 26.5.0；CI 配置仍为 Node 24。未测量精简前后的完整 CI 耗时，因此不提供未经测量的提速百分比。

本次仅修改本地测试、脚本、workflow 和审计记录；原有附件/UI 业务改动保留。GitHub CI 执行耗时和远端 required checks 配置尚未验证，不能用本地测试宣称三平台 CI 已通过。
