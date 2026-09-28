# Artemis v1.6.9

## 中文

### 本次更新

- **Office 工作台**：DOCX、PPTX、XLSX 使用右侧文档面板，支持原生页面预览、缩放、页码与工作表切换、区域选取及批注。文件树和文档链接复用同一入口，未安装能力包时可直接进入升级面板。
- **本地编辑、自动保存与撤销**：原位修改可定位的 Word 段落、幻灯片对象文字，以及工作表 A1:Z50 内的值和公式；CSV 支持单元格与原文编辑。输入停顿后自动保存，支持中文输入法、撤销与重做；保存失败保留草稿，外部修改冲突时拒绝覆盖。Office 文档保存到同目录工作副本，保留原文件；UTF-8 CSV 经冲突检查后写回原文件。编辑和保存要求 Execute 模式，无需经过模型或云端转换。
- **共享 Office 能力包管理**：Documents、Presentations、Spreadsheets 共用可选的增强引擎，支持在线安装、单个 `.artemis-office` 文件离线导入、检查更新、修复与卸载。签名和文件摘要验证保持强制执行；检查失败不显示“已是最新”，在用组件受租约保护，卸载保留用户文档并恢复 Lite。
- **Office 会话恢复与一致性**：使用版本化事件、操作日志和独立基线恢复已确认修改；旧预览不能覆盖新版本。干净会话可重新加载外部修改，存在草稿时保留内容并提示冲突。
- **Computer Use 授权与工具图标**：显式授予的任务及指定应用权限可跨轮复用，前台权限仍单独授权且可撤销；授权内动作复用现有本地模型审批判断。工具卡片在运行、完成和失败时保留插件身份。浏览器接管事件绑定当前目标，保留停止、接管和恢复边界。
- **更新与活动提示**：成功检查且没有新版本时明确显示已是最新；活动热力图提示跟随滚动容器定位，避免被面板边缘遮挡。

### 安装与范围

- **macOS Apple Silicon（arm64）**：Developer ID 签名、公证的 DMG/ZIP，支持应用内更新。Office Runtime 1.0.0 为独立下载的可选组件；本版复用已发布的 macOS arm64 运行时，不在客户端 CD 中重建或替换它。
- **Windows x64**：无签名 ZIP，下载后退出旧版并解压到新文件夹启动，保留 `%APPDATA%` 中的 Artemis 用户数据。Windows 客户端发布不代表 Windows Office 增强运行时已经正式发布；运行时可用性以平台目录为准。
- 复杂 Office 排版和完整格式保真尚未全面放行；旋转文字、无法唯一定位的文字及跨页段落保持只读，旧版 DOC/PPT/XLS 需先转换。新增编辑文案提供中文及英文回退，其余既有 Office 文案保留 14 种语言。原始 #226 Codex 暂停报告仍未确认，不能视为已全面解决。macOS Intel x64 不包含在本次 CD 产物中。

## English

### What's changed

- **Office workbench**: DOCX, PPTX and XLSX share the right-hand document panel with native page previews, zoom, page and sheet navigation, region selection and annotations. File-tree entries and document links use the same entry point, with direct access to component installation when the runtime is missing.
- **Local editing, autosave and undo**: edit identifiable Word paragraphs, slide object text, and worksheet values and formulas within A1:Z50. CSV supports cell and source editing. Autosave respects input composition; undo and redo remain available after saves. Failed saves retain drafts, and external changes block conflicting writes. Office files save to a working copy alongside the original; UTF-8 CSV writes back after conflict checks. Editing and saving require Execute mode and run locally without model calls or cloud conversion.
- **Shared Office runtime management**: Documents, Presentations and Spreadsheets use one optional enhanced engine, with online installation, single-file `.artemis-office` import, update checks, repair and removal. Signature and file-digest verification remain mandatory. Failed checks never claim the runtime is current; leases protect active components, and removal preserves user documents while restoring Lite.
- **Office recovery and consistency**: versioned events, operation journals and independent baselines recover acknowledged changes. Stale previews cannot replace newer revisions. Clean sessions reload external changes, while dirty sessions preserve drafts and report conflicts.
- **Computer Use permissions and tool identity**: explicitly granted task and app permissions can be reused across turns, with separate, revocable foreground permission. Authorized actions reuse the existing local model-approval decision. Tool cards retain plugin identity while running, completed or failed. Browser takeover events bind to the current target, preserving Stop, takeover and recovery boundaries.
- **Update and activity feedback**: successful checks explicitly confirm when no newer version exists. Activity heatmap tooltips track their scrolling container and remain visible near panel edges.

### Installation and scope

- **macOS Apple Silicon (arm64)**: Developer ID signed and notarized DMG/ZIP, with in-app updates. Office Runtime 1.0.0 is an optional separate download. Client CD reuses the published macOS arm64 runtime without rebuilding or replacing it.
- **Windows x64**: unsigned ZIP. Quit the old version, extract into a new folder and launch the new app, preserving Artemis user data in `%APPDATA%`. Shipping the Windows client does not establish a public Windows enhanced Office runtime; availability follows the platform catalog.
- Full Office layout and format fidelity remain limited. Rotated text, ambiguous targets and paragraphs spanning pages stay read-only; legacy DOC/PPT/XLS files require conversion. New editing strings include Chinese and English fallback; existing Office strings retain 14 languages. The original #226 Codex pause report remains unconfirmed. Intel macOS x64 is outside this CD artifact set.
