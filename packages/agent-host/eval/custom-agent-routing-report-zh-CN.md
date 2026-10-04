[English / 简体中文](custom-agent-routing-report.md)

# 自定义子 agent 自动委派评估

D#152 PR5。固定的合成任务集（`eval/custom-agent-routing-cases.ts`）通过真实 `spawn_agent` 工具入口运行；从每次派生生成的持久化 `custom-agent.route` 审计中读取决策。重新生成：

```
ARTEMIS_EVAL_UPDATE=1 npx vitest run test/custom-agent-routing-eval.test.ts
```

## 指标（确定性层）

| 指标 | 结果 |
| --- | --- |
| 用例数 | 15 |
| 正确选择率（should-pick） | 100.0% |
| 误报率（no-delegation） | 0.0% |
| 漏选率（should-pick） | 0.0% |
| 保留歧义 | 100.0% |
| 重复工作（自动接受的实例） | 0 |
| 任务成功率（达到标注结果） | 100.0% |
| 模型 token | 0（词法层不调用模型） |
| 成本 | 0 |
| 实际耗时 | 记录在控制台输出中，不在本报告中 |

## 门禁（全部必须通过）

| 门禁 | 结果 |
| --- | --- |
| P1 reference-required 修正命中正确候选 | PASS |
| 无自动接受（重复工作为 0） | PASS |
| 显式 ID 不被触发词覆盖 | PASS |
| 每个标注结果均达成（100% 确定性门禁） | PASS |

## 各用例结果

| 用例 | 标签 | 决策 | 候选 | 实例数 | 符合预期 |
| --- | --- | --- | --- | --- | --- |
| C01 | should-not-delegate | free-role | — | 1 | 是 |
| C02 | no-match | free-role | — | 1 | 是 |
| C03 | should-pick | advisory | eval-security | 1 | 是 |
| C04 | should-pick | advisory | eval-security | 1 | 是 |
| C05 | ambiguous | advisory | eval-security, eval-compliance | 1 | 是 |
| C06 | ambiguous | advisory | eval-security, eval-compliance | 1 | 是 |
| C07 | boundary-safety | free-role | — | 1 | 是 |
| C08 | normalization | advisory | eval-reviewer | 1 | 是 |
| C09 | normalization | reference-required | eval-reviewer | 0 | 是 |
| C10 | manual-only-control | free-role | — | 1 | 是 |
| C11 | manual-only-control | free-role | — | 1 | 是 |
| C12 | should-not-delegate | free-role | — | 1 | 是 |
| C13 | should-pick | advisory | eval-docs | 1 | 是 |
| C14 | should-pick | advisory | eval-docs | 1 | 是 |
| C15 | explicit-override | accepted | — | 1 | 是 |

## 基线（关闭自动路由）

自动目录为空时，每个用例都退化为自由角色：should-pick 的正确选择率 0.0%、漏选率 100.0%，误报率 0.0%，重复工作 0。此基线由分析推导，并由 `test/runtime/custom-agent-routing.test.ts` 中的空目录对照固定。

## 概率性（模型语义）比较

P2 语义选择属于模型行为，不承诺 100% 一致。真实模型运行步骤：在桌面设置中固定 provider/model/thinking，把每个 should-pick 和 ambiguous 任务作为真实轮次运行，再从 `custom-agent.route` 审计读取所选与候选 ID。在固定配置下，将正确选择率、误报率、漏选率与上述基线比较，从轮次用量记录 token 和成本。本报告有意不包含真实模型数据。
