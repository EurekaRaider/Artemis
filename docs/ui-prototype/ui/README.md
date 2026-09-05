# Artemis UI 原型组件库

这是供 `components.html` 和 `apple-inspired-ui.html` 共用的浏览器组件库。零运行时依赖，可用 `file://` 离线打开；不连接 Electron、Node、Agent、IM 或真实文件操作。

## 入口与边界

```html
<link rel="stylesheet" href="ui/index.css" />
<script src="ui/index.js"></script>
<script src="ui/artemis/patterns.js"></script>
```

- `ui/tokens.css`：唯一主题来源，A/B/C × light/dark × normal/high。
- `ui/primitives/controls.css`：公共 `.ui-button`、`.ui-field`、`.ui-tab`、`.ui-floating`、`.ui-switch` 样式。
- `ui/artemis/catalog.css`：70 张规格卡的结构样式。通过 `.ui-anatomy` 容器显式启用，避免宿主页面同名类冲突；包含组件变体，不能把整张 `.spec` 演示卡当成组件。
- `ui/artemis/task-plan.css`、`patterns.js`：共享任务计划和目标编辑器。
- `ui/compat.css`：工作台旧变量到语义 Tokens 的过渡映射，不定义第二套主题。
- `showcase/`：导航、规格展示、演示状态和模拟操作。
- `workspace/`、`workspace-composition.css`：工作台布局、场景数据及组件组合。

浏览器需要支持 CSS `@scope`、`color-mix()` 和原生 `inert`。当前验证使用本机 Chromium；未宣称所有浏览器或 Electron 打包平台都已验证。

## 创建与复用

```js
const UI = window.ArtemisUI;
const trigger = UI.button({ label: "运行模式", variant: "secondary" });
const popup = document.createElement("div");
popup.append(UI.button({ label: "计划" }), UI.button({ label: "执行" }));
container.append(trigger, popup);

const selection = UI.menu(trigger, popup, {
  selector: "button",
  onSelect(option) {
    trigger.textContent = option.textContent;
  },
});

// 页面卸载或移除该区域时清理监听和焦点层级。
selection.destroy();
```

公共创建器按文本创建内容，不把调用方传入的标签当作 HTML 执行。调用者负责给图标按钮提供有意义的 `label`，并负责浮层在宿主布局中的定位。

## API

所有控制器返回 `destroy()`；同一个根元素重复挂载同类控制器会返回原实例。销毁后可重新挂载。不同根元素的状态独立；菜单与弹窗的 Esc 按最上层处理。

| API                                         | 输入与回调                                                                  | 返回能力                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `button(options)`                           | `label, variant, size, icon, iconOnly, disabled, className`                 | 原生 button；variant 为 primary/secondary/ghost/danger，size 可为 compact                 |
| `tab(options)`                              | `label, value, icon, closable, className, closeClass`                       | role=tab 的原生 button，关闭标记由 Tabs 处理                                              |
| `enhance(root)`                             | 旧 `.btn` / `.icon-btn` / 表单等结构                                        | 幂等添加公共样式类；动态插入旧结构后需再次调用                                            |
| `menu(trigger, panel, options)`             | `selector, select, selectedClass, hidden, onSelect, onOpenChange`           | `open(), close(), select(item), isOpen`；上下键、Home/End、字符查找、焦点归还             |
| `floating(trigger, panel, options)`         | `hidden, focusOnOpen, onOpenChange`                                         | `open(), close(), setOpen(), isOpen`；点外关闭、Esc、ARIA 与 inert                        |
| `tabs(root, options)`                       | `selector, orientation, panelFor, onSelect, closeSelector, onClose`         | `select(tab, focus?, notify?), refresh()`；箭头键/Home/End、Delete 关闭、动态标签         |
| `dialog(panel, options)`                    | `surface, initialFocus, inert, dismissOutside, onClose`                     | `open(trigger?), close(), isOpen`；原生 dialog 或遮罩容器、焦点陷阱、焦点恢复             |
| `splitPane(handle, options)`                | `initial, limits, onChange, getValue, direction, step, home, reset, onDrag` | `set(px)`；键盘、拖拽、取消捕获及边界钳制                                                 |
| `disclosure(trigger, panel, options)`       | 可提供 `classTarget, className, onChange`                                   | `set(open)`；展开状态与 ARIA                                                              |
| `toggle(control, options)`                  | input/label 或 button；`onChange`                                           | `set(checked)`；原生或 ARIA switch                                                        |
| `autosize(input, max)`                      | textarea、高度上限                                                          | `update()`                                                                                |
| `toast(host, options)`                      | `duration`                                                                  | `show(message, error?)`；状态播报与计时清理                                               |
| `ArtemisPatterns.goalEditor(root, options)` | `input, save, revert, status, onSave, onChange, labels`                     | `save(), revert(), setState(), value`；脏状态、异步保存、失败保留草稿、销毁后忽略迟到结果 |
| `ArtemisPatterns.taskPlan(root, options)`   | `steps, index, statuses, onChange`；可提供既有 trigger/list/marker/label    | `update(data), setOpen()`；175ms 悬停意图、键盘、完成后隐藏                               |

`menu` 默认是单选 listbox；动作菜单使用 `select:false`。`tabs.onClose` 由宿主管理面板生命周期、相邻标签选择及空态。`dialog.inert` 只传需要暂停交互的背景区域，不包含弹窗自身。

## 迁移清单与范围

[migration-map.json](migration-map.json) 保存全部70张卡的映射。状态区分：

- `shared-runtime`：已抽取可复用控制器，并接入工作台。
- `anatomy-and-demo`：结构样式已归库，场景演示仍由展示页管理；并不表示每一种业务行为都已做成独立公共 API。
- `specification`：字体、间距、图标等规范展示，不需要机械封装为一个组件。

本轮已完成基础组件库、两页共享接入和工作台首轮改造。来源分组、复杂问答、排队消息等后续业务封装沿用此结构；正式 `@artemis/ui` React 包及生产 Renderer 迁移仍属于后续阶段。

## 验证与单文件导出

在仓库根运行：

```sh
node docs/ui-prototype/tools/library-check.mjs
node docs/ui-prototype/tools/workspace-check.mjs
node docs/ui-prototype/tools/inline-assets.cjs docs/ui-prototype/apple-inspired-ui.html /tmp/artemis-workspace.html
```

前两条需要本机 Playwright 与 Chromium。原型目录的私有 `package.json` 固定 Playwright 1.60.0；新环境可运行 `npm install --prefix docs/ui-prototype`，再从该目录运行 `npx playwright install chromium`。默认证据写到 `/tmp/artemis-library-check` 和 `/tmp/artemis-workspace-check`，可使用 `ARTEMIS_UI_CHECK_OUTPUT` 改位置。单文件导出只内联本地 CSS 与脚本，拒绝远程或越出原型目录的资源。

旧的 `contrast/run-headless.zsh` 已适配外部资源和 CSS 分组规则；若只需要审计主流程，可在原型目录的临时副本运行 `RUN_SELFTESTS=0 zsh contrast/run-headless.zsh`，避免覆盖已归档的历史证据。
