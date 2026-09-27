# Office 工作台技术验证与交付状态

验证日期：2026-09-27。分支：`codex/office-workbench`，基于 `7134a85093a5822a0fc930f330efbc249d304021`。

**结论：原生兼容性门槛未通过，本分支交付可复现的技术验证与受保护原型，不能作为完整 Office 增强功能发布。** macOS arm64 的 30 份固定样本中，17 份完成局部修改、渲染、保存和重开；12 份未找到桥接层目前支持的修改目标，1 份修改内容未在重开后保留。所有样本的 `compatibilityAccepted` 仍为 `false`，尚未逐项证明复杂特性和视觉保真。Windows 尚无原生执行证据。

用户体验与协议说明见[功能文档](../../features/office-workbench/README.md)。三个原有 Office 插件共享一个增强能力包；没有新增重复插件。默认目录暂为空，原生覆盖原文件明确禁用，Lite 保持可用并保护导入原件。

## 已实现与边界

| 工作项 | 当前状态 |
| --- | --- |
| 三个插件共用可选 `office-core`，v1/v2 工具路由 | 已实现，插件安装测试验证依赖保留 |
| 签名、平台、版本、摘要、限额、原子安装、离线复用同一验证路径 | 已实现并使用合成签名包测试；未用正式发行包验收 |
| 取消、修复、切换、停用、共享依赖和租约保护 | 已实现并有回归；异常断电目录清理和损坏收据修复待补 |
| Execute 边界、来源保护、版本去重、日志恢复和原件冲突保护 | 已实现并有回归 |
| 原生 C++ UNO 桥、内存文档操作与 PDF 导出 | macOS arm64 真实运行；支持面不足，Windows 未验证 |
| 页面预览、区域批注、旧结果抑制、滚动与缩放 | 真实 Electron 渲染验证通过，数据为合成 IPC |
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

Windows 使用 `office-bridge.exe`。官方输入的挂载、解包和编译步骤记录在手动验证 workflow 中，Windows 脚本仍需在对应 runner 上实测。

首次原生验证曾在 `XComponentLoader` 调用时崩溃。调试确认仅加载 URE 类型库会缺少 Office 接口元数据；桥接进程加入 `URE_MORE_TYPES=…/types/offapi.rdb` 后重新运行得到下述结果。这是启动配置缺陷，不能把旧崩溃记录当作 LibreOffice 不支持所有样本的证据。

本机最新原生报告为 `artifacts/office/probe-types/report.json`，每个通过的样本目录包含 `live.pdf`、`reopened.pdf`、保存副本和 `snapshots.json`。前期失败报告保留作诊断，不作为最终结果。界面报告位于 `artifacts/office/preview/report.json`，截图为同目录 `desktop.png` 与 `compact.png`；这些忽略目录由脚本再生成。

## 样本矩阵

“流程通过”只表示修改标记经过保存副本和重开仍存在；不表示字体、样式、图片、图表、母版、动画、公式缓存等特性已经无损保留。`目标缺失` 指当前桥接层的有限选取能力，不等于上游引擎无法打开文件。

