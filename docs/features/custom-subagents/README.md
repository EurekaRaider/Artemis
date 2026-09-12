# 自定义子智能体（含项目关联）实施计划

本目录承载 [Discussion #152](https://github.com/EurekaRaider/Artemis/discussions/152) 的已通过实现契约与后续实施产物。

## 状态

**PR1–PR5 已交付**（提交与验证见 [implementation-status.md](implementation-status.md)）。复审通过结论：（2026-09-10，[复审结论](https://github.com/EurekaRaider/Artemis/discussions/152#discussioncomment-18386387)）

方案基准提交：`fb6e75c3`（origin/main）。实施前确认目标分支并 rebase——origin/main 已推进到 `ca4f460` 之后。

## 文件

| 文件                                                 | 内容                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [plan.md](plan.md)                                   | 最终《完整执行方案》全文：范围取舍、数据契约、权限与指令契约、冻结/失效/重试、结构化 @ 与调用幂等、P0–P3 路由、事件与界面、PR 拆分、验收矩阵、回退与完成标准 |
| [implementation-status.md](implementation-status.md) | PR1–PR5 交付提交与验证记录、已知限制、回退演练、PR6 发布验收证据范围                                                                                         |

## PR 拆分速览（详见 plan.md 第九节）

| PR                 | 内容                                                                                           | 出口要点                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| PR1 协议与策略契约 | 定义/引用/快照类型、错误码、预算扣减边界、调用记录状态机、权限与生命周期规范；先写策略回归测试 | 指认扣减位置、明确幂等缺口补建契约          |
| PR2 存储与项目目录 | 事务迁移、CRUD、revision 冲突、projectId 过滤、撤销链路                                        | 旧库升级、删除最后关联、worktree 均符合契约 |
| PR3 运行时定义执行 | 统一接受与幂等入口、模型解析、工具交集、快照、重试、事件 reducer                               | 无 UI 端到端协议验证；旧 spawn 兼容         |
| PR4 管理与手动闭环 | 设置表单、结构化 @、幂等派发、实例展示与工具预览                                               | 创建→关联→选择→执行→汇总→重试闭环           |
| PR5 自动委派       | 自动目录、P1 纠偏/P2 引导/P3 记录、评估用例                                                    | 三个发布阻断测试通过方可开启自动路由        |
| PR6 发布验收       | 文档/原型同步、真实桌面测试、平台包验证                                                        | 证据对应最终提交，回退演练完成              |

## 审核记录

- [提案原文与 P0–P3 补充](https://github.com/EurekaRaider/Artemis/discussions/152)（huangwp）
- [首轮审核：8 条必须修订](https://github.com/EurekaRaider/Artemis/discussions/152)（EurekaRaider，2026-09-10 07:23）
- [审核意见：三项待补点](https://github.com/EurekaRaider/Artemis/discussions/152#discussioncomment-18386128)（huangwp，2026-09-10 12:26）
- [复审通过结论](https://github.com/EurekaRaider/Artemis/discussions/152#discussioncomment-18386387)（huangwp，2026-09-10 12:45）
