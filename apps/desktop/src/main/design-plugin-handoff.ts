import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppStore } from "./store.js";
import { ensureThreadDataRoot } from "./design-plugin-thread-data.js";
import {
  readDesignDocumentLedger,
  readDesignDocumentVersionBytes,
  requireDesignDocumentId,
  resolveDesignDocumentDirectory,
  resolveHeadVersionEntry,
} from "./design-plugin-document-files.js";

type HandoffInput = { threadId: string; documentId: string };
type HandoffResult = { threadId: string; created: boolean };

export function createDesignHandoffHandler(
  getStore: () => AppStore | undefined,
  userDataPath: string,
) {
  const pending = new Map<string, Promise<HandoffResult>>();
  return async (input: HandoffInput): Promise<HandoffResult> => {
    const key = `${input.threadId}\0${requireDesignDocumentId(input.documentId)}`;
    const existing = pending.get(key);
    if (existing) return { ...(await existing), created: false };
    const operation = createHandoff(input);
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  };

  async function createHandoff(input: HandoffInput): Promise<HandoffResult> {
    const documentId = requireDesignDocumentId(input.documentId);
    // §10.3 幂等创建编码任务。handoffId 从 (threadId, documentId) 确定性
    // 派生：同一文档重复点交接永远命中同一 operationId 与同一目标任务。
    const handoffId = createHash("sha256")
      .update(`handoff:${input.threadId}:${documentId}`)
      .digest("hex")
      .slice(0, 32);
    const store = getStore();
    const source = store?.getThread(input.threadId);
    if (!store || !source?.typeBinding) {
      throw new Error("Source thread has no plugin binding.");
    }
    const operationId = `handoff:${handoffId}`;
    // P2-15：重放判定前置——已存在的交接直接返回已有任务（并补齐缺失
    // 的目标），不再依赖「插入失败」当去重信号（那会在 createThread 上
    // 撞 UNIQUE 约束）。
    const prior = store.readPluginOperation(operationId);
    if (prior) {
      if (prior.requestDigest !== documentId) {
        throw new Error("Handoff id collision; refusing.");
      }
      if (!store.getThreadGoal(handoffId)) {
        store.setThreadGoal(
          handoffId,
          `按冻结设计实现（材料见 ${join(userDataPath, "design-handoffs", handoffId)}）。`,
          undefined,
        );
      }
      return { threadId: handoffId, created: false };
    }
    // P2-15：冻结设计材料——选定文档的 HEAD 版本 HTML + 账本里的名称与
    // 需求备注，作为编码任务的初始材料落盘（keyed by 确定性 handoffId，
    // 重放覆盖写，不产生孤儿累积）。
    const dataRoot = await ensureThreadDataRoot(
      join(userDataPath, "plugin-scratch"),
      input.threadId,
    );
    const documentDir = await resolveDesignDocumentDirectory(
      dataRoot,
      documentId,
    );
    const headEntry = await resolveHeadVersionEntry(
      dataRoot,
      documentDir,
      await readdir(documentDir).catch(() => []),
    );
    if (!headEntry) throw new Error("No version file for the document.");
    const headHtml = (
      await readDesignDocumentVersionBytes(dataRoot, documentDir, headEntry)
    ).toString("utf8");
    let documentName = documentId;
    let documentBrief = "";
    try {
      const ledgerText = await readDesignDocumentLedger(dataRoot);
      for (const line of ledgerText.split("\n")) {
        if (!line.trim()) continue;
        const record = JSON.parse(line) as {
          id?: string;
          name?: string;
          brief?: string;
        };
        if (record.id === documentId) {
          if (record.name) documentName = record.name;
          if (typeof record.brief === "string") documentBrief = record.brief;
          break;
        }
      }
    } catch {
      /* 账本缺失时回退到 documentId，brief 留空 */
    }
    const handoffRoot = join(userDataPath, "design-handoffs", handoffId);
    await mkdir(handoffRoot, { recursive: true });
    const revision = /^v\d+-([0-9a-f]+)\.html$/.exec(headEntry)?.[1] ?? "";
    const designPath = join(handoffRoot, headEntry);
    const materialPath = join(handoffRoot, "material.md");
    await writeFile(designPath, headHtml);
    await writeFile(
      materialPath,
      [
        `# 设计交接材料`,
        ``,
        `- 文档：${documentName}（${documentId}）`,
        `- 冻结版本：${headEntry}`,
        `- 源设计任务：${input.threadId}`,
        `- 设计稿：${designPath}`,
        ``,
        `## 需求备注`,
        ``,
        documentBrief || "（源任务未填写需求备注）",
        ``,
      ].join("\n"),
    );
    const now = new Date().toISOString();
    const hostStore = store;
    // P2-15：事务化创建——账本记录、建任务、事件要么一起落库，要么都不。
    hostStore.commitPluginStateTransaction(() => {
      hostStore.recordPluginOperation({
        operationId,
        threadId: input.threadId,
        pluginId: source.typeBinding!.pluginId,
        toolName: "handoff",
        requestDigest: documentId,
        state: "succeeded",
        resultRef: handoffId,
      });
      hostStore.createThread({
        id: handoffId,
        ...(source.projectId ? { projectId: source.projectId } : {}),
        title: `[设计交接] ${documentName}（${headEntry}）`,
        mode: "execute",
        target: source.target,
        status: "idle",
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      hostStore.appendPluginEvent({
        eventId: randomUUID(),
        streamId: `thread/${input.threadId}/handoff`,
        threadId: input.threadId,
        schemaVersion: 1,
        payload: {
          kind: "handoff-created",
          documentId,
          handoffThreadId: handoffId,
        },
      });
    });
    // 目标独立开事务（setThreadGoal 自带 BEGIN IMMEDIATE，不能嵌套）。
    store.setThreadGoal(
      handoffId,
      `按冻结设计实现：${designPath}；需求与版本说明：${materialPath}。`,
      undefined,
    );
    return { threadId: handoffId, created: true };
  }
}
