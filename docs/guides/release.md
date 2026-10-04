# 构建与发布

仅支持 Windows x64 和 macOS arm64。CI 使用 GitHub 托管的 `windows-2025` 与 `macos-15`，覆盖 main push、外部 fork PR 和手动调用。PR 权限只读，不读取签名密钥，不使用 `pull_request_target` 执行贡献者代码。

## 主程序

Release 工作流只允许从 main 手动启动，`release_tag` 必须等于 package.json 的 `v<version>`，发布说明首行必须匹配。每次从同一提交重新执行双平台 CI；不复用其他提交的验收记录。

macOS 先签名，再通过短期 Actions artifact 交给公证任务；公证、staple、最终 DMG/ZIP 检查通过后上传明确列出的附件。签名密钥由构建工具临时钥匙串管理，不上传私人钥匙串或中间签名材料到 Release。

Windows 生成当前用户级 NSIS 安装包和手动 ZIP。NSIS 不请求提权。发布必须配置 `ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`，公钥在 `apps/desktop/resources/update-public-keys.json`。签名索引绑定平台、架构、版本、递增序号和 EXE/ZIP 哈希。`ARTEMIS_UPDATE_SEQUENCE` 来自 Release 工作流 run number；重建工作流或迁移仓库前确认序号不会倒退。

最终附件继续发布到公共 `EurekaRaider/ArtemisRelease`。发布器先检查所有附件摘要并回读上传结果，再公开版本。之后更新独立 `windows-x64-stable` Release 中的签名索引，并下载比对字节。不要用 GitHub 最新 Release 是否含 Windows 附件来判断 Windows 更新。

必要 Secret：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`ARTEMIS_RELEASE_TOKEN`、`ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`。发布凭据不获得源码 main 规则绕过权限。

## Windows 恢复与轮换

安装前必须下载并验证当前版本的旧安装包，保存 SQLite 一致性快照，并启动安装目录外的恢复助手。运行中任务或未能保存的编辑阻止安装。助手等待旧进程退出，再安装新版；数据库、renderer、IPC 和 agent host 健康确认期限为 120 秒。失败最多回退一次并隔离该版本，不回滚用户项目文件或重放任务副作用。

首个支持 NSIS 的版本提供对应签名索引，供下一次更新准备旧安装包。旧 ZIP 用户需手动安装一次 NSIS；用户数据仍在既有 userData 目录。旧版注册码时代的安装包不能作为新的恢复基线。

密钥轮换分两次发布：先用旧密钥签发含新公钥的客户端，待覆盖后再使用新私钥签发；保持旧公钥直到受支持客户端完成迁移。未知 keyId、错误摘要、降序索引均被拒绝。Ed25519 完整性验证不等于 Authenticode 或 SmartScreen 信誉。

## 能力包

Office 使用 `scripts/office/sources.json` 中的固定版本与 SHA-256；空缓存也能从公开上游构建。候选包通过普通用户安装和预览检查后，作为同次运行的 artifact 传给发布任务。Windows Office 发布要求输入新的不可变版本号。

Design 包仅生成 darwin-arm64 和 win32-x64。发布凭据只出现在受信任发布作业。Office 和 Design 目录变更生成 PR，维护者审查合并后客户端才能从目录发现新增能力包；自动化不直接写 main。

## 验收证据

保留同一提交的 CI 链接、最终包哈希、签名/公证结果和安装目录验证。Windows Server 托管 runner 的结果不得写成 Windows 11 桌面人工验收。真实桌面交互、Unicode 安装路径、权限拒绝、进程树清理及无法启动时恢复，必须明确记录实际执行环境和结果。未执行的检查不得标为通过。
