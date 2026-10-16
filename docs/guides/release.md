[English / 简体中文](release-en.md)

# 构建与发布

主程序构建与验证覆盖 Windows x64、macOS arm64 与 macOS x64。CI 使用 GitHub 托管的 `windows-2025`、`macos-15` 与 `macos-15-intel`，覆盖 main push、外部 fork PR 和手动调用。PR 权限只读，不读取签名密钥，不使用 `pull_request_target` 执行贡献者代码。Intel 附件通过原生 x64 runner 的签名、公证和最终归档验收后，才可随正式 Release 公开发布。

macOS CI 与打包任务按架构和锁文件缓存 npm 与 Electron 下载；每个任务仍执行 `npm ci` 和自身所需的构建，不缓存用户数据、签名凭据或验收结果。

## 主程序

Release 工作流只允许从 main 手动启动，`release_tag` 必须等于 package.json 的 `v<version>`，发布说明首行必须匹配。正常发布每次从同一提交重新执行三种目标的 CI；不复用其他提交的验收记录。`publish=false` 运行完整签名、公证、打包与产物汇总验证，但不创建 Release 或更新通道；只有 `publish=true` 才执行发布。

macOS 先签名，再通过短期 Actions artifact 交给公证任务；公证、staple、最终 DMG/ZIP 检查通过后上传明确列出的附件。签名密钥由构建工具临时钥匙串管理，不上传私人钥匙串或中间签名材料到 Release。

arm64 和 x64 在各自原生 runner 上分别构建和验收，包括 PTY、Seatbelt、签名、公证、staple 与回滚。`npm run package:mac:arm64` 和 `npm run package:mac:x64` 选择单一架构；`npm run package:mac` 构建两种架构。汇总器要求两份独立的 macOS 清单，通过摘要验证后合并相同更新通道的附件列表，并重新计算合并元数据的摘要，避免架构间覆盖。

Windows 生成当前用户级 NSIS 安装包和手动 ZIP。NSIS 不请求提权。发布必须配置 `ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`，公钥在 `apps/desktop/resources/update-public-keys.json`。签名索引绑定平台、架构、版本、递增序号和 EXE/ZIP 哈希。`ARTEMIS_UPDATE_SEQUENCE` 来自 Release 工作流 run number；重建工作流或迁移仓库前确认序号不会倒退。

最终附件发布到公共 `EurekaRaider/Artemis`。发布器先检查所有附件摘要并回读上传结果，再公开版本。之后更新独立 `windows-x64-stable` Release 中的签名索引，并下载比对字节。不要用 GitHub 最新 Release 是否含 Windows 附件来判断 Windows 更新。

版本已公开但最后的通道步骤失败时，可直接重跑失败作业。发布前检查会核对 tag 实际指向的源码提交、原产物清单、每个文件的大小和 SHA-256；完全一致才跳过上传并继续通道步骤，不修改公开附件。相同通道字节无需再次上传，同一序号的不同内容或更旧的序号会被拒绝。

如果修复了流水线代码，需要用 main 上的新工具恢复旧运行，可手动启动 Release，设置原版本的 `release_tag`、`publish=true` 和 `resume_run_id=<原 Release 运行编号>`。恢复作业检查原运行来自同仓库 main 的 Release 工作流且已结束、三平台签名和验收及汇总均成功，再下载该运行唯一且未过期的 `verified-release-assets`。版本从原提交读取，公开 tag 和所有附件必须与原提交、原产物完全匹配；不重新构建、签名或生成序号。原产物保留 7 天，过期、缺失、资产不一致或通道已推进到更新序号时停止，不覆盖公开版本或回退通道。此选项仅用于已公开版本；正常发布保持 `resume_run_id` 为空。

