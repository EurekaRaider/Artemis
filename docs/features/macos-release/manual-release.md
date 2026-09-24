# macOS 手动发布到 ArtemisRelease

适用于在 Mac 上发布 Apple Silicon（arm64）正式版。所有命令默认在 **Artemis 源码仓库根目录**执行。源码保持私有，公开仓库只接收安装包和更新元数据。本文命令不会启动 GitHub Actions。

## 0. 正式数据目录与更新源

正式源码没有测试目录覆盖设置。正常从 Finder 启动正式包，继续使用：

```text
~/Library/Application Support/@artemis/desktop/
```

其中 `artemis.sqlite` 保存历史数据，其他配置和附件也在该目录下。不要删除、移动这个目录，不要复制之前测试版的用户数据。安装时退出旧版，再把新 App 放进“应用程序”；替换 App 不需要清除历史数据。建议发布和首次安装前备份该目录，备份时先退出 Artemis。

此前临时测试包使用的固定目录和临时更新仓库只存在于临时构建副本中。**从当前正式源码重新构建**，不要沿用测试 DMG、ZIP 或 `.app`，也不要用带 `--user-data-dir` 参数的测试启动脚本。

在本次发布终端中明确设置正式更新源，避免环境变量覆盖本机签名配置：

```bash
cd "$HOME/Documents/GitHub/Artemis"
unset ARTEMIS_UPDATE_URL ARTEMIS_UPDATE_CHANNEL
unset ARTEMIS_DEV_SERVER_URL ELECTRON_RUN_AS_NODE
export ARTEMIS_UPDATE_OWNER=EurekaRaider
export ARTEMIS_UPDATE_REPO=ArtemisRelease
export ARTEMIS_UPDATE_CHANNEL=latest
export ARTEMIS_STAGING_PERCENTAGE=100
```

## 1. 一次性准备

需要 Node.js 24+、npm 11+、GitHub CLI、Xcode 命令行工具、含私钥的 Developer ID Application 证书，以及可用的 Apple 开发者会员。

```bash
node --version
npm --version
xcode-select -p
security find-identity -v -p codesigning
gh auth status
```

如果 GitHub 未登录，运行 `gh auth login`，登录对 `EurekaRaider/ArtemisRelease` 有 Contents 写权限的账号。

这台 Mac 已完成签名配置时无需重复设置。换电脑或凭据失效时运行：

```bash
npm run setup:mac-signing
```

按终端提示选择证书、填写 Apple 开发者邮箱和 **App 专用密码**。公证凭据保存在钥匙串 profile `Artemis-notarization`；非敏感配置在 `~/Library/Application Support/Artemis/build/macos-signing.json`。不要把密码、证书私钥或 Token 写进源码、发布说明或公开资产。

```bash
xcrun notarytool history --keychain-profile Artemis-notarization
```

成功返回历史记录表示 Apple 凭据和当前网络可用。

## 2. 确认源码与版本

```bash
git status --short
git log -1 --oneline
gh release list --repo EurekaRaider/ArtemisRelease --limit 10
```

确认要发布的改动已提交并推送。新版本必须高于用户当前版本，不能重复覆盖已公开版本；根目录、所有 workspace 的 `package.json` 及内部依赖版本应保持一致。下面示例版本号仅供替换，先按远端已有版本选择一个未发布的新版本。

如需统一升版，在根目录执行以下代码，随后检查差异并提交版本变更：

```bash
export ARTEMIS_RELEASE_VERSION=1.6.3 # 改成此次实际版本
node --input-type=module <<'NODE'
import fs from 'node:fs';
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = process.env.ARTEMIS_RELEASE_VERSION;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('请输入稳定版版本号');
const files = ['package.json', ...root.workspaces.map(p => `${p}/package.json`)];
const packages = files.map(p => [p, JSON.parse(fs.readFileSync(p, 'utf8'))]);
const names = new Set(packages.map(([, p]) => p.name));
for (const [file, pkg] of packages) {
  pkg.version = version;
  for (const kind of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkg[kind] ?? {})) {
      if (names.has(name)) pkg[kind][name] = version;
    }
  }
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
NODE
npm install --package-lock-only
git diff --stat
```

不要仅修改安装包文件名，App 内版本号和更新描述文件也必须一致。升版后安装依赖并运行发布前检查；任一命令失败都先停止排查：

