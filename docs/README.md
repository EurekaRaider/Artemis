[English / 简体中文](README-en.md)

# Artemis 文档

这里保留当前使用、开发与维护指南，以及必要的发布记录和视觉资产。[目录规则](AGENTS.md)说明放置与清理约定。

## 总览

- [系统架构](architecture-zh-CN.md)：进程、包边界、协议与执行策略。
- [安装说明](install.md)：安装、插件与模型配置。

## 使用与开发指南

| 文档 | 内容 |
| --- | --- |
| [附件上下文](guides/attachment-context-zh-CN.md) | 上下文预算与附件保护 |
| [Hooks](guides/hooks.md) · [English](guides/hooks-en.md) | 配置、命令协议、信任与插件开发 |
| [Connectors](guides/connectors-zh-CN.md) | 账号连接、凭据与开发者配置 |
| [插件 OAuth](guides/plugin-oauth.md) | 声明、授权与开发者后端协议 |
| [插件与 Git 商店](guides/plugin-marketplaces.md) · [English](guides/plugin-marketplaces-en.md) | 插件规范、签名、分发与更新 |
| [视觉皮肤插件](guides/visual-skins.md) · [English](guides/visual-skins-en.md) | Skin v2、资源契约、开发工具与完整示例 |
| [工程目录](guides/repository-layout.md) | 源码、测试、工具与产物的归属和迁移规则 |
| [多语言维护](guides/localization.md) | 术语、RTL 与验证约定 |
| [插件开发](guides/plugin-development.md) | v2 契约、SDK、工具、示例与 v1 兼容 |
| [双平台发布](guides/release.md) | 公共 CI、签名、更新与恢复验收 |

- [Pi 与任务模式](guides/pi-upgrade-modes-zh-CN.md)：计划确认、恢复与工具权限。

## 持续维护记录

- [发布说明](records/release-notes.md)：当前版本的中英文说明，Release 工作流直接消费。
- [CI 与验证维护](records/ci-reliability.md)：命令、工作流范围与证据要求。
- [README 视觉资产](records/readme-visuals.md)：截图规范、隐私检查和复现方式。

## 资产与配套工程

- [视觉资产](assets/)与[截图清单](assets/images/manifest.json)：图片、HTML/SVG 图源和截图。
- [截图采集脚本](../scripts/ui/capture-readme.mjs)：使用隔离演示数据采集生产界面。
- [Hooks 示例](../examples/hooks/hooks.json)：配置、脚本及[示例插件](../examples/hooks/plugin/artemis.plugin.json)。