必要 Secret：`CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`ARTEMIS_UPDATE_ED25519_PRIVATE_KEY`。附件发布使用本仓库 `GITHUB_TOKEN`，仅发布作业授予 `contents: write`。发布凭据不获得源码 main 规则绕过权限。

## Windows 恢复与轮换

安装前必须下载并验证当前版本的旧安装包，保存 SQLite 一致性快照，并启动安装目录外的恢复助手。运行中任务或未能保存的编辑阻止安装。助手等待旧进程退出，再安装新版；数据库、renderer、IPC 和 agent host 健康确认期限为 120 秒。失败最多回退一次并隔离该版本，不回滚用户项目文件或重放任务副作用。

首个支持 NSIS 的版本提供对应签名索引，供下一次更新准备旧安装包。旧 ZIP 用户需手动安装一次 NSIS；用户数据仍在既有 userData 目录。旧版注册码时代的安装包不能作为新的恢复基线。

密钥轮换分两次发布：先用旧密钥签发含新公钥的客户端，待覆盖后再使用新私钥签发；保持旧公钥直到受支持客户端完成迁移。未知 keyId、错误摘要、降序索引均被拒绝。Ed25519 完整性验证不等于 Authenticode 或 SmartScreen 信誉。

## 能力包

Office 使用 `scripts/office/sources.json` 中的固定版本与 SHA-256；空缓存也能从公开上游构建。候选包通过普通用户安装和预览检查后，作为同次运行的 artifact 传给发布任务。Windows Office 发布要求输入新的不可变版本号。

`office-macos-release.yml` 在 `macos-15-intel` 上构建 Intel Office runtime：下载并核对固定引擎与 SDK，编译 UNO bridge，逐个验证 Mach-O 架构并签名，完成公证和 stapling，再安装最终签名 ZIP，执行 Word、Excel、PowerPoint 样本的编辑、导出与重新打开检查。公开附件后再次验证匿名在线安装，最后提出目录 PR。新增 Intel 清单要求 Artemis `>=1.7.14 <2`；发布前必须先更新宿主版本。使用新的不可变 runtime 版本号，保留现有 arm64 与 Windows 清单。

macOS 运行时排除邮件与 SDK 辅助 shell 脚本 `senddoc`、`unoinfo`，避免普通 ZIP 丢失它们的扩展属性签名；同时排除代码目录中的可选数据库配置 `fbintl.conf`。先签署嵌套代码，最后签署主 bundle；保留真实 Mach-O 的架构校验，并区分共享 `CAFEBABE` 文件头的 Java 资源。

Design 包仅生成 darwin-arm64 和 win32-x64。发布凭据只出现在受信任发布作业。Office 和 Design 目录变更生成 PR，维护者审查合并后客户端才能从目录发现新增能力包；自动化不直接写 main。

Office 和 Design 目录 PR 仍使用 `ARTEMIS_RELEASE_TOKEN`，该令牌需拥有 `EurekaRaider/Artemis` 的 Contents 和 Pull requests 写权限。目录路径为 main 分支上的 `apps/desktop/resources/office-runtime/catalog.json` 和 `apps/desktop/resources/design-plugins/catalog.json`。

已有 Office 签名清单保留原始 URL 字节以维持签名有效；下载器在验签后将精确匹配的旧 Release 前缀映射到 Artemis，仍强制校验附件大小与 SHA-256。在发布使用新源的客户端前，应将不可变 runtime 附件复制到 Artemis 的同名 tag，并保持能力包 Release 的 `--latest=false`。新清单直接使用 Artemis URL 签名。旧客户端仍使用内置的旧更新源，因此应保留旧 Releases；如需自动过渡，还需在旧源发布迁移版本。

Intel 目标放入目录的 `additionalManifests`，新版宿主按相同签名、架构和版本边界验证；旧宿主继续读取原有 `manifests`，避免因不认识 x64 清单而使整个更新检查失败。Computer Use 的版本目录保留三份清单，stable 目录按此兼容格式发布；Office 目录 PR 也保留旧目标和信任根。

## 验收证据

保留同一提交的 CI 链接、最终包哈希、签名/公证结果和安装目录验证。Windows Server 托管 runner 的结果不得写成 Windows 11 桌面人工验收。真实桌面交互、Unicode 安装路径、权限拒绝、进程树清理及无法启动时恢复，必须明确记录实际执行环境和结果。未执行的检查不得标为通过。