```bash
npm ci
npm test
npm run typecheck
npm run format:check
```

## 3. 构建、签名与公证

推荐分两步，方便观察进度和重试：

```bash
npm run sign:mac:arm64
```

这一步重新编译，生成使用 Developer ID 签名的 `.app`、DMG、ZIP，但尚未公证。它会联网核对 Slack CLI 上游版本；如果检查失败，修复原因再继续。第一次使用私钥时，macOS 可能要求你在钥匙串授权窗口输入登录密码。

签名成功后执行：

```bash
npm run notarize:mac:arm64
```

这一步使用现有同版本已签名 `.app`，提交 Apple，等待 `Accepted`，附加公证票据，再重新生成 DMG、ZIP、blockmap、`latest-mac.yml` 和 `release-manifest.json`。**上传公证后重新生成的文件**。

如果希望一次完成，用下面命令代替上面两条：

```bash
npm run release:mac:arm64
```

不需要再额外执行 `package:mac:arm64`；那条命令生成工程包，不是正式发布流程。上述命令不会上传 GitHub，但公证阶段会将 App 提交 Apple。不要并行运行两次打包，也不要在公证后修改 `.app` 内容。

如果以前的 `apps/desktop/release` 留有其他版本或架构文件，打包前先把整个目录移到仓库外备份，再生成本次产物，避免旧元数据混入清单。

## 4. 检查最终产物

```bash
artemis_version="$(node -p 'require("./apps/desktop/package.json").version')"
artemis_tag="v${artemis_version}"
artemis_output="$PWD/apps/desktop/release"
artemis_app="$artemis_output/mac-arm64/Artemis.app"
codesign --verify --deep --strict --verbose=2 "$artemis_app"
codesign -dv --verbose=4 "$artemis_app"
xcrun stapler validate "$artemis_app"
spctl --assess --type execute --verbose=4 "$artemis_app"
cat "$artemis_app/Contents/Resources/app-update.yml"
npm run verify:mac-native -w @artemis/desktop
```

应看到 Developer ID 身份、公证票据校验成功、Gatekeeper 接受。`app-update.yml` 必须是 `owner: EurekaRaider`、`repo: ArtemisRelease`、`provider: github`、`channel: latest`，不能包含临时测试仓库。其中 `releaseType: draft` 是构建时的发布配置，不表示运行时只能检查草稿。

再次检查 ZIP 内的最终 App，避免只验证了未压缩构建目录：

```bash
artemis_verify="$(mktemp -d /tmp/artemis-release-verify.XXXXXX)"
ditto -x -k "$artemis_output/Artemis-macOS-arm64-${artemis_version}.zip" "$artemis_verify"
codesign --verify --deep --strict "$artemis_verify/Artemis.app"
xcrun stapler validate "$artemis_verify/Artemis.app"
spctl --assess --type execute --verbose=4 "$artemis_verify/Artemis.app"
```

这些验证失败时不要上传发布。ZIP 是 macOS 应用内更新的必需资产，不能只上传 DMG。正式包是标准数据目录；验证包不要用修改源码的方式切换测试目录。

## 5. 创建 GitHub 草稿并上传

先写本次公开发布说明；只填写用户可见改动，不包含私有源码、账号配置或测试数据：

```bash
artemis_notes="$(mktemp /tmp/artemis-release-notes.XXXXXX)"
open -e "$artemis_notes"
```

编辑并保存后，在同一终端执行。`--repo` 明确指向公开发布库，不依赖当前 git remote：

```bash
gh release create "$artemis_tag" \
  --repo EurekaRaider/ArtemisRelease \
  --draft --title "Artemis ${artemis_version}" \
  --notes-file "$artemis_notes"

gh release upload "$artemis_tag" \
  --repo EurekaRaider/ArtemisRelease \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.dmg" \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.zip" \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.dmg.blockmap" \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.zip.blockmap" \
  "$artemis_output/latest-mac.yml" \
  "$artemis_output/release-manifest.json"
```

此时仍是草稿，普通用户不会检查到它。标签属于 `ArtemisRelease` 仓库；不需要将私有源码推到发布库，也不要把私有源码 commit SHA 用作发布库的 `--target`。

上传前确认上面六个文件都存在。上传中断时先用下方命令看已成功的资产，再仅上传缺失文件。不要直接用 `--clobber` 覆盖已公开版本。

