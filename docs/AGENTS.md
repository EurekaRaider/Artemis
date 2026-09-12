# docs/ 文档放置与管理规则

本文件约束 `docs/` 下所有文档与资产的放置、命名与清理。根级 [AGENTS.md](../AGENTS.md) 管工程纪律,本文件只管文档秩序;两者冲突时以根级为准。

## 目录结构总览

```
docs/
├── AGENTS.md                      # 本规则文件
├── architecture.md                # 长青:系统架构总览
├── README_INSTALL.md              # 长青:安装说明
├── <domain>.md                    # 功能域单文档(im-gateway / im-security /
│                                  #   plugin-marketplaces / attachment-context …)
├── <topic>-{ledger,matrix,audit}.md  # 台账类(skin-compatibility-ledger /
│                                  #   p0-acceptance-matrix / management-appearance-audit)
├── <topic>.md                     # 进行中专项(design-p0 / design-workflow)
├── custom-subagents/              # 功能域子目录范例:README 索引 + plan + implementation-status
├── design-mode-proposal/          # 调研/提案目录
├── ui-prototype/                  # 自包含静态原型(内部自治,见下)
├── images/                        # README 与文档引用的图片;界面截图在 images/screenshots/
├── diagrams/                      # 架构图 HTML 源(导出 PNG/SVG 进 images/)
└── scripts/                       # 文档配套脚本(capture-readme 等)
```

## 放置规则

### 1. 根级只放三类

- **长青总览**:架构、安装等跨功能、生命周期长的文档。
- **功能域单文档**:一个功能域一份 `im-gateway.md` 式文档;**该域文档达到 3 份及以上时建子目录**,以 `README.md` 作索引,配 `plan.md` / `implementation-status.md` 等(范例:`custom-subagents/`)。
- **台账 / 审计**:皮肤兼容账本、验收矩阵、外观审计等持续维护的记录。

### 2. 专项、提案、调研放子目录

- 命名 `<topic>-proposal/` 或并入所属功能域目录;目录内文档数没有下限。
- **提案落地后即过期**:实现文档(含 implementation-status)保留在功能域目录,阶段性提案稿、调研对比稿在下轮清理时删除;有长期参考价值的可在功能域 README 留一行结论与链接。

### 3. 交接文档(handoff)带日期且只保现行

- 命名 `handoff-YYYY-MM-DD-<topic>.md`,放在所属目录(如 `ui-prototype/`)。
- 被新交接取代的旧文件,其存在仅由 README 的一句话注明("冲突以最新交接为准");**下轮清理删除旧稿**,README 链接始终指向现行版。

### 4. `ui-prototype/` 内部自治

- 该目录自包含(自带 README、工具、契约与资产),有自己的演进节奏;**外部文档一律不得放入**。
- 清理或改动其内部结构前,先读其 README 并跑 `docs/ui-prototype/tools/library-check.mjs`;README 显式引用的文件(如现行 handoff)不可删。

### 5. 资产归位

- 图片 → `images/`(README 引用)或 `images/screenshots/`(界面截图,随 `environment-manifest.json` 等清单管理)。
- 图源(HTML/drawio)→ `diagrams/`,导出物进 `images/`,文档只引用导出物。
- 配套脚本 → `scripts/`,脚本内注释写明用途与运行方式。

### 6. 命名与语言

- 文件与目录名:**英文 kebab-case**(`im-gateway.md`、`custom-subagents/`);日期段用 `YYYY-MM-DD`。
- 内容语言:中文;标题层级从 `#` 开始,一档一主题;引用其他文档用相对路径链接。

## 过期判定与清理流程

删除任何文档前,依次确认:

1. **引用检查**:`grep -rn "<文件名>" . --exclude-dir=node_modules` 确认无 README / 脚本 / CI / 测试引用;`images/screenshots/` 清单引用也要查。
2. **被取代关系**:内容是否已被更新文档或实现取代(提案已落地、handoff 已过时、台账已并入新版)。
3. **最后活动**:`git log -1 --format='%ad' -- <file>`;一个月以上无活动且无引用,进入清理候选。
4. **删除方式**:一律 `git rm`(保留历史可回溯);`.DS_Store` 等本地产物不入库,发现即删。

## 禁止事项

- **不动未跟踪文件**:`git status` 里的 untracked 文档(如并行会话的调研稿)属于进行中的工作,清理时跳过,绝不删除或改写。
- 不在 `docs/` 放临时笔记、构建产物或与文档无关的数据;它们属于 `/tmp` 或 `.gitignore` 范围。
- 不为"以后可能有用"囤积过时文档:git 历史就是归档,过期即删。

## 变更本规则

调整本文件须与目录现状同步:规则改了,先按新规则整一遍目录再提交;目录出现新模式,先补规则再落地文件。
