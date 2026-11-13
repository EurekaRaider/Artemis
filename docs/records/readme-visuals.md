[English / 简体中文](readme-visuals-en.md)

# README 视觉资产

## 当前截图

2026 年 11 月 13 日，在 macOS arm64 上从 Artemis **2.0.7** 的本地生产构建重新采集 README 的 **20 张界面截图**，同步当前欢迎页、月亮箭头图标、深色暖墨配色与用量界面。

截图来自真实 Electron Renderer，均为 **1440 × 850 CSS 像素、100% 缩放的完整应用视口**，未经裁剪或图像合成。主题、语言、设置、工作区工具、资源中心及群对话通过现有产品界面和宿主导航打开。

[主清单](../assets/images/manifest.json)记录采集时间、应用版本、源码 HEAD、工作区状态、构建摘要、图片尺寸和 SHA-256；[环境面板清单](../assets/images/environment-manifest.json)记录同次采集的两张环境面板截图。清单中的工作区说明是采集来源的边界，不等于签名发行包或三平台 CI 的验收结论。

## 演示数据与隐私

- 使用独立临时 user-data 和 Field Notes Git 仓库，不读取个人项目、会话或全局 Skills。
- 对话、子 Agent 记录、用量、IM 成员与连接、两个暂停的定时任务均为合成演示数据；没有发出模型请求、连接真实 IM 账号或执行定时任务。
- Terminal 在演示仓库执行真实 `git status --short`，使用中性提示符。
- 仅在隔离进程的 snapshot handler 中将显示身份设为 Artemis，并屏蔽真实 PR 查询；产品身份逻辑保持原样。
- 安装截图展示 Computer Use 的确认弹窗并取消，没有安装能力或开始账号授权。
- 中文截图使用真实中文界面；演示项目标题和正文保留英文。
- 脚本检查可见文本中的系统用户名和个人主目录路径，并记录页面错误与控制台错误；图片交付前逐张检查。
- Renderer 使用 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。

## 截图清单

| 文件                                                                        | 展示内容                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------- |
| [welcome-dark.png](../assets/images/welcome-dark.png)                       | 深色欢迎页与任务输入区                            |
| [workspace-light.png](../assets/images/workspace-light.png)                 | 浅色任务、结构化工作记录与 Markdown               |
| [workspace-dark.png](../assets/images/workspace-dark.png)                   | 同一任务的深色主题                                |
| [workspace-zh-CN.png](../assets/images/workspace-zh-CN.png)                 | 中文导航与任务操作                                |
| [environment-panel-light.png](../assets/images/environment-panel-light.png) | 浅色工作区环境面板                                |
| [environment-panel-dark.png](../assets/images/environment-panel-dark.png)   | 深色工作区环境面板                                |
| [git-review.png](../assets/images/git-review.png)                           | 真实演示仓库差异与审查范围分段控件                |
| [markdown-files.png](../assets/images/markdown-files.png)                   | Markdown 阅读器与工作区标签页                     |
| [terminal.png](../assets/images/terminal.png)                               | 原生终端与 Git 输出                               |
| [agent-team.png](../assets/images/agent-team.png)                           | 两个已完成的演示子任务                            |
| [resources.png](../assets/images/resources.png)                             | 统一 Office 入口、Design、Computer Use 与资源分类 |
| [plugin-install.png](../assets/images/plugin-install.png)                   | Computer Use 安装确认                             |
| [settings-general.png](../assets/images/settings-general.png)               | 通用设置与外观偏好                                |
| [token-usage.png](../assets/images/token-usage.png)                         | 合成用量、热图和统计                              |
| [automations.png](../assets/images/automations.png)                         | 两个暂停的每周任务                                |
| [im-connections.png](../assets/images/im-connections.png)                   | 消息接入、渠道和群授权入口                        |
| [im-channel-settings.png](../assets/images/im-channel-settings.png)         | 合成 Slack 连接设置                               |
| [im-spaces.png](../assets/images/im-spaces.png)                             | 群项目授权与成员                                  |
| [im-group-chat.png](../assets/images/im-group-chat.png)                     | 浅色群对话与上下文                                |
| [im-group-chat-dark.png](../assets/images/im-group-chat-dark.png)           | 同一群对话的深色主题                              |

## 复现与验证

使用与 CI 一致的 Node.js 26，先构建，再通过现有 Playwright Electron 接口采集。本次环境未提供 Browser 插件技能，使用环境已有的 Playwright，没有新增项目依赖。

```bash
npm run build
ARTEMIS_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node scripts/ui/capture-readme.mjs /tmp/artemis-readme-capture
```

省略输出目录时写入 `docs/assets/images/`。先在临时目录检查所有原图和清单，再替换正式素材。验证包括页面标题与非空内容、无框架错误覆盖层、页面与控制台错误、主题与语言切换、工具导航、群对话、安装确认及取消、隐私检查，以及尺寸、文件大小和 SHA-256。

已删除仍使用旧模式术语或遗漏 macOS x64 的架构与权限图及其源稿；当前架构以 [架构说明](../architecture-zh-CN.md) 和 README 的文字与表格为准。

本次素材证明文档界面的渲染与采集结果，不代表真实模型调用、IM 投递、服务商授权、Windows 实机视觉验收或签名发行包验收。
