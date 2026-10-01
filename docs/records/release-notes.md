# Artemis v1.6.16

## 中文

- **Goal 累计计时**：用量刷新、编辑目标、暂停／恢复和状态变化前保存已运行时长，避免计时归零；暂停期间不累计，回合结束不重复计时。
- **Markdown 自适应宽度**：时间线长文本、代码块和表格在可用宽度内换行，保留文本选择、消息复制和代码块复制能力。

- **插件功能说明**：Word、PowerPoint、Excel 根据 Office 组件激活状态显示基础或高级能力；PDF 明确为读取文本与创建文本 PDF，14 种语言同步。

- **依赖安全修复**：Axios 更新至 1.20.0，修复本次生产审计发现的高危漏洞。

发布目标为 macOS arm64（签名、公证 DMG/ZIP）与 Windows x64（未签名 ZIP），沿用已发布 Office Runtime。Intel macOS 保留本地打包支持，不在本次 CD 发布范围内。

## English

- **Cumulative Goal timing**: preserve active elapsed time before usage updates, objective edits, pauses/resumes and status changes. Paused time is excluded and turn completion no longer counts the same time twice.
- **Responsive Markdown**: timeline prose, code blocks and tables wrap within the available width, retaining text selection, message copying and code block copying.

- **Plugin capability descriptions**: Word, PowerPoint and Excel distinguish basic and advanced features using the active Office capability. PDF describes text reading and text-based PDF creation. All 14 locales are synchronized.

- **Dependency security fixes**: update Axios to 1.20.0 to resolve high-severity findings from the production audit.

Release targets are macOS arm64 (signed, notarized DMG/ZIP) and Windows x64 (unsigned ZIP), reusing published Office runtimes. Intel macOS remains a local packaging target and is not included in this CD release.
