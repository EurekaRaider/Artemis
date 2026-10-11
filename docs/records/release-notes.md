# Artemis v1.7.14

## 中文

- Computer Use 与 Office 支持 macOS Intel x64，宿主按平台、架构与 hostRange 发现签名插件；旧客户端继续使用原有 arm64 / Windows 清单。
- Computer Use 发布覆盖 macOS arm64、macOS x64 和 Windows x64 三个原生目标；macOS 保留 Mach-O 架构、Developer ID、Hardened Runtime、公证、stapling 和 Gatekeeper 校验。
- Office 增加固定 SHA-256 的 Intel LibreOffice 引擎与 SDK、UNO bridge 原生构建，以及最终签名包和公开目录的全新安装、Word / Excel / PowerPoint 编辑、导出与重新打开验收。
- 输入框预测在同轮补充消息后使用最新上下文；关闭预测后历史指令不会重新启用建议，输入与审批仍抑制建议，Tab 填入不会自动发送。
- 修复模型快速完成时建议早于提交确认而丢失的问题；Intel 宿主发布增加从最终签名 ZIP 启动、全新配置发现并在线安装两个原生插件的验收。
- 登录表单在提示显示前初始化输入，防止快速填入的授权响应被清空；Intel 插件验收同时实际加载已安装的预览模块。
- 下拉框关闭后的延迟回焦保留用户已移到其他输入框的焦点，避免抢回数字字段等控件的输入。
- 插件目录与独立运行时必须通过各自发布验收；这些源码说明不代表尚未执行的签名、公证或原生安装已经成功。

## English

- Support macOS Intel x64 Computer Use and Office runtimes. The host discovers signed plugins by platform, architecture and hostRange while legacy clients retain the arm64 / Windows manifests.
- Release Computer Use for native macOS arm64, macOS x64 and Windows x64 targets. Preserve Mach-O architecture, Developer ID, Hardened Runtime, notarization, stapling and Gatekeeper checks on macOS.
- Add SHA-256 pinned Intel LibreOffice engine and SDK inputs, native UNO bridge builds, fresh installation of the final signed archive and public catalog, and Word / Excel / PowerPoint editing, export and reopen acceptance.
- Base composer predictions on updated context after supplements in the same turn. Historical instructions cannot re-enable disabled predictions; typing and approvals still suppress suggestions, and Tab insertion never sends a message.
- Keep fast model completions until submission acceptance clears the draft. Intel host releases launch the final signed ZIP application and verify discovery and online installation of both native plugins in a fresh profile.
- Initialize login inputs before displaying the prompt so fast authorization responses are retained. Intel capability acceptance also loads the installed preview module in the signed host.
- Preserve newer input focus when a select closes instead of allowing its delayed focus return to steal focus from another control.
- Plugin catalogs and independent runtimes require their own release acceptance. These source notes do not claim unperformed signing, notarization or native installation passed.
