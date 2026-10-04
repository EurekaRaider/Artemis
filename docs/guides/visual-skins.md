[English / 简体中文](visual-skins-en.md)

# 视觉皮肤插件开发

Artemis 原生插件可以贡献 Skin v1 配色包或 Skin v2 完整视觉包。皮肤可以改变配色、静态和静音视频背景、字体、语义图标及宿主预设动效，保留组件、布局与业务交互。皮肤不执行插件代码，也不下载远程资源。

## 原生插件清单

```json
{
  "schemaVersion": 1,
  "name": "ocean-visual-skins",
  "version": "1.0.0",
  "interface": { "displayName": "Ocean Skins", "category": "Design" },
  "skins": ["./skins/ocean.artemis-skin/"]
}
```

保存为 `artemis.plugin.json`。`skins` 可省略，声明时最多 32 项，只读取声明的目录。纯皮肤插件和包含 Skill、MCP、Hooks 的混合插件使用同一套安装、更新、启停和卸载流程。安装后在设置中选择皮肤，安装操作本身不会切换外观。

皮肤 ID 在安装目录中唯一。同一个插件身份可以重新安装或更新同一个 ID；另一个插件声明该 ID 时拒绝提交，保留原插件。插件身份由名称和来源确定；移动本地来源或改变 Git 来源可能产生新身份。关闭插件后暂用默认皮肤并保留选择，重新启用后恢复；卸载或更新删除所选 ID 时清除选择。旧格式待迁移插件不会提供可用皮肤。皮肤启用不授予 Connector、Hooks 或可执行扩展的权限。

## Skin v2 文件与配置

```text
skins/ocean.artemis-skin/
  manifest.json
  tokens.light.json
  tokens.dark.json
  tokens.contrast.json   # 声明 high 时必需
  icons.json            # manifest 声明时必需
  motion.json           # manifest 声明时必需
  assets/
  integrity.json
```

通过工具模板生成完整的 `manifest.json` 和 token 文档，再编辑新增字段：

```json
{
  "assets": {
    "wallpaper": { "path": "assets/dark.png", "kind": "image" },
    "video": { "path": "assets/dark.webm", "kind": "video" },
    "ui": { "path": "assets/ui.woff2", "kind": "font" }
  },
  "backgrounds": {
    "light": { "type": "image", "asset": "wallpaper" },
    "dark": {
      "type": "video",
      "asset": "video",
      "poster": "wallpaper",
      "fit": "cover",
      "position": [50, 50],
      "opacity": 1,
      "blur": 0,
      "scrim": "#10182244"
    }
  },
  "fonts": { "ui": [{ "asset": "ui", "weight": 400, "style": "normal" }] },
  "icons": "icons.json",
  "motion": "motion.json"
}
```

以上是新增字段示例，不是完整 manifest。v2 保留 v1 的 ID、版本、UI 契约范围、模式、token 文件和能力声明。必须有浅色与深色配置；高对比度需要对应 token，未声明时宿主暂时使用默认高对比度皮肤。v1 原校验、文件白名单和禁止项保持不变。v2 使用独立版本分派校验入口，token 值域和可访问性要求仍按现有契约执行。

