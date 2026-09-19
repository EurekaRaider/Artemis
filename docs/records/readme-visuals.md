# README 视觉资产

## 本次采集

2026 年 9 月 19 日，在 macOS arm64 上从 Artemis **1.6.0** 的本地生产构建
重新采集了 README 使用的 **19 张界面截图**。截图来自真实 Electron Renderer，
覆盖当前工作区、插件市场、安装确认、消息接入和群协作界面。

所有截图均为 **1440 × 850 CSS 像素、100% 缩放的完整应用视口**。
[主清单](../images/screenshots/manifest.json)记录采集时间、源码 HEAD、工作区说明、
主进程与 preload 构建摘要、Renderer 入口摘要、图片尺寸和 SHA-256。
[环境面板清单](../images/screenshots/environment-manifest.json)保留同次采集的两张面板截图。
本次 HEAD 为 `458101125146fc1d9ebecbc56158413aa22b2b8b`，构建包含采集时的本地改动，
不代表这个提交本身或签名发行包的验收结果。

采集流程：打开隔离的 Field Notes 任务 → 切换主题与语言 → 打开 Review、Files、
Terminal 和 Agent team → 查看设置、IM 渠道及群授权 → 查看插件和安装确认 →
查看用量与定时任务 → 打开群对话，检查真实渲染结果。

## 演示数据与隐私

- 使用独立的临时 user-data 和临时 Field Notes Git 仓库，不读取个人项目或会话。
- 对话、子 Agent 记录、Token 用量和两个暂停的定时任务均为合成演示数据。
  没有提交模型请求，也没有启用或运行定时任务。
- Terminal 在演示仓库执行真实的 `git status --short`，使用中性的 Field Notes 提示符。
- 仅在隔离进程的 snapshot handler 中将显示身份改为 **Artemis**；同时屏蔽个人
  全局 Skill 列表和真实 PR 查询，未修改产品身份逻辑。
- IM handler 返回合成 Slack 连接、群信息和四个成员身份，不连接真实 Gateway、
  个人账号或机器人。连接详情中的 `demo-owner` 和 `demo-device` 均为演示标识。
- 插件安装截图只打开确认弹窗并取消，没有安装第三方能力或开始账号授权。
- 中文截图使用真实中文界面，演示项目标题和正文保留英文。
- 截图脚本检查可见文本中的当前系统用户名与个人主目录路径；另逐张查看原始分辨率，
  核对侧栏、终端、设置、用量和 IM 内容，未发现个人姓名、个人目录或凭据。

## 截图清单

| 截图                                                              | 展示内容                                        |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| [浅色工作区](../images/screenshots/workspace-light.png)           | 项目、持久任务、Markdown 与输入区               |
| [深色工作区](../images/screenshots/workspace-dark.png)            | 同一任务的深色主题                              |
| [中文工作区](../images/screenshots/workspace-zh-CN.png)           | 中文导航与任务操作                              |
| [浅色环境面板](../images/screenshots/environment-panel-light.png) | Git、Agent 活动和来源摘要                       |
| [深色环境面板](../images/screenshots/environment-panel-dark.png)  | 同一面板的深色主题                              |
| [Git Review](../images/screenshots/git-review.png)                | 演示仓库的真实未暂存差异                        |
| [文件与 Markdown](../images/screenshots/markdown-files.png)       | 文档阅读与工作区标签页                          |
| [Terminal](../images/screenshots/terminal.png)                    | 原生 PTY 和真实 Git 输出                        |
| [Agent team](../images/screenshots/agent-team.png)                | 两个已完成的演示子任务                          |
| [插件市场](../images/screenshots/resources.png)                   | Plugins、MCP、Skills 三个页签与四个内置文档插件 |
| [插件安装确认](../images/screenshots/plugin-install.png)          | 能力数量和安装后的默认启用状态                  |
| [通用设置](../images/screenshots/settings-general.png)            | 头像、语言、主题和防止系统休眠设置              |
| [Token 用量](../images/screenshots/token-usage.png)               | 演示用量、热图和统计                            |
| [定时任务](../images/screenshots/automations.png)                 | 两个暂停的每周任务                              |
| [消息接入](../images/screenshots/im-connections.png)              | 服务状态、渠道和独立群授权入口                  |
| [渠道设置](../images/screenshots/im-channel-settings.png)         | Slack 连接、配对账号和验证入口                  |
| [群授权入口](../images/screenshots/im-spaces.png)                 | 原生群选择、状态与打开对话操作                  |
| [浅色群对话](../images/screenshots/im-group-chat.png)             | 合成成员、请求内容和协作结果                    |
| [深色群对话](../images/screenshots/im-group-chat-dark.png)        | 同一群对话的深色主题                            |

