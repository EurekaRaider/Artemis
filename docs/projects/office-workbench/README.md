# Office 工作台技术验证与交付状态

验证日期：2026-09-28。分支：`codex/office-workbench`，基于 `7134a85093a5822a0fc930f330efbc249d304021`。

**当前状态：本轮 Windows 未签名候选包验收已完成。macOS arm64、托管 Windows 普通用户、Windows 11 非管理员服务账户均为 30/30 原生样本流程通过；两个 Windows 环境各 44 项回归与 12 项安装生命周期检查均通过。** macOS 最新报告为 `artifacts/office/probe-macos-startup/report.json`。这些结果不等于复杂格式保真或正式发行验收；`compatibilityAccepted` 和 `releaseAccepted` 仍为 `false`。

按用户于 2026-09-27 确认的范围，macOS 仅验收 arm64；macOS x64 不属于本次验收，也不作为本次交付待办。

本轮补齐 Writer 表格/文本框、Impress 组内对象/表格/图片位移/空页插入及受限 SmartArt 文字往返。透视表改为编辑数值源单元格，并验证结果区域写入会被拒绝。Calc 使用批量 UNO 快照读取。面板补齐事件缺口恢复、干净文档外部保存重载、幻灯片缩略图、书签工作表定位及 14 种语言。

Windows Authenticode 证书不是验收前提。候选包使用明确允许未签名桥接程序的 Ed25519 签名清单，逐文件 SHA-256 保持必需；上游程序按其实际签名指纹校验。真实普通用户安装、生命周期、最终 ACL 与完整样本复验由候选包工作流记录；Windows 候选包仍未公开发布。

用户体验与协议说明见[功能文档](../../features/office-workbench/README.md)。三个原有 Office 插件共享一个增强能力包；没有新增重复插件。生产目录已包含 macOS arm64 的正式签名清单，原生覆盖原文件仍明确禁用，Lite 保持可用并保护导入原件。

## 2026-09-28 独立能力包发布

