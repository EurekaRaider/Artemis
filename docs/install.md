# Artemis 安装说明

## 选择安装包

- Apple Silicon（M 系列芯片）Mac：选择文件名中带 `arm64` 的 DMG 安装包。
- 64 位 Windows：选择文件名中带 `Windows-x64` 的 `.zip` 压缩包。

Lite 发布配置不生成 Intel x64 macOS 安装包，也不声明跨架构 macOS 完成度。

## macOS

1. 打开 DMG 安装包，将 `Artemis.app` 拖入“应用程序”文件夹。
2. 安装完成后打开“终端”，执行以下命令：

   ```bash
   xattr -dr com.apple.quarantine /Applications/Artemis.app
   ```

3. 从“应用程序”文件夹打开 Artemis。

## Windows

1. 使用文件资源管理器或 7-Zip 将 `.zip` 完整解压到当前用户拥有的普通目录，
   不要直接在压缩包内运行程序，也不要解压到 `Program Files`。
2. 双击解压目录中的 `Artemis.exe`。
3. 如公司策略、SmartScreen 或 Smart App Control 拦截未签名工程包，请使用
   Authenticode 签名的发布包，ZIP 本身不能绕过公司的应用执行策略。

Windows 版本不提供安装器，也不执行安装器式自动更新。升级时先退出
Artemis，下载新版 ZIP，解压到新的目录后运行新版
`Artemis.exe`。

刷新 OpenAI 或自定义 GitHub 插件商店时，Artemis 直接通过系统网络栈
下载 HTTPS 仓库归档，不会调用 `git.exe`，因此用户电脑无需安装 Git。公司网络
需要允许访问 `api.github.com` 以及 GitHub 返回的归档下载地址；网络被拦截时，
已缓存的商店和安装包自带的四个 Lite 插件仍会保留并可继续使用。

## Lite 文档 Skills

打开“资源中心 → 插件 → Bundled plugins”，点击“安装所需文档插件”，然后在
Work 模式的 Skill 选择器中选择 Documents、PDF、Presentations 或
Spreadsheets。四个插件由安装包直接携带，不要求另装 Codex 或外部文档工具链。

## 模型配置

在 Artemis 的设置中，按照 OpenCode 中已有的服务配置填写 Base URL、API Key 和模型 ID 等信息，并将消息类型设置为 **Responses (/responses)**。保存配置后，选择对应的提供商和模型即可使用。
