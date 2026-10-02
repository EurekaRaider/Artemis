# S2 拒绝矩阵（§7 执行边界证据）

> 状态：S2 进行中。本文件随目标 7 持续更新；每条记录实测命令与结果。
> 分支：`codex/design-plugin-s0`。平台：macOS（arm64）。Windows 未覆盖，如实记录。

## 矩阵总览

| # | 场景 | 拒绝点 | 实测 | 结果 |
|---|------|--------|------|------|
| 1 | 篡改已发布 revision 内容后调插件工具 | 主进程派发器：`computeContentHash` 现算 ≠ 绑定哈希 | `design-plugin-s2-runtime.test.ts` > "tampered revision" | ✅ refused `content-hash-mismatch` + `plugin_events` 留痕 |
| 2 | 撤销 grant 后调插件工具 | 主进程派发器：`plugin_grants.revoked_at` 非空 | 同上 > "revoked grant" | ✅ refused `grant-revoked` |
| 3 | 无 grant 的线程调插件工具 | 主进程派发器：无匹配行 | 同上（grant-missing 分支） | ✅ 单测覆盖分支 |
| 4 | Plan 模式调插件工具 | ①注入谓词不注入；②派发器 `mode-denied` | s2-plugin-tool-visibility + 同上 > "plan mode" | ✅ 双层拒绝 |
| 5 | Review 模式调插件工具 | 同上 | 同上 > "review mode" | ✅ |
| 6 | 未声明工具名（模型幻觉/伪造） | 派发器 manifest 声明比对 | 同上 > "undeclared tool" | ✅ refused `tool-not-declared` |
| 7 | 无 typeBinding 的线程调插件工具 | 派发器 `no-type-binding` | 同上（分支） | ✅ |
| 8 | revision 目录缺失 | 派发器 `revision-missing` | 同上（分支） | ✅ |
| 9 | 沙箱探测失败 | `ThreadRuntimeManager.ensureRuntime` spawn 前拒绝 | 同上 > "sandbox probe failure" | ✅ 抛错且无子进程（childPid undefined） |
| 10 | 受限线程经 MCP/Hook/子代理旁路 | §7 双层门控（S0 已测）；S2 保持 gate 不变 | restricted-thread-gate.test.ts 全绿 | ✅ 未放宽 |
| 11 | 压缩后恢复的会话仍受限 | runtime.ts 每次重激活都过滤 denied 工具 | runtime.ts 6407-6414（既有）+ gate 测试 | ✅ 重激活路径过滤保留 |
| 12 | fork 出的任务继承受限 | fork 复制 executionProfile/typeBinding（store 层） | store fork 路径 + S1 e2e | ✅ S1 已证绑定持久，fork 同链路 |
| 13 | 线程删除/归档后 runtime 树存活 | main.ts 删除/归档路径调 pluginDispatch.closeThread + releasePanel | s2-runtime 套件 "dispatcher lifecycle" | ✅ 树被杀，后续经懒 spawn 语义明确 |

## 拒绝事件的审计形态

每次拒绝写入 `plugin_events`：

```json
{
  "kind": "dispatch-refused",
  "code": "content-hash-mismatch",
  "toolName": "create_document",
  "detail": "binding hash <frozen> but revision on disk hashes to <actual>"
}
```

streamId：`thread/<threadId>/dispatch`。

## 信任链结构（S2 落地形态）

```
面板 composer ──候选──> 宿主发送条目（S3）
模型 plugin_* 工具调用
  └─ agent-host customTools（仅 execute+restricted+bound 注入）
       └─ broker "plugin.tool" → 主进程 handlePluginToolBrokerRequest
            └─ createDispatchPluginTool.dispatch
                 1. typeBinding 存在？
                 2. revision 目录存在？
                 3. computeContentHash(revisionRoot) === binding.contentHash？  ← 现算，不信缓存
                 4. plugin_grants 有未撤销行？
                 5. mode === "execute"？
                 6. 工具在 manifest.tools 声明？
                 ↓ 全过
                 ThreadRuntimeManager.invoke
                   （sandbox 探测 → spawn → 队列串行 → 空闲回收）
```

任一步失败：`plugin_events` 留痕 + 拒绝返回，不产生子进程。

## 未覆盖（如实记录）

- Windows 原生验证（AppContainer/ACL/进程树）——S2 明确边界
- 真实 Pi session 内的端到端拒绝（需要 dev 实例 + 真实模型 turn；门控谓词与派发器拒绝路径已分别实测）
- Hook/MCP/子代理旁路的 agent-host 真实 session 证据（gate 单测覆盖分类与守卫；session 级集成证据在 S2 收尾补）

## 复现

```bash
cd apps/desktop && npx vitest run test/design-plugin-s2-runtime.test.ts
cd packages/agent-host && npx vitest run test/s2-plugin-tool-visibility.test.ts test/restricted-thread-gate.test.ts
```
