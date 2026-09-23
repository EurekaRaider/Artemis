# macOS arm64 本机发布与 Apple 签名、公证

本机逐步操作、上传草稿并发布到 ArtemisRelease，请看 [手动发布操作指南](manual-release.md)。

源码仓库为私有的 `EurekaRaider/Artemis`。安装包发布到公开的 [EurekaRaider/ArtemisRelease](https://github.com/EurekaRaider/ArtemisRelease/releases)。当前只发布 macOS Apple Silicon（arm64）。

只有手动启动 **Release** 才运行完整 CI/CD。推送、PR、创建标签，以及本地 pre-push 都不会自动启动完整检查。CI 工作流由 Release 调用；独立 PR 审核也改为手动运行。

发布顺序：检查版本和凭据 → 测试、类型检查、构建、格式检查、原生 CLI 与界面验证 → Developer ID 签名 → Apple 公证并将票据附加到应用 → 检查 DMG/ZIP 中的最终应用 → 发布到 ArtemisRelease。缺少证书或任一验证失败都会停止发布。

## 本机一次配置与分阶段打包

在仓库根目录运行 `npm run setup:mac-signing`，选择 Developer ID 证书，输入 Apple 开发者邮箱和 **App 专用密码**。凭据由 Apple 验证后保存到 macOS 钥匙串；非敏感配置保存在 `~/Library/Application Support/Artemis/build/macos-signing.json`，打开新终端后仍然有效，不需要导出 P12 或重复设置环境变量。

| 命令 | 行为 |
| --- | --- |
| `npm run package:mac:arm64` | 本地调试工程包，不使用正式签名或公证 |
| `npm run sign:mac:arm64` | 重新构建并使用 Developer ID 签名，不提交公证 |
| `npm run notarize:mac:arm64` | 公证现有同版本已签名 `.app`，附加票据后重新生成 DMG、ZIP 和更新元数据；不重新编译源码 |
| `npm run release:mac:arm64` | 一条龙：构建、签名、公证、附加票据、生成 DMG/ZIP、验证 |

将 `:arm64` 换成 `:x64` 可构建 Intel 版本；去掉架构后缀则处理两种架构。单独公证前必须保留 `apps/desktop/release/mac-arm64/Artemis.app`（Intel 为 `release/mac/Artemis.app`），且版本需与当前源码一致。最终产物位于 `apps/desktop/release/`。这些命令不会上传到 GitHub Releases；只有公证阶段将应用提交到 Apple。

工程打包不加载签名设置；正式流程遇到凭据、签名或公证错误会失败，不会退回工程包。CI 继续使用工作流环境变量，不读取本机配置。已有证书但尚未设置公证凭据时，可以先设置 `CSC_NAME`、`ARTEMIS_UPDATE_OWNER`、`ARTEMIS_UPDATE_REPO` 环境变量运行只签名命令。

### 首次配置

1. 确认钥匙串中有带私钥的 **Developer ID Application** 证书，且已安装 Xcode 命令行工具。
2. 在 [Apple 账户](https://account.apple.com/) 的“登录和安全 → App 专用密码”生成一个密码；不是 Apple 账号日常登录密码。
3. 在项目根目录运行：

   ```bash
   npm run setup:mac-signing
   ```

4. 只有一张证书时自动选中；有多张时输入编号。输入开发者邮箱，然后在终端的隐藏输入提示中输入 App 专用密码。
5. 看到“已保存长期配置”即完成。公证 profile 名称固定为 `Artemis-notarization`。账号密码不会写进项目、本机 JSON 或 shell 启动文件。

签名证书由系统钥匙串管理，公证凭据由 `notarytool` 保存到钥匙串。非敏感 JSON 只包含签名身份、公证 profile 名称和更新仓库 `EurekaRaider/ArtemisRelease`。重开终端或更新源码后仍然生效；更换证书、撤销 App 专用密码或换电脑后需重新执行设置。CI 使用单独的 Secrets。

### 流程 A：本地调试

```bash
npm run package:mac:arm64
```

它构建工程包，允许本地测试，不读取上述签名配置，不提交 Apple 公证。工程包可能使用 ad-hoc 签名，不代表已经获得 Developer ID 签名或 Apple 公证。项目现有的 Slack CLI 上游版本校验仍需联网。

### 流程 B：签名与公证分开执行

第一步，只签名并生成安装包：

```bash
npm run sign:mac:arm64
```

流程为检查签名配置 → 校验 Slack CLI → 编译 → 打包应用与组件 → 使用 Developer ID 签名 → 生成 DMG/ZIP → 验证签名。该步骤明确关闭自动公证，不等待 Apple 审核，也不要求公证凭据可用。macOS 首次使用私钥时可能弹出钥匙串授权窗口。

第二步，准备分发时公证现有签名产物：

```bash
npm run notarize:mac:arm64
```

流程为检查公证凭据 → 校验 Slack CLI → 验证 `.app` 签名和版本 → 压缩并提交 Apple → 等待 `Accepted` → 将票据附加到 `.app` → 重新生成包含该应用的 DMG/ZIP 与更新元数据 → 验证签名、公证票据及 Gatekeeper → 生成发布清单。

此步骤不重新编译源码。它读取 `release/mac-arm64/Artemis.app`，不是给任意旧 DMG 加一个标记；没有原始 `.app`、只有工程包、或应用版本与当前 `package.json` 不一致时，先重新运行只签名命令。公证会覆盖同版本的 DMG/ZIP，分发时使用最后生成的文件。两个架构一起公证时，更新元数据会保留两种架构。

### 流程 C：一条龙正式打包

```bash
npm run release:mac:arm64
```

该命令重新编译并自动完成签名、公证、票据附加、DMG/ZIP 生成与验证，无需再运行前两条命令。Apple 凭据、签名、公证、Gatekeeper 或 Slack CLI 检查失败都会停止，不会以工程包替代正式包。Apple 处理时间不固定，命令会等待处理结果。

本地这些命令只执行打包及针对产物的检查，不等同于完整 Release CI：正式对外发布前仍需按项目发布要求完成完整测试、原生运行验证和下载安装验证。

### 产物与检查

所有路径均相对项目根目录，版本号由 `apps/desktop/package.json` 决定：

- `apps/desktop/release/mac-arm64/Artemis.app`：应用；Intel 版本位于 `release/mac/`。
- `apps/desktop/release/Artemis-macOS-arm64-<version>.dmg`：安装镜像。
- `apps/desktop/release/Artemis-macOS-arm64-<version>.zip`：应用压缩包。
- `apps/desktop/release/latest-mac.yml`、相关 blockmap 和 `release-manifest.json`：更新信息和校验清单。

公证票据附加在 **应用** 上，DMG 和 ZIP 中包含这个已附加票据的应用；这些命令不会额外为外层 DMG 单独申请公证票据。公证后不要再修改 `.app` 内容，否则需要重新签名、公证。

可手动复核：

```bash
codesign --verify --deep --strict --verbose=2 apps/desktop/release/mac-arm64/Artemis.app
codesign -dv --verbose=4 apps/desktop/release/mac-arm64/Artemis.app
xcrun stapler validate apps/desktop/release/mac-arm64/Artemis.app
spctl --assess --type execute --verbose=4 apps/desktop/release/mac-arm64/Artemis.app
```

签名信息应包含 `Authority=Developer ID Application:`、对应 Team ID 和 Hardened Runtime；票据校验成功，Gatekeeper 显示接受。发布后还需在另一台 Mac 通过浏览器下载最终 DMG、拖入 Applications 并启动，不能用移除 quarantine 的方式替代验证。

### 失败与重试

| 情况 | 处理 |
| --- | --- |
| 找不到有效签名身份 | 检查登录钥匙串中的证书、私钥及有效期，重新执行 `setup:mac-signing` |
| 公证 profile 不存在或认证失败 | 重新执行 `setup:mac-signing`，用有效 App 专用密码完成 Apple 校验 |
| GitHub API 返回 403 | 正式本地命令会尝试复用已有 `gh auth login` 登录；也可在终端提供 `GITHUB_TOKEN`。检查真实错误，不跳过 Slack CLI 门禁 |
| Apple 返回 `Invalid` | 用下方命令查看提交日志；修复签名或组件问题后重新只签名，再公证 |
| 网络中断或等待被中止 | 先查看 `notarytool history`；可重跑 `notarize:mac:arm64`，无需重新编译未修改的应用 |
| 票据附加或 Gatekeeper 验证失败 | 保留报错和提交 ID，排查后重跑独立公证；不要把该次流程当成成功 |

```bash
xcrun notarytool history --keychain-profile Artemis-notarization
xcrun notarytool log <提交ID> --keychain-profile Artemis-notarization
```

配置完成后，日常使用三条命令即可：`sign:mac:arm64`、`notarize:mac:arm64`、`release:mac:arm64`。它们均不发布 GitHub Release，不需要发布仓库写入 Token；正式本地命令读取 GitHub 登录凭据仅用于现有的 Slack CLI 上游校验。

以下步骤供首次申请证书及配置 GitHub Actions 使用。

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

1. 打开 [Apple 账户管理页面](https://account.apple.com/)，登录同一个开发者账号。这一步的入口在 `account.apple.com`，申请证书时使用的 Apple Developer 后台没有这个入口。
2. 进入 **登录和安全（Sign-In and Security）→ App 专用密码（App-Specific Passwords）**。
3. 点击 **生成 App 专用密码**，名称可填 `Artemis GitHub Notarization`。
4. 复制生成的专用密码，后续保存为 `APPLE_APP_SPECIFIC_PASSWORD`。

使用此功能需要账号开启双重认证。这里填写 App 专用密码，不填写 Apple 账号的日常登录密码。

参考：[Apple App 专用密码说明](https://support.apple.com/zh-cn/102654)。

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
