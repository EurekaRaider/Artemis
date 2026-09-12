# docs/ 文档放置与管理规则

本文件约束 `docs/` 下所有文档与资产的放置、命名与清理。根级 [AGENTS.md](../AGENTS.md) 管工程纪律,本文件只管文档秩序;两者冲突时以根级为准。目录导读见 [README.md](README.md)。

## 目录结构

```
docs/
├── AGENTS.md            # 本规则
├── README.md            # 导读索引:每份文档一行说明,新人/新会话从这里看全貌
├── architecture.md      # 长青总览(留根级,最高频入口)
├── install.md           # 长青总览:安装说明
├── features/            # 功能域:描述系统已有/将有的能力(稳定,不过期)
│   ├── im-gateway/      # 下一级一律为 <domain>/ 子文件夹,单文档特性用 README.md 承载
│   └── custom-subagents/  # 域内多文档时 README 作索引,配 plan / implementation-status 等
├── projects/            # 专项:有生命周期,做完即清(提案、调研、验收矩阵)
│   └── design-mode-proposal/
├── records/             # 台账:持续追加维护的记录(审计、账本、视觉规范)
├── ui-prototype/        # 自包含静态原型(内部自治,见下)
├── images/              # 图片资产;界面截图在 images/screenshots/
├── diagrams/            # 架构图 HTML 源(导出物进 images/)
└── scripts/             # 文档配套脚本(capture-readme 等)
```

## 新文档放哪:判定口径

按顺序自问,命中即止:

1. **人人都要看的总览吗?**(架构、安装)→ 根级。仅此两类,新增须谨慎。
2. **有开始和结束、做完会归档吗?**(提案、调研、专项、验收矩阵)→ `projects/<topic>/` 或 `projects/<topic>.md`。
3. **是持续追加的记录而非一次性说明吗?**(账本、审计、规范)→ `records/`。
4. **描述系统某个能力吗?** → `features/<domain>/README.md`(`features/` 下一级**一律为子文件夹,单文档特性也建目录**,内容直接写进 README.md);域内文档增多时 README 转为索引,新增 `plan.md` / `implementation-status.md` 等命名文档(范例:`features/custom-subagents/`)。

兜底:**先问"会不会过期"**——会过期的进 `projects/`,不会的按内容归 `features/` 或 `records/`。

## 各区细则

- **projects/**:提案落地后,实现文档迁入对应 `features/` 域,阶段性提案稿/调研稿删除(git 历史即归档);目录内只剩历史结论时整目录清理。handoff 类命名 `handoff-YYYY-MM-DD-<topic>.md`,只保现行版,README 链接指向最新。
- **records/**:维护"最新状态"语义;旧版本数据被新版取代时直接更新原文件,不另存副本。
- **ui-prototype/**:自包含(自带 README、工具、契约与资产),**外部文档一律不得放入**;清理或改动其内部结构前,先读其 README 并跑 `docs/ui-prototype/tools/library-check.mjs`;README 显式引用的文件不可删。
- **资产**:图片 → `images/`(README 引用)或 `images/screenshots/`(界面截图,随 manifest 清单管理);图源 → `diagrams/`,文档只引用导出物;脚本 → `scripts/`,注释写明用途与运行方式。

## 命名与语言

- 文件与目录名:**英文 kebab-case**;日期段 `YYYY-MM-DD`。
- 内容语言:中文;标题层级从 `#` 开始;跨文档引用一律相对路径链接,并在 [README.md](README.md) 登记一行。

## 过期判定与清理流程

删除任何文档前,依次确认:

1. **引用检查**:`grep -rn "<文件名>" . --exclude-dir=node_modules`,覆盖 README / 脚本 / CI / 测试 / 清单(manifest)。
2. **被取代关系**:内容是否已被更新文档或实现取代(提案已落地、handoff 已过时、台账已并入)。
3. **最后活动**:`git log -1 --format='%ad' -- <file>`;长期无活动且无引用,进入清理候选。
4. **删除方式**:一律 `git rm`;`.DS_Store` 等本地产物不入库,发现即删。

## 禁止事项

- **不动未跟踪文件**:`git status` 里的 untracked 文档(如并行会话的调研稿)属于进行中的工作,清理时跳过;为保其内链有效仅允许改路径引用,不改内容。
- 不在 `docs/` 放临时笔记、构建产物或与文档无关的数据;它们属于 `/tmp` 或 `.gitignore` 范围。
- 不为"以后可能有用"囤积过时文档:git 历史就是归档,过期即删。
- 根级不新增第四类长青文档、不在分类目录外新建平级散文件。

## 变更本规则

调整本文件须与目录现状同步:规则改了,先按新规则整一遍目录再提交;目录出现新模式,先补规则再落地文件。
