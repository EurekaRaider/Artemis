# Office 工作台技术验证与交付状态

验证日期：2026-09-27。分支：`codex/office-workbench`，基于 `7134a85093a5822a0fc930f330efbc249d304021`。

**结论：原生兼容性门槛未通过，本分支交付可复现的技术验证与受保护原型，不能作为完整 Office 增强功能发布。** macOS arm64 与 Windows x64 均已真实执行同一批 30 份固定样本，结果相同：17 份完成局部修改、渲染、保存和重开；12 份未找到桥接层目前支持的修改目标，1 份修改内容未在重开后保留。所有样本的 `compatibilityAccepted` 仍为 `false`，尚未逐项证明复杂特性和视觉保真。Windows 证据来自 `windows-2025` 托管 VM，不能据此声称 Windows 10/11 客户端及最终发行包已经验收。

用户体验与协议说明见[功能文档](../../features/office-workbench/README.md)。三个原有 Office 插件共享一个增强能力包；没有新增重复插件。默认目录暂为空，原生覆盖原文件明确禁用，Lite 保持可用并保护导入原件。

## 已实现与边界

| 工作项 | 当前状态 |
| --- | --- |
| 三个插件共用可选 `office-core`，v1/v2 工具路由 | 已实现，插件安装测试验证依赖保留 |
| 签名、平台、版本、摘要、限额、原子安装、离线复用同一验证路径 | 已实现并使用合成签名包测试；未用正式发行包验收 |
| 取消、修复、切换、停用、共享依赖和租约保护 | 已实现并有回归；异常断电目录清理和损坏收据修复待补 |
| Execute 边界、来源保护、版本去重、日志恢复和原件冲突保护 | 已实现并有回归 |
| 原生 C++ UNO 桥、内存文档操作与 PDF 导出 | macOS arm64 与 Windows x64 均真实运行；各 17/30 流程通过，支持面不足 |
| 页面预览、区域批注、旧结果抑制、滚动与缩放 | 真实 Electron 渲染验证通过，数据为合成 IPC |
| Windows 普通用户、用户数据目录及中文工作区路径 | 已用实际非管理员令牌运行，30 份样本结果与管理员一致；工程运行时证据，不是正式包验收 |
| 全局事件缺口恢复后的修改跟随 | 面板可读权威快照，全局投影衔接尚待完成 |
| 外部文件保存后刷新 | 目前保留草稿并报冲突；自动重载待完成 |
| 幻灯片缩略图、工作表与页面映射、完整语言覆盖 | 待完成；当前页面画布及中英文入口不能代替完整验收 |
| 主程序 CD 只验证并复用已有运行时资产 | 已接入只读脚本；空目录不启用增强能力 |
| 轻量商店目录迁移和独立运行时发布 CD | 未发布、未完成正式发布链路 |
| Developer ID、公证 Accepted、staple、Windows 签名及最终 ACL | 未验收 |
| 真实下载路径首次安装、离线启动、升级/回退 | 未验收 |

## 固定输入与复现

引擎是官方 LibreOffice 26.8.0，macOS build ID 为 `bce0998afefdbc355585ca324285661a2170ba77`。来源与 SHA-256 固定在 `scripts/office/sources.json`，不是系统中任意已安装的 Office。验证使用 SDK 编译自有 C++ UNO 辅助程序；没有使用 Codex 私有 SDK。

样本取自 `LibreOffice/core` 的固定提交 `e155df48174bf3e64426fb1b912b9c15fa375704`，每类 10 份，共 1,100,286 字节。`scripts/office/corpus.json` 记录原路径、Git blob SHA-1、大小和固定 URL；遵循该仓库的许可。样本下载到忽略目录，不把二进制测试文件复制进源码树。

从仓库根目录运行：

```sh
node scripts/office/fetch-sources.mjs
node scripts/office/fetch-corpus.mjs
node scripts/office/build-bridge.mjs --sdk /path/to/SDK --office /path/to/soffice --json artifacts/office/sources/json.hpp --out artifacts/office/build
node scripts/office/probe-native.mjs --office /path/to/soffice --bridge artifacts/office/build/office-bridge
node scripts/office/verify-preview.mjs
```

Windows 使用 `office-bridge.exe`。官方输入的挂载、解包和编译步骤记录在 `.github/workflows/office-native-validation.yml` 中；该流程支持手动执行，并在当前功能分支的相关文件推送后自动运行 Windows 验收。Windows 使用官方 MSI 管理解包、自有桥接程序和固定 SDK，不依赖 runner 预装 Microsoft Office。

