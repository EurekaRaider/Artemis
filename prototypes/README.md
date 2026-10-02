# Artemis UI 原型

本目录是自包含的离线 HTML 原型及其组件、演示数据和校验工具。工作空间入口在 2026-09-28 随 `02bc6e7d` 重新编排；静态原型、冻结比较基线与当前生产 Renderer 分别维护，不能互相充当验收结果。

## 入口与配套文档

| 入口 | 用途 |
| --- | --- |
| [工作空间](artemis-ui.html) | 工作空间、Dock、设置及资源页面的交互演示 |
| [组件展示](components.html) | 方向、主题、对比度及组件行为演示 |
| [组件库文档](ui/README.md) | 共享 CSS/JS、API、迁移映射和离线导出 |
| [编排与自检记录](apple-inspired-ui-validation.md) | 历史布局与检查范围；部分样式契约仍引用它 |
| [能力覆盖矩阵](capability-matrix.md) | 历史源码基线的覆盖账本，不代表当前生产迁移状态 |
| [09-08 界面同步记录](handoff-2026-09-08-production-sync.md) | v144 / Artemis 1.4.63 的设计快照，仅供追溯 |
| [组件库验证记录](ui/implementation-validation.md) | 首轮组件接入的历史证据与限制 |
| [对比度报告](contrast/REPORT.md) | 与原始结果配套的扫描报告 |

两个 HTML 入口共用 `ui/index.css`、`ui/index.js`；布局、演示脚本与数据位于 `showcase/`、`workspace/`。`component-tokens.css` 是兼容入口。分发时保留整个目录，或按组件库文档使用 `tools/inline-assets.cjs` 导出单文件。

## 本地检查

在原型目录按 `package.json` 安装开发依赖并准备 Playwright 浏览器后，在仓库根运行：

```sh
node prototypes/tools/library-check.mjs
node prototypes/tools/workspace-check.mjs
```

默认输出分别位于 `/tmp/artemis-library-check`、`/tmp/artemis-workspace-check`，可用 `ARTEMIS_UI_CHECK_OUTPUT` 指定。检查结果绑定实际运行的源码与浏览器；旧报告不能代替重跑。

对比度检查从本目录执行 `zsh contrast/run-headless.zsh`。它会写入 `contrast/results/`、汇总和配套结果；需要保留已提交证据时，应在临时副本运行。矩阵要求 36 个组合完整存在，并校验组合身份、nonce、内容摘要、像素 fixtures、结构与布局，缺失结果按失败处理。

## 冻结基线与当前状态

仓库根的 `scripts/ui-prototype-manifest.json` 固定 `9556fac` 的 83 个文件、大小和 SHA-256；目录迁移后清单路径指向 `prototypes/`，冻结摘要保持原值。`verify:latest-ui` 与 `verify:prototype-parity` 直接读取当前文件进行比较，不会自动从历史提交恢复文件。

2026-09-29 清理前核对 `b874842f`：清单中 3 个提案文件已不存在，另有 7 个文件摘要与当前树不一致。缺失项为 `proposal-im-settings-redesign.md`、`proposal-ui-library.md`、`zcode-comparison-review.md`；不一致项为本 README、工作空间 HTML、两个检查脚本及三份工作空间脚本/样式。这是既有基线漂移。

09-29 清理仅删除已被后续记录取代的 09-06 交接及旧 README 流水账，保留其余原型源码、36 份对比度结果和冻结清单。10-02 将整个工程移出 `docs/`，同步命令与清单路径，以及组件文档中的安装命令；这些文档修改同样会产生摘要差异。迁移前后组件库的 12 项检查通过，工作区检查在旧断言“9 个工具面板”与页面实际“10 个工具面板”处失败。这不表示两项冻结比较或完整原型检查已经通过。后续须明确选择恢复已批准的冻结设计，或在重新验收后建立新基线，不能仅为通过检查而重写摘要。

## 验收边界

- 原型页面可执行不等于正式 React 组件、生产接线或业务流程已完成。
- 覆盖矩阵、迁移映射及历史检查数量只对应各自基线；更新状态需要生产组件和页面证据。
- Headless 浏览器不替代真实 Electron、人工键盘/读屏、Windows/macOS 包装、签名、原生 PTY、性能和长期运行验收。
- 图片与临时截图按结果 manifest 管理；源码和可复现基线不能作为普通构建垃圾删除。