## 复现与验证

先使用 Node 24 运行 `npm run build`。采集脚本使用现有 Playwright 的 Electron
接口；本次会话没有 Browser 插件，使用环境提供的 Playwright，未新增项目依赖。

```bash
npm run build
ARTEMIS_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node docs/scripts/capture-readme.mjs /tmp/artemis-readme-capture
```

省略输出目录时，脚本写入 `docs/images/screenshots/`。建议先采集到临时目录，
完成原图检查后再替换正式图片和清单。脚本采用 macOS 标题栏布局，不能作为 Windows
或 Intel macOS 实机视觉验收的替代。

| 检查               | 本次结果                                                              |
| ------------------ | --------------------------------------------------------------------- |
| 页面身份与非空内容 | 真实生产页面，标题为 Artemis，各目标页面正常显示                      |
| 页面异常覆盖层     | 没有 Vite 错误覆盖层                                                  |
| 页面与控制台错误   | `pageerror` 和 error 级 console 均为 0                                |
| 交互               | 主题、语言、工作区工具、IM 群选择与打开对话、插件安装弹窗及取消均完成 |
| Renderer 隔离      | `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`   |
| 图片               | 19 张均重新生成，完整视口，尺寸和 SHA-256 与清单匹配                  |
| 隐私               | 可见文本检查与原分辨率逐图检查通过                                    |

这些结果证明本次文档素材的渲染和采集流程，不表示真实模型调用、IM 双机器人投递、
服务商授权或完整 CI 已通过。

## 架构图

两张图均以自包含 HTML 为源，再提取内联 SVG 供 README 引用。
画布统一为 **1280 × 840**，保留已有 Artemis 浅色风格、蓝色重点节点和系统字体；
没有外部字体、脚本或网络资源。

| 图            | 源文件                                               | README 导出物                                    |
| ------------- | ---------------------------------------------------- | ------------------------------------------------ |
| 桌面架构      | [HTML](../diagrams/artemis-system-architecture.html) | [SVG](../images/artemis-system-architecture.svg) |
| IM 原生群协作 | [HTML](../diagrams/artemis-im-collaboration.html)    | [SVG](../images/artemis-im-collaboration.svg)    |

桌面图以八个节点说明 Renderer、Main、Pi Agent Host、本地状态、能力与工具、
IM 服务及外部服务。`PiAdapter` 位于 Agent Host，输出 Artemis 协议事件；Main
管理生命周期、Goal、定时任务、审批和连接器。模型服务与外部 MCP / Connector
合并展示，工具的权限区别放在图下说明，避免把每个服务都画成单独节点。

IM 图以五个节点展示两台独立电脑通过同一个原生群交换任务和结果。群派工仍需
各自授权和真实 IM 往返验证；持久等待、继续执行、取消待确认与未知状态分别说明。
图中另行标注已配对主人单聊使用本地 Execute 权限和自动审批，支持无项目临时会话。

语义依据为 `packages/agent-host/src/runtime.ts`、`packages/protocol/src/im.ts`、
桌面 `main.ts` / `im-service.ts`、当前 Connector v1 契约及原生群路由。
Shell / Terminal 的桌面用户权限、MCP / 扩展的独立沙箱与群任务的受限工具分别表达。

两张 HTML 均通过 Diagram Design 自检和连线几何检查；浏览器验证了全部文字在
画布及所属节点内，核对了系统字体和完整渲染。导出 SVG 与 HTML 中的 SVG 保持一致，
保留独立的可访问性标题和说明。配色仅作用于本项目图稿，未修改安装的技能或共享样式。
