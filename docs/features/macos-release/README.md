# macOS arm64 本机发布与 Apple 签名、公证

源码仓库为私有的 `EurekaRaider/Artemis`。安装包发布到公开的 [EurekaRaider/ArtemisRelease](https://github.com/EurekaRaider/ArtemisRelease/releases)。当前只发布 macOS Apple Silicon（arm64）。

只有手动启动 **Release** 才运行完整 CI/CD。推送、PR、创建标签，以及本地 pre-push 都不会自动启动完整检查。CI 工作流由 Release 调用；独立 PR 审核也改为手动运行。

发布顺序：检查版本和凭据 → 测试、类型检查、构建、格式检查、原生 CLI 与界面验证 → Developer ID 签名 → Apple 公证并将票据附加到应用 → 检查 DMG/ZIP 中的最终应用 → 发布到 ArtemisRelease。缺少证书或任一验证失败都会停止发布。

## 1. 确认开发者会员和 Team ID

在这台 Mac 的浏览器打开 [Apple Developer 账户](https://developer.apple.com/account/)，使用已生效的开发者会员账号登录。

进入会员信息（Membership details），记下 **Team ID**，它是 10 位字母数字标识。后续 `APPLE_TEAM_ID` 使用这个值。`APPLE_ID` 使用该开发者账号的登录邮箱。

## 2. 在 Mac 上生成证书请求

1. 按 `Command + 空格`，搜索并打开 **钥匙串访问（Keychain Access）**。
2. 点击屏幕顶部菜单 **钥匙串访问 → 证书助理 → 从证书颁发机构请求证书**。
3. 填写“用户电子邮件地址”为开发者账号邮箱。
4. “常用名称”可填 `Artemis Developer ID`，它用于标识本机密钥。
5. “CA 电子邮件地址”留空。
6. 选择 **存储到磁盘（Saved to disk）**，保存到桌面，文件名可用 `Artemis.certSigningRequest`。

这个操作会在本机生成配对的私钥。后续安装证书和导出操作继续在同一台 Mac 上进行。

参考：[Apple 创建 CSR 指南](https://developer.apple.com/help/account/certificates/create-a-certificate-signing-request/)。

## 3. 申请 Developer ID Application 证书

1. 打开 [Apple 证书管理](https://developer.apple.com/account/resources/certificates/list)。
2. 点击 **+** 创建证书。
3. 选择 **Developer ID Application**。这个类型用于 GitHub 等渠道分发的 Mac 应用；`Developer ID Installer` 用于安装器 PKG，`Apple Distribution` 用于其他分发流程。
4. 点击 Continue，上传第 2 步保存的 `.certSigningRequest`。
5. 完成申请，点击 Download 下载 `.cer` 文件。
6. 打开钥匙串访问，选择 **文件 → 导入项目**，选中下载的 `.cer`。在导入窗口的“选项”中明确将目标钥匙串设为 **登录（login）**，然后导入。这样可避免双击文件时使用错误的默认目标。
7. 回到钥匙串访问，选择“登录”钥匙串和“我的证书”，找到 `Developer ID Application: 你的名称 (TEAMID)`。
8. 展开证书左侧箭头，确认下面有一项**私钥**。

可以在终端检查证书是否可用于签名：

```bash
security find-identity -v -p codesigning
```

应看到 `Developer ID Application` 和至少一个有效身份。如果只有证书、没有私钥，应回到生成 CSR 的那台 Mac；单独下载 `.cer` 无法替代私钥。

参考：[Apple Developer ID 证书指南](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)、[Apple 对导入错误 -25294 的处理建议](https://developer.apple.com/forums/thread/675290)。

## 4. 导出包含私钥的 P12 文件

1. 在钥匙串访问的“我的证书”中选中刚创建的 Developer ID Application 证书。
2. 点击 **文件 → 导出项目**，或右键选择导出。
3. 格式选择 **个人信息交换（.p12）**。
4. 保存到桌面，名称使用 `Artemis-Developer-ID.p12`。
5. 为这个 P12 设置一个非空的强密码并保存好。这个密码就是之后的 `CSC_KEY_PASSWORD`。
6. 如果系统要求授权导出私钥，输入当前 Mac 用户的登录密码。

P12 导出密码、Mac 登录密码、Apple 账号密码是三种不同用途的凭据。`.p12` 包含私钥，不要提交到任何仓库，也不要粘贴到聊天中。

## 5. 生成 Apple 公证专用密码

1. 打开 [Apple Account](https://account.apple.com/)，登录同一个开发者账号。
2. 进入 **登录与安全性 → App 专用密码（App-Specific Passwords）**。
3. 点击生成，名称可填 `Artemis GitHub Notarization`。
4. 复制生成的专用密码，后续保存为 `APPLE_APP_SPECIFIC_PASSWORD`。

使用此功能需要账号开启双重认证。这里填写 App 专用密码，不填写 Apple 账号的日常登录密码。

参考：[Apple App 专用密码说明](https://support.apple.com/en-us/102654)。

## 6. 准备发布库专用 Token

源码仓库的默认 `GITHUB_TOKEN` 只服务于当前仓库；跨仓库发布需要额外凭据。

1. 使用拥有 `EurekaRaider/ArtemisRelease` 的 GitHub 账号登录。
2. 打开 [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens)。
3. 点击 **Generate new token**，名称可填 `Artemis Release Publisher`。
4. Resource owner 选择 `EurekaRaider`。
5. Repository access 选择 **Only select repositories**，只勾选 `ArtemisRelease`。
6. Repository permissions 中设置 **Contents: Read and write**；Metadata 保持默认只读。
7. 按维护周期设置有效期，生成后复制 Token，保存为后续的 `ARTEMIS_RELEASE_TOKEN`。

如果当前登录账号无法选择这个资源所有者，请切换到发布库拥有者账号。这个 Token 不需要源码仓库的写入权限。

## 7. 把六项凭据放到源码仓库 Secrets

打开 [Artemis 的 Actions Secrets](https://github.com/EurekaRaider/Artemis/settings/secrets/actions)。位置是：

**源码仓库 Artemis → Settings → Secrets and variables → Actions → New repository secret**。

这些 Secrets 添加到 **Artemis**，因为工作流运行在这里。

| Name | Secret 填写内容 |
| --- | --- |
| `CSC_LINK` | P12 文件编码后的 Base64 完整内容 |
| `CSC_KEY_PASSWORD` | 第 4 步导出 P12 时设置的密码 |
| `APPLE_ID` | Apple Developer 会员账号的登录邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 第 5 步生成的 App 专用密码 |
| `APPLE_TEAM_ID` | 第 1 步记下的 10 位 Team ID |
| `ARTEMIS_RELEASE_TOKEN` | 第 6 步生成的发布库专用 Token |

填写 `CSC_LINK` 前，在这台 Mac 的终端执行：

```bash
base64 -i "$HOME/Desktop/Artemis-Developer-ID.p12" | tr -d '\n' | pbcopy
```

命令不会把证书打印在终端，编码内容会进入剪贴板。回到 GitHub 新建 `CSC_LINK`，在 Secret 框中按 `Command + V`，然后 Add secret。这里填写的是完整 Base64 内容，不是文件名或本机路径。

逐项添加其余五个 Secret。保存后 GitHub 不再显示值，这是正常行为；填错时通过 Update secret 更新。不要把证书内容、密码或 Token 发到聊天中。

参考：[GitHub Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[electron-builder CI 签名配置](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/github-actions.md)。本仓库使用的五个 Apple 变量名以本表为准。

## 8. 确认本机 runner 在线

本机 runner 目录：`~/actions-runner/artemis-macos-arm64`；名称与自定义标签都是 `artemis-macos-arm64`，另有默认标签 `self-hosted`、`macOS`、`ARM64`。

打开 [Artemis Runners](https://github.com/EurekaRaider/Artemis/settings/actions/runners)，应看到 runner 为 **Idle**。本机也可以检查：

```bash
cd "$HOME/actions-runner/artemis-macos-arm64"
./svc.sh status
```

如果服务未启动：

```bash
./svc.sh start
```

它是当前用户的登录后台服务。运行 Release 时，这台 Mac 需要开机、联网、保持用户登录并避免睡眠；界面测试也需要当前桌面会话。runner 使用独立工作目录检出源码，不在日常开发目录直接构建。

## 9. 只有需要发布时才启动 Release

先把待发布的源码和工作流提交、推送到源码仓库的 `main`。普通推送不会自动运行 CI。

1. 打开 [Artemis Release 工作流](https://github.com/EurekaRaider/Artemis/actions/workflows/release.yml)。
2. 点击 **Run workflow**。
3. 选择 `main`。
4. 在 `release_tag` 填入版本，例如 `v1.6.0`。它必须等于根目录 `package.json` 的版本加上 `v` 前缀，且不能与已发布版本重复。
5. 点击绿色 **Run workflow**，这是本次正式发布的启动操作。

也可以在源码项目根目录用命令启动：

```bash
artemis_release_tag="v$(node -p 'require("./package.json").version')"
gh workflow run release.yml \
  --repo EurekaRaider/Artemis \
  --ref main \
  -f release_tag="$artemis_release_tag"
```

不需要通过推送标签来启动发布。工作流成功后会在公开发布库创建对应标签和 Release。

## 10. 查看执行结果和安装包

在源码仓库 Actions 中查看这次 Release：

1. **Validate release version and credentials**：版本、Apple 凭据、发布 Token 检查。
2. **Release CI**：完整源码检查、arm64 原生 CLI 和界面验证。
3. **Sign and notarize macOS arm64**：签名、公证、原生运行边界和最终 DMG/ZIP 校验。
4. **Publish to ArtemisRelease**：上传经过校验的产物。

全部通过后，打开 [ArtemisRelease Releases](https://github.com/EurekaRaider/ArtemisRelease/releases)。应包含：

- `Artemis-macOS-arm64-版本.dmg`
- `Artemis-macOS-arm64-版本.zip`
- 更新元数据、构建生成的 blockmap 和校验清单。

发布库不接收源码检出内容；GitHub 自动生成的 Source code 归档只对应发布库自身的 README 等文件。

从 Release 下载 DMG，拖入“应用程序”，再检查最终安装的应用：

```bash
codesign --verify --deep --strict "/Applications/Artemis.app"
codesign -dv --verbose=4 "/Applications/Artemis.app" 2>&1
spctl --assess --type execute --verbose=4 "/Applications/Artemis.app"
xcrun stapler validate "/Applications/Artemis.app"
```

签名详情应显示 `Authority=Developer ID Application: ...` 和自己的 Team ID；Gatekeeper 应接受该应用，公证票据验证应成功。最后正常启动应用，验证实际下载、安装与启动链路。单凭 Secrets 已配置或工作流文件存在，不代表首次正式公证已经成功。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 导入 `.cer` 报错 `-25294` | 该错误表示找不到指定的钥匙串。使用“钥匙串访问 → 文件 → 导入项目”，在选项中明确选择“登录”钥匙串后重试。 |
| `missing environment variables` | 对照第 7 步核对 Secret 名称和值；添加到源码仓库 Artemis。 |
| 找不到签名身份或 P12 无法导入 | 检查 `.p12` 是否包含私钥、导出密码是否正确、证书是否为 Developer ID Application。 |
| Apple 验证失败 | 核对开发者邮箱、Team ID、App 专用密码。 |
| 公证等待时间较长 | 查看打包步骤中的 Apple 提交状态；只有 Accepted 并通过票据验证后才能发布。 |
| Apple 公证被拒绝 | 根据本次提交日志定位具体文件；不要关闭公证或改为临时签名绕过。 |
| 上传 Release 返回 403/404 | 检查 `ARTEMIS_RELEASE_TOKEN` 的有效期、资源所有者、目标仓库和 Contents 写权限。 |
| Job 一直等待 runner | 检查本机是否在线、登录、唤醒以及 runner 的标签与服务状态。 |
| 已存在相同版本 | 正常提升项目版本后再发布，避免覆盖用户已经下载的产物。 |

更改 Apple 主密码会使已有 App 专用密码失效；此时重新生成并更新 `APPLE_APP_SPECIFIC_PASSWORD`。证书和 Token 到期前也应更新。