```bash
gh release view "$artemis_tag" --repo EurekaRaider/ArtemisRelease \
  --json isDraft,assets --jq '{isDraft,assets:[.assets[]|{name,size,digest}]}'
```

核对六个资产齐全、大小正确，GitHub 的 `digest` 为 `sha256:…`。本地可逐一计算 SHA256，对照远端输出；`release-manifest.json` 内也包含其他资产的摘要：

```bash
shasum -a 256 \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.dmg" \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.zip" \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.dmg.blockmap" \
  "$artemis_output/Artemis-macOS-arm64-${artemis_version}.zip.blockmap" \
  "$artemis_output/latest-mac.yml" \
  "$artemis_output/release-manifest.json"
```

## 6. 确认后公开发布

**下面这条命令会公开该版本并标为 Latest，现有用户随后可检查到更新。** 确认前面的检查全部通过再运行：

```bash
gh release edit "$artemis_tag" --repo EurekaRaider/ArtemisRelease \
  --draft=false --latest
```

正式版启动完成约 5 秒后自动检查，之后在应用运行期间每小时检查一次。网络失败会记录诊断并等待后续检查；下载中或等待安装时不会重新检查打断当前流程。完全退出应用后不检查，电脑休眠期间不保证准点执行。

发布后检查匿名更新源：

```bash
curl -fL "https://github.com/EurekaRaider/ArtemisRelease/releases/download/${artemis_tag}/latest-mac.yml" \
  -o "$artemis_verify/remote-latest-mac.yml"
cmp "$artemis_output/latest-mac.yml" "$artemis_verify/remote-latest-mac.yml"
gh release view "$artemis_tag" --repo EurekaRaider/ArtemisRelease --web
```

`cmp` 无输出且退出码为 0 表示内容一致。从公开 Release 页面下载最终 DMG，安装后正常启动，核对版本及原有对话。再用较旧正式版验证：检查更新 → 蓝色圆圈下载箭头 → 下载进度 → 蓝色“安装更新”按钮 → 点击后安装、重启 → 完成提示。

更新成功并确认新版启动后，代码会清理对应的下载缓存和过期恢复包；仅保留当前正常版本的一份恢复包供下一次升级失败时回退。用户历史、附件、配置不属于更新缓存。旧版若尚未包含手动安装按钮逻辑，下载阶段显示的是旧版自己的界面；新界面需先安装包含该改动的版本。

## 7. 晚上操作时常见的中断

| 情况                                          | 处理                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apple 已 `Accepted`，但 stapler 出现 TLS 错误 | 切换网络或代理节点，保证 `api.apple-cloudkit.com` 可访问；再执行 `xcrun stapler validate "$artemis_app"`。只验证成功仍不足以证明旧 ZIP 已附加票据；可重跑 `npm run notarize:mac:arm64` 重新生成最终资产。 |
| 公证 `Invalid`                                | 运行 `xcrun notarytool log <提交ID> --keychain-profile Artemis-notarization`，修复后重新签名、公证。                                                                                                      |
| 中断后不知道 Apple 是否完成                   | `xcrun notarytool history --keychain-profile Artemis-notarization`；不要把排队或 `In Progress` 当作成功。                                                                                                 |
| GitHub 上传 403/404                           | 检查 `gh auth status`、账号对发布库的 Contents 写权限，以及是否有环境 Token 覆盖了 gh 登录；不要打印 Token。                                                                                              |
| 安装后像全新账号                              | 先退出，确认使用正式包且没有 `--user-data-dir` 参数；不要删除原数据库或重新初始化历史。                                                                                                                   |
| 新终端里变量不见了                            | 重跑第 0 节环境设置及第 4 节版本、路径变量，不必因此重新构建已验证的包。                                                                                                                                  |

本指南不代表已经完成本次真实签名、公证或发布。每次发布需保存当次产物验证结果；arm64 成功不代表 Intel 已验收。Intel 构建可用对应 `:x64` 脚本，但应在 Intel Mac 上完成原生验证；不要用两次独立打包覆盖 `latest-mac.yml` 后就宣称双架构发布完成。

参考：[现有签名与公证配置指南](README.md)、[GitHub 创建 Release](https://cli.github.com/manual/gh_release_create)、[上传资产](https://cli.github.com/manual/gh_release_upload)、[公开草稿](https://cli.github.com/manual/gh_release_edit)。
