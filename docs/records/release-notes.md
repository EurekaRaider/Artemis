# Artemis v2.0.4

## 中文

- Windows 上为 Slack CLI 分配独立控制台，修复从 Electron 启动时可能挂起的问题；随应用验证的 Slack CLI 更新到 4.13.0。
- 自定义模型服务设置将连接、模型能力和限制分组展示。欢迎页的继续任务卡片简化了文件变更摘要，窄窗口会隐藏发送提示。
- 按功能整理桌面主进程、渲染器、Pi 会话和协议模块；在 README 中增加运行时架构图和目录归属说明，方便定位源码与测试。

## English

- Give the Slack CLI its own console on Windows to prevent hangs when Electron launches it. Update the verified Slack CLI to 4.13.0.
- Group connection settings, model capabilities and limits in the custom provider form. Simplify the changed-file summary on welcome cards and hide the send hint in narrow windows.
- Reorganize desktop services, renderer controllers, Pi sessions and protocol modules by feature. The README now maps runtime boundaries and shows where source code and tests belong.
