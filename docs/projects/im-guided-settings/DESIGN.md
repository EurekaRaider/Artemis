# Artemis Design Context

## Overview

Artemis 是本地优先的桌面开发工作台。产品界面沿用 Apple-inspired Artemis 方向：紧凑分区、灰阶层次、细边框、克制玻璃效果。消息接入服务于已打开项目、希望从聊天软件发起任务的桌面用户；使用中文说明，保留平台官方字段名。

现有设计依据：`docs/ui-prototype/handoff-2026-09-08-production-sync.md`、`docs/ui-prototype/ui/README.md`。本次仅维护静态原型，不改变生产 React/Electron 皮肤。

## Colors

运行时 token 是唯一数值来源：原型 `docs/ui-prototype/ui/tokens.css` → `ui/index.css` 与兼容别名 → `workspace/workspace.css`。生产由 `packages/theme-contract`、`packages/theme-artemis` 管理。功能页使用 `--text`、`--text-2`、`--surface`、`--border-soft`、`--accent` 与语义状态 token，不复制独立色板。

## Typography

继承工作台系统字体；平台凭据、设备编号与指令使用既有等宽样式。标题克制，说明按需展开。状态同时包含文字与图标，不能仅靠颜色。

## Layout

设置沿用侧边导航与单一内容滚动区。消息接入按服务、机器人、账号、项目、可选群协作组织；本步骤的字段、说明、结果与恢复操作内聚。必填凭据直接呈现，自动识别字段进入高级设置。窄屏字段单列，按钮允许换行。

## Elevation & Depth

卡片沿用现有 surface、细边框与圆角。确认框使用共享 dialog；不在单一设置页另建视觉体系。

## Shapes

使用既有 `--r-card` 与公共按钮圆角。图标取现有 Artemis SVG 图标定义，图标配文字优先；密钥显隐按钮具备独立可访问名称。

## Components

共享行为所有权见 [UX-CONTRACT.md](UX-CONTRACT.md)。默认输入控件沿用原型的原生 select（接受系统弹出菜单）；不自行实现另一套下拉。演示控制折叠收纳，虚构凭据只存当前页面内存，不调用真实服务。

## Do's and Don'ts

- 保持浅色、深色和 reduced-motion 下的语义一致。
- 完成状态来自已保存的数据，不把草稿显示为已授权。
- 远程执行始终为项目范围沙箱；不提供完整本机访问选项。
- 不把原型成功提示当作生产接入、平台联调或打包验证证据。
