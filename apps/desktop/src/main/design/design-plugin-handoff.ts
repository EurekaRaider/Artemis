// Design handoff (hosted-ledger retirement): "freeze a workspace design page
// into a coding task". The document identity is the workspace path — there is
// no ledger/HEAD to freeze, so the material is the file itself; the coding
// task works on the same project workspace directly.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { AppStore } from "../settings/store.js";

type HandoffInput = { threadId: string; documentId: string };
type HandoffResult = { threadId: string; created: boolean };
// 宽函数签名：main.ts 传入的 resolveThreadWorkspace 需要完整 Thread；
// 这里用参数逆变友好的 (…args: never[]) 形态避免结构不匹配。
type WorkspaceResolver = (...args: never[]) => Promise<{ workspacePath: string }>;

export function createDesignHandoffHandler(
  getStore: () => AppStore | undefined,
  resolveWorkspace: WorkspaceResolver,
) {
  const pending = new Map<string, Promise<HandoffResult>>();
  return async (input: HandoffInput): Promise<HandoffResult> => {
    const raw = String(input.documentId ?? "");
    const rel = raw.startsWith("panel-project:")
      ? raw.slice("panel-project:".length)
      : raw;
    const key = `${input.threadId}\0${rel}`;
    const existing = pending.get(key);
    if (existing) return { ...(await existing), created: false };
    const operation = createHandoff(input, rel, raw);
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  };

  async function createHandoff(
    input: HandoffInput,
    rel: string,
    raw: string,
  ): Promise<HandoffResult> {
    const store = getStore();
    const source = store?.getThread(input.threadId);
    if (!store || !source?.projectId) {
      throw new Error("设计交接仅项目会话可用。");
    }
    if (!rel || rel.includes("..") || !/\.html?$/i.test(rel)) {
      throw new Error("Invalid project file path.");
    }
    const handoffId = createHash("sha256")
      .update(`handoff:${input.threadId}:${rel}`)
      .digest("hex")
      .slice(0, 32);
    const operationId = `handoff:${handoffId}`;
    const prior = store.readPluginOperation(operationId);
    if (prior) {
      if (prior.requestDigest !== rel) {
        throw new Error("Handoff id collision; refusing.");
      }
      if (!store.getThreadGoal(handoffId)) {
        store.setThreadGoal(
          handoffId,
          `按设计页实现（源文件 ${rel}，见源任务材料）。`,
          undefined,
        );
      }
      return { threadId: handoffId, created: false };
    }
    const workspace = await resolveWorkspace(source as never);
    const abs = resolve(workspace.workspacePath, rel);
    if (!abs.startsWith(resolve(workspace.workspacePath) + sep))
      throw new Error("Invalid project file path.");
    const html = await readFile(abs, "utf8").catch(() => undefined);
    if (html === undefined) throw new Error("设计页不存在或不可读。");
    const name = rel.split("/").pop() ?? rel;
    const now = new Date().toISOString();
    store.commitPluginStateTransaction(() => {
      store.recordPluginOperation({
        operationId,
        threadId: input.threadId,
        pluginId: source.typeBinding?.pluginId ?? "com.artemis.design",
        toolName: "handoff",
        requestDigest: rel,
        state: "succeeded",
        resultRef: handoffId,
      });
      store.createThread({
        id: handoffId,
        projectId: source.projectId!,
        title: `[设计交接] ${name}`,
        mode: "work",
        target: source.target,
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      store.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/handoff`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "handoff-created",
          documentId: raw,
          handoffThreadId: handoffId,
        },
      });
    });
    // 目标独立开事务（setThreadGoal 自带 BEGIN IMMEDIATE，不能嵌套）。
    store.setThreadGoal(
      handoffId,
      `按设计页实现：工作区文件 ${rel}（内容已在源任务面板确认）。`,
      undefined,
    );
    return { threadId: handoffId, created: true };
  }
}