| 配置          | 规则                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets`      | 最多 128 项；ID 为小写字母开头的字母、数字、连字符；路径位于 `assets/`，不含绝对路径、URL、转义或 `..`                                                     |
| `backgrounds` | `none`、`image`、`video`；视频必需图片 poster；`fit` 为 cover/contain，position 两个 0–100 百分比，opacity 0–1，blur 0–24 px，scrim 为六或八位十六进制颜色 |
| `fonts`       | ui、conversation、code；每角色 1–8 个 WOFF2 face，字重 400/500/600/700，normal/italic；重复字重和样式被拒绝                                                |
| `icons`       | 固定文件名，结构化几何；颜色由宿主生成 currentColor；缺项使用内置图标                                                                                      |
| `motion`      | 固定文件名；background、surface、controls 三个宿主边界；none/fade/slide/scale/pulse/float，时长 0–500 ms、位移 0–12 px；仅 background 可循环               |

图标文件示例：

```json
{
  "schemaVersion": 1,
  "icons": {
    "send": [{ "type": "path", "d": "M12 20V4 M5 11l7-7 7 7", "fill": false }]
  }
}
```

支持 path、circle、rect、line，24×24 坐标；非 path 几何值为 0–24，每图标最多 32 项。语义名称见工具包的 `schema/icons.json` 和[源码覆盖表](../../packages/theme-contract/src/skin-icon-names.ts)。公共图标入口覆盖按钮和菜单的语义图标，桌面已接入发送、停止、复制、下载、展开收起、撤销、分支、比较、提交、工作树、PR、外链及资源入口。品牌 logo、头像、外部内容及图表插图继续使用原来源。

动效示例：

```json
{
  "schemaVersion": 1,
  "targets": {
    "controls": { "preset": "scale", "duration": 120, "distance": 0 },
    "background": {
      "preset": "float",
      "duration": 500,
      "distance": 4,
      "loop": true
    }
  }
}
```

宿主不会在根节点施加 transform/filter；背景不接收输入。高对比度关闭背景、装饰动效和玻璃效果。减少动态效果使用 poster，关闭宿主动效。视频强制静音循环，在隐藏、最小化、锁屏、休眠期间暂停。

## 限制、完整性与运行降级

JSON 单文件 1 MiB；PNG/JPEG/WebP 图片 10 MiB、解码不超过 2,000 万像素；MP4/WebM 视频 50 MiB、1920×1080、60 秒；WOFF2 字体 20 MiB。插件整体继续限制为 2,500 文件、200 MiB，单文件最多 50 MiB。

`integrity.json` v2 包含 `schemaVersion: 2`、`algorithm: "sha256"` 和路径到 SHA-256 的 `files` 映射，覆盖 manifest、全部 token、声明的图标、动效和资源。皮肤目录内未声明文件、链接、错误哈希、错误资源格式和超限包被拒绝。完整性文件自身不参与哈希。资源保留在插件快照中，只通过当前主窗口的临时 `artemis-skin:` 租约访问；Browser 分区不提供资源处理器。

主进程检查媒体签名、容器元数据和尺寸限制，渲染器进一步检查实际解码。坏 token 拒绝整套皮肤；字体准备超过 2 秒或解码失败使用系统字体，code 字体未通过等宽检查仅回退该角色；图片失败使用背景色；视频失败使用 poster。诊断在设置中可见。中文等缺字由系统字体补齐。更新、禁用和卸载先撤销地址、关闭流，再替换快照；切换失败不会提交旧异步请求。

## 独立开发工具

仓库维护者运行 `npm run build:skin-tools`，生成 `artifacts/skin-tools/artemis-skin-tools-1.0.0.tar.gz`。解压后使用 Node.js 24 或更新版本，无需安装依赖或连接网络。workspace 包仍为私有包，工具并未发布到 npm。

```sh
node /path/to/artemis-skin-tools-1.0.0/cli.mjs init ./my-plugin com.example.ocean
node /path/to/artemis-skin-tools-1.0.0/cli.mjs validate ./my-plugin
node /path/to/artemis-skin-tools-1.0.0/cli.mjs build ./my-plugin ./my-plugin-built
node /path/to/artemis-skin-tools-1.0.0/cli.mjs preview ./my-plugin-built 8787
node /path/to/artemis-skin-tools-1.0.0/cli.mjs convert-icons ./svg ./icons.json
```

init、build 和 convert-icons 要求输出不存在。编辑后用 build 生成新目录并重新计算完整性，源目录不会改变。validate 可验证插件或独立 v1/v2 皮肤目录。preview 仅监听 127.0.0.1，默认展示插件声明的第一套皮肤；传入具体皮肤目录可预览其他皮肤。它是契约展示页，完整应用验收需要安装进 Artemis。SVG 转换仅支持 24×24 的基础形状和分组，拒绝脚本、事件、外部引用、transform 和任意样式；转换结果仍需加入 manifest 与完整性清单。

工具包附带 manifest-v2、integrity-v2、icons、motion JSON Schema；跨文件资源引用和哈希校验由 validate 完成。完整的[两套示例](../../examples/visual-skins/README.md)可以从本地插件目录安装，或按[原生插件商店指南](plugin-marketplaces.md)发布到 Git 和签名离线商店。两套示例包含高对比度 token、字体、图标和动效，静态版使用 PNG，视频版使用 WebM 与 PNG poster。

## 维护验证

`npm run verify:visual-skins` 构建独立工具、运行仓库外消费者测试，并在隔离用户数据中启动实际 Electron，两次进程分别验证安装、媒体、切换、更新和重启卸载。报告和截图放在忽略的 `artifacts/verification/visual-skins/`。`npm run verify:desktop-skin` 仍是要求干净 checkout 的 v1 完整矩阵与最终产物检查，不应以 v2 集成测试代替。

发布还需执行 typecheck、完整测试、生产构建、皮肤包与 conformance、UI 边界/收敛/性能及外部消费者门禁。macOS arm64、Windows 最终安装包、签名、公证、更新回滚，以及三种真实分发路径的安装验收需要各平台独立证据。