首次原生验证曾在 `XComponentLoader` 调用时崩溃。调试确认仅加载 URE 类型库会缺少 Office 接口元数据；桥接进程加入 `URE_MORE_TYPES=…/types/offapi.rdb` 后重新运行得到下述结果。这是启动配置缺陷，不能把旧崩溃记录当作 LibreOffice 不支持所有样本的证据。

本机最新原生报告为 `artifacts/office/probe-types/report.json`，每个通过的样本目录包含 `live.pdf`、`reopened.pdf`、保存副本和 `snapshots.json`。前期失败报告保留作诊断，不作为最终结果。界面报告位于 `artifacts/office/preview/report.json`，截图为同目录 `desktop.png` 与 `compact.png`；这些忽略目录由脚本再生成。

## Windows 实测证据

[最终 Windows CI](https://github.com/EurekaRaider/Artemis/actions/runs/36312571414) 验证代码提交 `28fe16f24d5425b677987dc322daa50511120fed`，结论为 **failure**：管理员和普通用户的原生样本门槛均未通过，不应将该运行描述为验收全绿。Windows 上的 4 个针对性测试文件、35 项协议/策略/恢复/安装测试，以及真实 Electron 预览脚本均通过。预览确认内容已重绘、旧版本未覆盖新版本、批注绑定版本 2、滚动位置保留，错误列表为空。

环境为 GitHub 托管 `windows-2025` x64，镜像 `win25-vs2026 / 20260922.246.2`，OS 版本 `10.0.26100.0`，Node `26.9.0`，LibreOffice `26.8.0.3`。引擎、SDK、头文件及样本均通过固定摘要校验，辅助程序在该 Windows VM 上由 MSVC 原生编译。

普通用户测试创建了临时本地账户，核对 `administrator: false`，使用该账户自己的环境和用户配置；运行时位于 `%LOCALAPPDATA%/Artemis/capability-packs/office-core/1.0.0/payload`，工作区位于 `%LOCALAPPDATA%/Artemis/验证文档`。其报告覆盖完整 30 份样本，仍为 Word 6/10、PowerPoint 4/10、Excel 7/10；失败样本及原因与管理员和 macOS 完全相同。安装目录、引擎和辅助程序的 ACL 均记录在证据中，写权限仅授予该测试用户、SYSTEM 和 Administrators。

官方 `soffice.exe` 的 Authenticode 为 `Valid`，发布者为 The Document Foundation；自有 `office-bridge.exe` 为 `NotSigned`。测试直接复制工程运行时到用户目录，未经过正式签名包的真实下载、安装和升级链路，故 `finalCapabilityPackage` 与 `releaseAccepted` 保持 `false`。管理员阶段的 `windows.json` 先于普通用户复测生成，其中 `ordinaryUserValidated: false` 不能替代后续独立的普通用户报告。

GitHub Artifact 存储配额已满，上传未成功；workflow 允许上传失败后继续回收证据。日志通道已恢复 108 个文件，共 4,544,031 字节，逐文件校验 SHA-256。四份约 20.7 MB 的大表格 PDF 超出日志单文件 16 MiB 限额，仅保留大小和摘要，不能宣称已下载或完整视觉验收这些 PDF。回收入口：

```sh
gh run view 36312571414 --repo EurekaRaider/Artemis --log > artifacts/office/windows-ci-36312571414-full.log
node scripts/office/collect-ci-evidence.mjs artifacts/office/windows-ci-36312571414-full.log artifacts/office/windows-ci-36312571414
```

输出目录必须尚不存在。主要证据相对于该目录为：

| 证据 | 路径 |
| --- | --- |
| 管理员原生报告 | `probe/report.json` |
| 普通用户身份、实际目录及 ACL | `ordinary-user/identity.json` |
| 普通用户原生报告 | `ordinary-user/native/report.json` |
| OS、构建提交、原生签名与摘要 | `evidence/windows.json` |
| 预览行为与 Windows 截图 | `preview/report.json`、`preview/desktop.png`、`preview/compact.png` |
| 日志回收数量及大文件遗漏清单 | `evidence/log-transport.json` |

已查看两张 Windows 原始截图，实际像素尺寸为 1008×655 与 584×785；这些尺寸不同于脚本请求的外框尺寸。普通用户导出的 `word/2col-header.docx`、`slides/ShapePlusImage.pptx`、`sheets/TableStyleTest.xlsx` 重开后 PDF 各一页，已用 Poppler 渲染并逐页检查，可见修改标记及对应页眉页脚、图形和表格。Excel 新增长表头在固定列宽下未完整显示。该抽查证明真实内容可渲染，不能替代与原件的复杂特性和像素保真比较；完整宿主布局也不由合成面板截图验收。

## 样本矩阵

“流程通过”只表示修改标记经过保存副本和重开仍存在；不表示字体、样式、图片、图表、母版、动画、公式缓存等特性已经无损保留。`目标缺失` 指当前桥接层的有限选取能力，不等于上游引擎无法打开文件。

| 样本 | macOS arm64 流程 | 格式保真 | Windows x64 |
| --- | --- | --- | --- |
| `word/2col-header.docx` | 通过 | 未验收 | 通过 |
| `word/ImageCrop.docx` | 目标缺失 | 未验收 | 目标缺失 |
| `word/EmbeddedExcelChart.docx` | 目标缺失 | 未验收 | 目标缺失 |
| `word/TableWithAboveCaptions.docx` | 通过 | 未验收 | 通过 |
| `word/dml-groupshape-runfonts.docx` | 目标缺失 | 未验收 | 目标缺失 |
| `word/numbering-font.docx` | 通过 | 未验收 | 通过 |
| `word/style-inheritance.docx` | 通过 | 未验收 | 通过 |
| `word/tdf120344_FontTypes.docx` | 通过 | 未验收 | 通过 |
| `word/table-style-border.docx` | 目标缺失 | 未验收 | 目标缺失 |
| `word/section_break_numbering.docx` | 通过 | 未验收 | 通过 |
| `slides/ShapePlusImage.pptx` | 通过 | 未验收 | 通过 |
| `slides/font-scale.pptx` | 通过 | 未验收 | 通过 |
| `slides/master-slides.pptx` | 通过 | 未验收 | 通过 |
| `slides/onemaster-twolayouts.pptx` | 目标缺失 | 未验收 | 目标缺失 |
| `slides/chart_pt_color_bg1.pptx` | 目标缺失 | 未验收 | 目标缺失 |
| `slides/connector-shape-animations.pptx` | 目标缺失 | 未验收 | 目标缺失 |
| `slides/smartart-org-chart.pptx` | 目标缺失 | 未验收 | 目标缺失 |
| `slides/tableBorderLineStyle.pptx` | 目标缺失 | 未验收 | 目标缺失 |
| `slides/shape-text-rotate.pptx` | 通过 | 未验收 | 通过 |
| `slides/customshape-bitmapfill-srcrect.pptx` | 目标缺失 | 未验收 | 目标缺失 |
| `sheets/fontSize.xlsx` | 目标缺失 | 未验收 | 目标缺失 |
| `sheets/testDrawCircleInMergeCells.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/cond_format_formula_listener.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/tdf151755_stylesLostOnXLSXExport.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/TableStyleTest.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/image_hyperlink.xlsx` | 目标缺失 | 未验收 | 目标缺失 |
| `sheets/hyperlink_formula.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/PivotTable_CachedDefinitionAndDataInSync.xlsx` | 重开后修改丢失 | 未验收 | 重开后修改丢失 |
| `sheets/column-style-autofilter.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/chart_hyperlink.xlsx` | 通过 | 未验收 | 通过 |

## 计时与体积

以下为通过样本的单次测量，P95 使用 nearest-rank。失败样本不计入这些数值，因此它们不能代表全部文档性能。现有脚本的 `snapshotMs` 从修改操作开始计时，包含操作确认，表中明确记为“操作加快照”，不是纯快照耗时。

| 平台 / 账户 | 格式 | 流程通过 | 原生操作确认 P95 | 操作加快照 P95 | 原生 PDF 导出 P95 |
| --- | --- | --- | --- | --- | --- |
| macOS arm64 | Word | 6 / 10 | 18.08 ms | 43.81 ms | 16.70 ms |
| macOS arm64 | PowerPoint | 4 / 10 | 0.49 ms | 1.10 ms | 29.74 ms |
| macOS arm64 | Excel | 7 / 10 | 0.92 ms | 2913.46 ms | 737.44 ms |
| Windows 管理员 | Word | 6 / 10 | 77.14 ms | 280.63 ms | 62.65 ms |
| Windows 管理员 | PowerPoint | 4 / 10 | 1.90 ms | 5.86 ms | 67.94 ms |
| Windows 管理员 | Excel | 7 / 10 | 2.69 ms | 16633.97 ms | 3229.05 ms |
| Windows 普通用户 | Word | 6 / 10 | 74.91 ms | 169.93 ms | 136.14 ms |
| Windows 普通用户 | PowerPoint | 4 / 10 | 1.86 ms | 5.68 ms | 356.55 ms |
| Windows 普通用户 | Excel | 7 / 10 | 7.00 ms | 19004.47 ms | 8443.26 ms |

这些时间没有涵盖完整宿主队列、IPC、PDF.js 解码和屏幕呈现。**不能据此宣布 UI 状态 P95 ≤ 300 ms 或可见内容 P95 ≤ 1 秒达标。** Windows 普通用户下，大 Excel 样本操作加快照约 19.0 秒、原生 PDF 导出约 8.44 秒，已明显超出即时跟随体验所能接受的范围。需改进目标索引、增量快照和渲染路径后再测。

渲染验证使用真实 PDF.js 和 Electron，通过实际像素变化验证草稿版本 0 → 2，并故意延迟版本 1 返回，确认不会覆盖版本 2。区域批注保留 `sourceVersion: 2`，滚动位置保持，控制台没有错误。脚本请求窗口尺寸为 1100×900 和 600×850；实际 Windows 截图尺寸见上节。这不是原生 UNO 到屏幕的端到端基准。

官方上游 macOS DMG 为 298,773,447 字节；这不是最终能力包大小。自有桥接可执行文件约 293 KiB。现有构建的逐文件 gzip 测量仅作诊断，不能替代最终主安装包相对基线的增量。**主包增加 ≤ 10 MiB 和裁剪后能力包大小均待发行产物实测。** 正式能力包尚未移除上游自带的 Python/Java 相关内容，不得直接分发整个上游包并声称符合“不再携带运行时”的约定。

## 回归验证

- Office 协议、Lite 原件保护、安装器、会话及插件依赖，以及原生沙箱使用官方 Node 26.9 验证。新增回归覆盖未接受的原件写入、恢复基线篡改、并行打开去重。
- 本地完整 `npm run verify:ci` 已通过：构建、格式、UI 一致性/边界/性能预算、类型检查及生产依赖审计均完成；各 Vitest 套件共 4040 项通过、14 项按既有条件跳过，其中桌面套件为 2491 项通过、12 项跳过。证据为 `artifacts/office/verify-ci.log`。这些 portable 检查不能抵消 Windows 原生样本门槛的失败。
- Windows CI 的实际编译、35 项回归、Electron 预览、管理员和普通用户的 30 份原生样本均已执行；结果、限制和原始证据入口见上节。下载重试另外验证了续传、服务器忽略 Range 后重下、完整内容后的断线及缓存摘要；日志回收验证了往返摘要、无效路径/损坏内容拒绝及超大 PDF 不阻断报告。
- Homebrew Node 的原生动态库问题和未关闭 Node WebStorage 的单独测试结果不能替代 CI 环境结果。最终运行使用官方 Node 26.9 及验证脚本的 `--no-experimental-webstorage` 设置。
- 原有主分支的热力图 tooltip 样式与 CSS 契约存在三处差异。本分支只将契约更新到已存在的 `width: max-content`、`white-space: normal`、`overflow-wrap: anywhere`，没有改变该 UI 或提高性能预算。
- 生产 catalog 为空。安装测试使用独立临时目录与合成签名包，没有向用户数据安装未验收的引擎。

## 发布前流程

此节是正式发布仍需实现和验收的约定，不表示已经有可用的签名发行包。

1. 补齐桥接层对象/表格/组对象选取与往返保留；在 macOS arm64 和 Windows x64 上对固定样本逐项核对特性及像素，并测量真实 UI 延迟。未通过的格式明确阻止原件覆盖。
2. 按最小 Writer/Calc/Impress 运行闭包制作能力包，移除第二套 Node、Chromium、Python 和 JRE；验证字体缺失、中文路径、文件占用、引擎崩溃与干净系统运行。
3. macOS 组织成 `ArtemisOfficeRuntime.app`，依次完成嵌套代码和外层 Developer ID 签名、Hardened Runtime、公证 Accepted、对 app staple、离线验证，再生成最终 ZIP。Windows 检查有效签名、最终安装目录 ACL 和真实执行。
4. 以最终字节生成逐文件清单、归档摘要及 Ed25519 签名。把可信公钥和经双平台验收的清单加入宿主目录；不能让离线包自行信任其公钥。
5. 创建独立 `office-runtime-vX.Y.Z` Release，明确 `make_latest: false`。发布前后读取 `/releases/latest`，证明主程序更新目标没有变化；已发布同版本内容必须一致，禁止覆盖。
6. 运行时 CD 按源文件、依赖和产物配置版本触发。保存构建摘要、签名产物、公证 submission ID 与成功回执、staple 后最终归档摘要及上传资产 ID。失败重跑先校验并复用完成阶段，不能重新签名或重新打包已发布产物。
7. 轻量插件与 Skills 放入 `EurekaRaider/ArtemisRelease:main` 的商店目录；大型运行时只在独立 Release 中。普通主程序 CD 继续只读验证固定版本资产，不重新生成能力包。
8. 从真实下载和安装路径验收首次下载、中断/取消重试、缓存复用、离线导入、升级、回退和共享卸载后，才开放功能及原件写入。

在上述原生门槛通过前，不合并为已验收功能，不公开发布能力包，不以简化预览或协议测试替代平台证据。
