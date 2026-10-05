[English / 简体中文](install-en.md)

# Artemis 安装说明

## 选择安装包

仅支持 Windows x64 和 macOS arm64。正式附件位于 [Artemis](https://github.com/EurekaRaider/Artemis/releases)。无需注册码或设备激活。

## macOS arm64

打开 DMG，将 `Artemis.app` 拖入“应用程序”后启动；ZIP 用户先完整解压，再移动到“应用程序”。正式发布包须经过签名、公证和 staple，不需要清除系统 quarantine 属性。若系统拒绝打开，检查下载是否完整及发布验收信息，不应把移除安全属性作为正常安装步骤。

## Windows x64

优先使用 `.exe` 当前用户级安装包，不要求管理员权限。安装版从独立的签名 Windows 索引检查更新；用户确认且任务结束、编辑保存后才重启安装。验证失败时不能安装。

ZIP 保留手动更新：完整解压到用户拥有的普通目录，退出旧应用，再运行新目录中的 `Artemis.exe`。不要直接在压缩包内启动。希望启用安装版更新时，手动安装一次 NSIS 包；现有 userData 与项目文件不随安装目录替换。

Ed25519 验证保证更新清单与附件完整性，不代表 Authenticode 签名或 SmartScreen 信誉。系统或企业执行策略仍可能阻止未签名程序；不要关闭系统防护来绕过它。

刷新 OpenAI 或自定义 GitHub 插件商店时，Artemis 直接通过系统网络栈
下载 HTTPS 仓库归档，不会调用 `git.exe`，因此用户电脑无需安装 Git。公司网络
需要允许访问 `api.github.com` 以及 GitHub 返回的归档下载地址；网络被拦截时，
已缓存的商店仍会保留。

## Office 套件

打开“资源中心 → 插件 → Bundled plugins → Office 套件”，在线安装增强包，或导入经过验证的 `.artemis-office` 离线包。安装一次即可启用 Office 功能，无需另外安装基础插件。未安装或未启用增强包时，不提供 Office 文档操作和预览；卸载会保留文档和历史记录。

## 模型配置

在 Artemis 的设置中，按照 OpenCode 中已有的服务配置填写 Base URL、API Key 和模型 ID 等信息，并将消息类型设置为 **Responses (/responses)**。保存配置后，选择对应的提供商和模型即可使用。