| 样本 | macOS arm64 流程 | 格式保真 | Windows x64 |
| --- | --- | --- | --- |
| `word/2col-header.docx` | 通过 | 未验收 | 未运行 |
| `word/ImageCrop.docx` | 目标缺失 | 未验收 | 未运行 |
| `word/EmbeddedExcelChart.docx` | 目标缺失 | 未验收 | 未运行 |
| `word/TableWithAboveCaptions.docx` | 通过 | 未验收 | 未运行 |
| `word/dml-groupshape-runfonts.docx` | 目标缺失 | 未验收 | 未运行 |
| `word/numbering-font.docx` | 通过 | 未验收 | 未运行 |
| `word/style-inheritance.docx` | 通过 | 未验收 | 未运行 |
| `word/tdf120344_FontTypes.docx` | 通过 | 未验收 | 未运行 |
| `word/table-style-border.docx` | 目标缺失 | 未验收 | 未运行 |
| `word/section_break_numbering.docx` | 通过 | 未验收 | 未运行 |
| `slides/ShapePlusImage.pptx` | 通过 | 未验收 | 未运行 |
| `slides/font-scale.pptx` | 通过 | 未验收 | 未运行 |
| `slides/master-slides.pptx` | 通过 | 未验收 | 未运行 |
| `slides/onemaster-twolayouts.pptx` | 目标缺失 | 未验收 | 未运行 |
| `slides/chart_pt_color_bg1.pptx` | 目标缺失 | 未验收 | 未运行 |
| `slides/connector-shape-animations.pptx` | 目标缺失 | 未验收 | 未运行 |
| `slides/smartart-org-chart.pptx` | 目标缺失 | 未验收 | 未运行 |
| `slides/tableBorderLineStyle.pptx` | 目标缺失 | 未验收 | 未运行 |
| `slides/shape-text-rotate.pptx` | 通过 | 未验收 | 未运行 |
| `slides/customshape-bitmapfill-srcrect.pptx` | 目标缺失 | 未验收 | 未运行 |
| `sheets/fontSize.xlsx` | 目标缺失 | 未验收 | 未运行 |
| `sheets/testDrawCircleInMergeCells.xlsx` | 通过 | 未验收 | 未运行 |
| `sheets/cond_format_formula_listener.xlsx` | 通过 | 未验收 | 未运行 |
| `sheets/tdf151755_stylesLostOnXLSXExport.xlsx` | 通过 | 未验收 | 未运行 |
| `sheets/TableStyleTest.xlsx` | 通过 | 未验收 | 未运行 |
| `sheets/image_hyperlink.xlsx` | 目标缺失 | 未验收 | 未运行 |
| `sheets/hyperlink_formula.xlsx` | 通过 | 未验收 | 未运行 |
| `sheets/PivotTable_CachedDefinitionAndDataInSync.xlsx` | 重开后修改丢失 | 未验收 | 未运行 |
| `sheets/column-style-autofilter.xlsx` | 通过 | 未验收 | 未运行 |
| `sheets/chart_hyperlink.xlsx` | 通过 | 未验收 | 未运行 |

## 计时与体积

以下为通过样本的单次测量，P95 使用 nearest-rank。失败样本不计入这些数值，因此它们不能代表全部文档性能。

| 格式 | 流程通过 | 原生操作确认 P95 | 快照读取 P95 | 原生 PDF 导出 P95 |
| --- | --- | --- | --- | --- |
| Word | 6 / 10 | 18.08 ms | 43.81 ms | 16.70 ms |
| PowerPoint | 4 / 10 | 0.49 ms | 1.10 ms | 29.74 ms |
| Excel | 7 / 10 | 0.92 ms | 2913.46 ms | 737.44 ms |

这些时间没有涵盖完整宿主队列、IPC、PDF.js 解码和屏幕呈现。**不能据此宣布 UI 状态 P95 ≤ 300 ms 或可见内容 P95 ≤ 1 秒达标。** Excel 大索引读取已暴露出明显延迟，需改进目标索引和增量快照后再测。

渲染验证使用真实 PDF.js 和 Electron，通过实际像素变化验证草稿版本 0 → 2，并故意延迟版本 1 返回，确认不会覆盖版本 2。区域批注保留 `sourceVersion: 2`，滚动位置保持，控制台没有错误。窗口尺寸为 1100×900 和 600×850；这不是原生 UNO 到屏幕的端到端基准。

官方上游 macOS DMG 为 298,773,447 字节；这不是最终能力包大小。自有桥接可执行文件约 293 KiB。现有构建的逐文件 gzip 测量仅作诊断，不能替代最终主安装包相对基线的增量。**主包增加 ≤ 10 MiB 和裁剪后能力包大小均待发行产物实测。** 正式能力包尚未移除上游自带的 Python/Java 相关内容，不得直接分发整个上游包并声称符合“不再携带运行时”的约定。

## 回归验证

- Office 协议、Lite 原件保护、安装器、会话及插件依赖，以及原生沙箱使用官方 Node 26.9 验证。新增回归覆盖未接受的原件写入、恢复基线篡改、并行打开去重。
- 本地完整 `npm run verify:ci` 已通过：构建、格式、UI 一致性/边界/性能预算、类型检查及生产依赖审计均完成；各 Vitest 套件共 4040 项通过、14 项按既有条件跳过，其中桌面套件为 2491 项通过、12 项跳过。证据为 `artifacts/office/verify-ci.log`。这不代表远程 CI 或 Windows 原生验收通过。
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