按用户授权，已发布 [Office Runtime 1.0.0](https://github.com/EurekaRaider/ArtemisRelease/releases/tag/office-runtime-v1.0.0)，本次资产仅含 macOS arm64。ZIP 为 245,361,497 字节，SHA-256 为 `4da139734269190856697edb5219a0b0e5283734a6c4d57262678f28259045ad`。Apple 公证 ID 为 `8793c31d-3930-4b43-a87c-beb86b1ed829`，签名、公证票据和 Gatekeeper 复验通过。

七项资产已逐项读回摘要与大小；发布未替换主程序 `v1.6.8` 的 Latest。官方安装/更新目录以提交 `c953067453221ceea6cafa13d7ae82d93998d4fd` 发布到 ArtemisRelease，三个原有插件继续通过同一个可选 `office-core` 依赖关联宿主管理器。发布私钥只保留在 Artemis 仓库 Actions Secret，公开目录仅含公钥。

使用全新隔离配置从公开 GitHub 地址完成真实在线安装（245,361,497 字节），安装器的正式签名、逐文件摘要及原生信任校验全部通过；随后从公开更新源检查得到当前 1.0.0 已是最新。匿名读取的更新目录与随宿主配置的文件逐字节相同。另用签名测试源验证发现新版、显式更新、检查失败和禁止降级；相关 92 项回归及桌面 typecheck 通过。浅色、深色和 390/800/1280 宽度的管理界面已实际渲染检查。

本次公开运行时不代表复杂格式保真验收通过，历史报告中的 `releaseAccepted: false` 保持原样；原件覆盖继续禁用。正式版 v1.6.8 尚无 Office 工作台入口，用户需使用本分支构建或后续正式客户端。独立本地测试宿主已接入公开源，并保留此前离线测试包的公钥以兼容已有手动安装。

## 已实现与边界

| 工作项 | 当前状态 |
| --- | --- |
| 三个插件共用可选 `office-core`，v1/v2 工具路由 | 已实现，插件安装测试验证依赖保留 |
| 签名、平台、版本、摘要、限额、原子安装、离线复用同一验证路径 | 已用真实裁剪候选 ZIP 验证；候选密钥独立于生产信任根 |
| 取消、修复、切换、单文件离线导入和卸载 | 已实现并有回归；显式卸载共享组件后恢复 Lite，在用文档仍受租约保护；异常断电遗留目录清理待补 |
| Execute 边界、来源保护、版本去重、日志恢复和原件冲突保护 | 已实现并有回归 |
| 原生 C++ UNO 桥、内存文档操作与 PDF 导出 | macOS arm64、Windows 管理员及安装候选包的普通用户均 30/30 |
| 页面预览、区域批注、旧结果抑制、滚动与缩放 | 真实 Electron 渲染验证通过，数据为合成 IPC |
| Windows 普通用户、用户数据目录及中文工作区路径 | 托管普通用户与 Windows 11 非管理员服务账户均已通过；后者不等同于桌面普通用户 |
| 全局事件缺口恢复后的修改跟随 | 已实现并通过协议和 Electron 补快照回归 |
| 外部文件保存后刷新 | 干净会话自动重载，脏会话保留草稿并报冲突 |
| 幻灯片缩略图、工作表与页面映射、完整语言覆盖 | 已实现；Windows 候选包生成的 PDF 在真实 Electron 面板中通过复验 |
| 主程序 CD 只验证并复用已有运行时资产 | 已接入只读脚本；空目录不启用增强能力 |
| 轻量商店目录迁移和独立运行时发布 CD | 未发布、未完成正式发布链路 |
| Windows 最终安装目录有效 ACL | 13,700 个目录/文件逐项通过；无非预期写入者 |
| macOS Developer ID、公证 Accepted、staple | 2026-09-28 复验通过，Gatekeeper 接受；发布 ZIP 摘要保持不变 |
| 候选包离线安装、启动、流式升级/回退 | 真实安装器已通过；流式传输使用本机 HTTP 测试端点 |
| 公开 HTTPS 下载及生产目录 | macOS arm64 的 Office Runtime 1.0.0 已发布，真实公开下载、在线安装和检查更新均通过；客户端发布单独处理 |

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

本机最新原生报告为 `artifacts/office/probe-macos-startup/report.json`，每个样本目录包含 `live.pdf`、`reopened.pdf`、保存副本和 `snapshots.json`。报告的 `sourceCommit` 指样本仓库提交，`executionCommit` 为 Artemis 的 `f49232f414e5f653cfd6c1e2c4476c05cca409c6`。独立延迟启动实测故意在桥接启动后 20 秒才启动 Office，约 20.90 秒后正常连接并关闭，报告为 `artifacts/office/startup-delay-macos/report.json`。前期失败报告保留作诊断，不作为最终结果。

## Windows 未签名候选包证据

[最终复验 CI](https://github.com/EurekaRaider/Artemis/actions/runs/36323202452) 的两个作业均通过。验收代码为 `a880d249d2bcab55b56a26256b51681966b158b4`，候选包构建代码为 `f49232f414e5f653cfd6c1e2c4476c05cca409c6`；两者之间仅调整测试和验收脚本，产品源码相同。两个环境先核对相同 ZIP 的实际 SHA-256，再通过生产 `CapabilityPackService` 安装，并使用生产 `UnoOfficeEngine` 执行。

| 环境 | 账户 | 回归测试 | 安装生命周期 | 安装后原生样本 | 最终 ACL |
| --- | --- | --- | --- | --- | --- |
| Windows Server 2025 x64 / Build 26100 | 新建真实普通用户，非管理员 | 44 / 44 | 12 / 12 | 30 / 30 | 13,700 项，无非预期写入者 |
| Windows 11 Pro x64 / Build 26200 | NETWORK SERVICE，非管理员 | 44 / 44 | 12 / 12 | 30 / 30 | 13,700 项，无非预期写入者 |

Windows 11 runner 的实际 SID 为 `S-1-5-20`。这是服务账户的真实客户端验证，不能称为 Windows 11 桌面普通用户验收。普通用户证据来自托管 Windows Server。两端均使用用户所属的 LocalAppData 安装目录和中文文档路径，Windows 11 的本次临时安装已清理。

12 个检查点覆盖离线导入、活跃会话卸载保护、下载取消后保留已激活版本、流式升级、回滚、插件共享卸载保护、损坏收据修复、损坏内容修复、卸载、重装后的真实宿主打开/编辑/渲染/保存、最终 ACL、安装后完整样本复验。最终安装目录逐项检查只允许该账户、SYSTEM 和 Administrators 写入。

自有 `office-bridge.exe` 为 `NotSigned`，由候选 Ed25519 清单明确允许。上游 `soffice.exe` 和 `soffice.bin` 按发布者指纹校验，全部文件仍校验摘要。候选密钥不进入生产目录；两端 `candidateAccepted: true`、`releaseAccepted: false`、`publicDownloadValidated: false`。流式传输使用真实本机 HTTP 测试端点，未发布占位 Release URL。

旧包的[冷启动复验](https://github.com/EurekaRaider/Artemis/actions/runs/36321054526) 曾在 15 秒 UNO 连接窗口结束后退出。新包将连接上限独立设为 60 秒，首次请求共 90 秒，收到响应后的操作仍限 30 秒；真实宿主检查保持在修复、卸载、重装之后。macOS 的 20 秒延迟启动实验也通过。未将系统延迟归因于未经证实的具体原因。

[新包构建运行](https://github.com/EurekaRaider/Artemis/actions/runs/36321959853) 已通过管理员 30/30、普通用户的 12 个检查点及 30/30，但整次运行因 PDF 往返测试超过默认 5 秒、顺序预览测试超过整轮 30 秒而失败。随后只调整对应测试的总时限：文件往返 30 秒，多文档预览 120 秒；内容与画面就绪断言保留。最终复验全部通过，旧失败记录继续保留。

Artifact 配额已满，最终复验通过 CI 日志恢复托管端 100 个、客户端 99 个文件，逐个验证 SHA-256。大于 16 MiB 的 PDF 仅记录大小和摘要，不声称完整视觉验收。日志不包含引擎用户配置或候选私钥。主要报告位于：

| 证据 | 本地路径 |
| --- | --- |
| 托管普通用户安装、生命周期和 ACL | `artifacts/office/windows-ci-36323202452-host/ordinary-user/report.json` |
| 托管普通用户 30/30 | `artifacts/office/windows-ci-36323202452-host/ordinary-user/native/report.json` |
| Windows 11 服务账户安装、生命周期和 ACL | `artifacts/office/windows-ci-36323202452-client/client/report.json` |
| Windows 11 服务账户 30/30 | `artifacts/office/windows-ci-36323202452-client/client/native/report.json` |
| 构建提交、验收提交及归档摘要绑定 | 两个最终目录中的 `evidence/identity.json` |
| 管理员 30/30 | `artifacts/office/windows-ci-36321959853-host/probe/report.json` |

Electron 检查使用真实 PDF.js 和受控 IPC，验证过期结果抑制、批注源版本、滚动保留、缩略图、事件缺口恢复和工作表 PDF 页码映射；它不等同于完整 Artemis 主窗口的端到端验收。按用户最新要求，交付仅输出验收报告，不再处理或展示截图。

## 样本矩阵（macOS arm64 / Windows 候选包）

“流程通过”表示实际打开、局部修改、PDF 导出、保存副本、重开后目标核对通过；图片页检查位移，空页检查新插入文字。它不表示字体、样式、图片、图表、母版、动画、公式缓存等特性已经无损保留。

| 样本 | macOS arm64 流程 | 格式保真 | Windows x64 |
| --- | --- | --- | --- |
| `word/2col-header.docx` | 通过 | 未验收 | 通过 |
| `word/ImageCrop.docx` | 通过 | 未验收 | 通过 |
| `word/EmbeddedExcelChart.docx` | 通过 | 未验收 | 通过 |
| `word/TableWithAboveCaptions.docx` | 通过 | 未验收 | 通过 |
| `word/dml-groupshape-runfonts.docx` | 通过 | 未验收 | 通过 |
| `word/numbering-font.docx` | 通过 | 未验收 | 通过 |
| `word/style-inheritance.docx` | 通过 | 未验收 | 通过 |
| `word/tdf120344_FontTypes.docx` | 通过 | 未验收 | 通过 |
| `word/table-style-border.docx` | 通过 | 未验收 | 通过 |
| `word/section_break_numbering.docx` | 通过 | 未验收 | 通过 |
| `slides/ShapePlusImage.pptx` | 通过 | 未验收 | 通过 |
| `slides/font-scale.pptx` | 通过 | 未验收 | 通过 |
| `slides/master-slides.pptx` | 通过 | 未验收 | 通过 |
| `slides/onemaster-twolayouts.pptx` | 通过 | 未验收 | 通过 |
| `slides/chart_pt_color_bg1.pptx` | 通过 | 未验收 | 通过 |
| `slides/connector-shape-animations.pptx` | 通过 | 未验收 | 通过 |
| `slides/smartart-org-chart.pptx` | 通过 | 未验收 | 通过 |
| `slides/tableBorderLineStyle.pptx` | 通过 | 未验收 | 通过 |
| `slides/shape-text-rotate.pptx` | 通过 | 未验收 | 通过 |
| `slides/customshape-bitmapfill-srcrect.pptx` | 通过 | 未验收 | 通过 |
| `sheets/fontSize.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/testDrawCircleInMergeCells.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/cond_format_formula_listener.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/tdf151755_stylesLostOnXLSXExport.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/TableStyleTest.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/image_hyperlink.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/hyperlink_formula.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/PivotTable_CachedDefinitionAndDataInSync.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/column-style-autofilter.xlsx` | 通过 | 未验收 | 通过 |
| `sheets/chart_hyperlink.xlsx` | 通过 | 未验收 | 通过 |

## 计时与体积

以下为完整 30 份样本的单次测量，P95 使用 nearest-rank；每类只有 10 份，故此处 P95 等于该类最大值。`snapshotMs` 从修改开始计时，包含操作确认，表中记为“操作加快照”，不是纯快照耗时。

| 平台 / 账户 | 格式 | 流程通过 | 原生操作确认 P95 | 操作加快照 P95 | 原生 PDF 导出 P95 |
| --- | --- | --- | --- | --- | --- |
| macOS arm64 | Word | 10 / 10 | 23.40 ms | 51.71 ms | 24.98 ms |
| macOS arm64 | PowerPoint | 10 / 10 | 19.99 ms | 28.45 ms | 26.99 ms |
| macOS arm64 | Excel | 10 / 10 | 0.59 ms | 16.65 ms | 700.44 ms |
| 托管 Windows 管理员 | Word | 10 / 10 | 91.16 ms | 209.96 ms | 57.35 ms |
| 托管 Windows 管理员 | PowerPoint | 10 / 10 | 75.95 ms | 98.78 ms | 44.98 ms |
| 托管 Windows 管理员 | Excel | 10 / 10 | 2.10 ms | 74.07 ms | 3264.85 ms |
| 托管 Windows 候选包普通用户 | Word | 10 / 10 | 264.62 ms | 473.62 ms | 237.10 ms |
| 托管 Windows 候选包普通用户 | PowerPoint | 10 / 10 | 122.93 ms | 179.03 ms | 77.79 ms |
| 托管 Windows 候选包普通用户 | Excel | 10 / 10 | 4.03 ms | 87.74 ms | 3302.11 ms |
| Windows 11 服务账户 | Word | 10 / 10 | 56.55 ms | 115.56 ms | 84.40 ms |
| Windows 11 服务账户 | PowerPoint | 10 / 10 | 43.03 ms | 60.93 ms | 69.00 ms |
| Windows 11 服务账户 | Excel | 10 / 10 | 1.30 ms | 43.87 ms | 2626.29 ms |

Calc 批量读取将本机大表格的操作加快照从此前约 2.91 秒降至 16.65 ms；托管 Windows 普通用户从此前约 19.0 秒降至 87.74 ms。大表格的 Windows 原生 PDF 导出仍约 2.6–3.3 秒。以上不包含完整宿主队列、IPC、PDF.js 解码和屏幕呈现，**不能宣布 UI 状态 P95 ≤ 300 ms 或可见内容 P95 ≤ 1 秒达标**。

Windows 实际候选 ZIP 为 479,661,270 字节（457.44 MiB），展开 1,523,455,139 字节（约 1.42 GiB），包含 12,417 个文件。SHA-256 为 `198dc7bb361ecfbca457070c20bc81ffe7ee3b7b1707c2350dfba97d7ca38f47`。已移除帮助、模板、图库及上游 Python 运行时；候选包不携带第二套 Node、Chromium、Python 或 JRE。

官方 macOS DMG 为 298,773,447 字节，仅为构建输入；本轮 arm64 桥接为 401,088 字节（391.69 KiB）。macOS 最终能力包体积，以及主安装包相对基线增加 ≤ 10 MiB，仍待发行产物实测。

## 回归验证

- Office 协议、Lite 原件保护、安装器、会话及插件依赖，以及原生沙箱使用官方 Node 26.9 验证。新增回归覆盖未接受的原件写入、恢复基线篡改、并行打开去重。
- 本轮早期完整 `npm run verify:ci` 已通过：构建、格式、UI 一致性/边界/性能预算、类型检查及生产依赖审计均完成；各 Vitest 套件共 4046 项通过、14 项按既有条件跳过，其中桌面套件为 2496 项通过、12 项跳过。证据为 `artifacts/office/verify-ci-final.log`。后续原生关闭、PowerShell 环境及冷启动修复另通过桌面构建、类型检查及 44 项针对性回归。
- Windows CI 的实际编译、44 项回归、Electron 预览、管理员、普通用户及服务账户的 30 份原生样本均已执行；结果、限制和原始证据入口见上节。下载重试另外验证了续传、服务器忽略 Range 后重下、完整内容后的断线及缓存摘要；日志回收验证了往返摘要、无效路径/损坏内容拒绝及超大 PDF 不阻断报告。
- Homebrew Node 的原生动态库问题和未关闭 Node WebStorage 的单独测试结果不能替代 CI 环境结果。最终运行使用官方 Node 26.9 及验证脚本的 `--no-experimental-webstorage` 设置。
- 原有主分支的热力图 tooltip 样式与 CSS 契约存在三处差异。本分支只将契约更新到已存在的 `width: max-content`、`white-space: normal`、`overflow-wrap: anywhere`，没有改变该 UI 或提高性能预算。
- 生产 catalog 已包含 macOS arm64 的正式签名清单和更新源。临时候选密钥不会加入生产信任根，自动化验证继续使用独立用户目录。

## 发布前流程

此节是正式发布仍需实现和验收的约定，不表示已经有可用的签名发行包。

1. 对已通过流程的固定样本逐项核对复杂特性与像素保真，并测量真实宿主 UI 延迟；Windows 10 和 Windows 11 桌面普通用户尚未验收。生产原件覆盖继续禁用。
2. Windows 已完成裁剪候选包和中文路径验收；仍需制作 macOS arm64 最终能力包，补充字体缺失、文件占用、引擎崩溃与干净系统检查。异常断电遗留目录自动清理仍待完成。
3. macOS 组织成 `ArtemisOfficeRuntime.app`，依次完成嵌套代码和外层 Developer ID 签名、Hardened Runtime、公证 Accepted、对 app staple、离线验证，再生成最终 ZIP。Windows 校验清单中明确声明的签名或未签名策略、最终安装目录 ACL 和真实执行；无需为候选包购买签名证书。
4. 以最终字节生成逐文件清单、归档摘要及 Ed25519 签名。把可信公钥和经双平台验收的清单加入宿主目录；不能让离线包自行信任其公钥。
5. 创建独立 `office-runtime-vX.Y.Z` Release，明确 `make_latest: false`。发布前后读取 `/releases/latest`，证明主程序更新目标没有变化；已发布同版本内容必须一致，禁止覆盖。
6. 运行时 CD 按源文件、依赖和产物配置版本触发。保存构建摘要、签名产物、公证 submission ID 与成功回执、staple 后最终归档摘要及上传资产 ID。失败重跑先校验并复用完成阶段，不能重新签名或重新打包已发布产物。
7. 轻量插件与 Skills 放入 `EurekaRaider/ArtemisRelease:main` 的商店目录；大型运行时只在独立 Release 中。普通主程序 CD 继续只读验证固定版本资产，不重新生成能力包。
8. 从真实下载和安装路径验收首次下载、中断/取消重试、缓存复用、离线导入、升级、回退和共享卸载后，才开放功能及原件写入。

在上述原生门槛通过前，不合并为已验收功能，不公开发布能力包，不以简化预览或协议测试替代平台证据。
