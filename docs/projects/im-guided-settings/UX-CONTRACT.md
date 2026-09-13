# Artemis 原型交互契约

范围：本次消息接入静态原型；生产协议和授权策略以代码为准。视觉意图见 [DESIGN.md](DESIGN.md)。

## 业务依据

- `apps/desktop/src/renderer/ImSettingsPanel.tsx`：平台必填/可选字段、接收方式、项目 grant。
- `apps/desktop/src/renderer/ImPlatformSetup.tsx`、`ImSlackSetup.tsx`：平台注册与发布步骤。
- `docs/features/im-gateway/README.md`：身份稳定性、配对、服务存续、沙箱边界。文档旧版要求飞书身份字段必填处，以当前 UI 自动识别实现为准。
- `AGENTS.md`：Plan/Review 写入禁止、远程执行权限不等同桌面完整权限。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | ArtemisUI.enhance + IM field rules | ui/index.js; ImSettingsPanel.tsx | 内联校验、密码显隐、草稿保留 | tools/im-settings-check.mjs |
| Select/Listbox | 原型原生 select | ui/index.js; ui/primitives.css | 接受系统弹出菜单；生产沿用 React Select | tools/im-settings-check.mjs |
| Toast | notice / ArtemisUI.toast | workspace/workspace.js; ui/index.js | 成功或错误；关键问题另有持久状态 | tools/workspace-check.mjs |
| CRUD | imState / imDerive | workspace/workspace.js | 确认权限保存、账号解绑 | tools/im-settings-check.mjs |
| Scrollbar | 原型全局样式 | ui/tokens.css; ui/primitives.css | 沿用 settings-content 滚动归属 | tools/workspace-check.mjs |

## 消息接入流程

1. 启动本机服务或在同一步骤注册团队服务。退出 Artemis 停止本机服务；保持设备唤醒。
2. 飞书默认只填 App ID / Secret；Tenant Key、Bot Open ID 自动识别。企业微信填企业 ID、Bot ID、Secret。Slack 填 xoxb / xapp 两类 Token。仅飞书提供 HTTPS 回调，而且需要团队服务。
3. 本人单聊配对，配对码五分钟有效；Slack 指令不带斜杠。批准、拒绝、解绑和静音必须反映在列表。
4. 选中项目自动设首个默认项目。未保存修改显示待保存；Plan/Review 禁用命令及网络。保存权限经确认后生效，失败保留草稿；不隐式续期未选项目。「临时会话」是内置授权目标：默认开启、不可取消，不占项目授权与默认项目逻辑；具体项目仍逐个勾选授权（2026-09-13 拍板）。
5. 群协作保持可选；发现不等于授权共享，确认后才生效。

机器人表单收起或取消保留本次页面草稿；成功保存清空密钥。切换演示快照或重置前确认丢弃。迟到结果由 epoch 作废。场景工具不连接第三方、不持久存储凭据。

## 验证

原型工具均从仓库根运行：`node docs/ui-prototype/tools/library-check.mjs`、`node docs/ui-prototype/tools/workspace-check.mjs`、`node docs/ui-prototype/tools/im-settings-check.mjs`。新增验证覆盖真实点击、失败重试、配对与权限提交、窄屏、深色及 reduced-motion。截图与临时审计产物位于 `/tmp`。
