# Artemis v2.0.10

## 中文

- 修复粘贴 API Key 后输入框被保存按钮挤压的问题，并将保存按钮调整为紧凑的勾选图标与“保存”文字。
- 为内置模型供应商补充移除入口，修复设置弹窗内移除菜单无法点击的问题；删除已配置供应商需要确认，并处理受影响的默认模型与会话设置。
- 修复删除凭据后认证状态缓存未及时刷新、供应商仍显示“已连接”的问题。
- 将“新任务全局默认”移到独立区域并显示默认模型所属供应商，避免与当前供应商的模型混淆。

## English

- Fix API-key inputs collapsing when the save button appears after pasting, and use a compact checkmark and Save button.
- Add removal actions for built-in model providers and make the removal menu clickable inside Settings. Removing a configured provider requires confirmation and updates affected default-model and conversation selections.
- Refresh cached authentication availability after credential removal so deleted credentials no longer leave providers marked as connected.
- Separate global new-task defaults from individual provider details and show the default model's provider.
