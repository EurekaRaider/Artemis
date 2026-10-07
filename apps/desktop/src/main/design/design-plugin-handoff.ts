// Design handoff (hosted-ledger retirement): "freeze a workspace design page
// into a coding task". The document identity is the workspace path — there is
// no ledger/HEAD to freeze, so the material is the file itself; the coding
// task works on the same project workspace directly.
import { createHash, randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { AppLocale, Thread } from "@artemis/protocol";
import { readWorkspaceFileBytes } from "./design-plugin-project-files.js";
import { resolveDesignWorkspacePath } from "./design-thin-snapshots.js";
import type { AppStore } from "../settings/store.js";
import { uiText } from "../../shared/i18n/ui-text.js";

type HandoffInput = { threadId: string; documentId: string };
type HandoffResult = { threadId: string; created: boolean };
type WorkspaceResolver = (thread: Thread) => Promise<{ workspacePath: string }>;

export function createDesignHandoffHandler(
  getStore: () => AppStore | undefined,
  resolveWorkspace: WorkspaceResolver,
  locale: () => AppLocale = () => "en",
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
    if (
      !store ||
      !source?.projectId ||
      source.archived ||
      !source.typeBinding
    ) {
      throw new Error(uiText(locale(), "DesignHost.handoffProjectOnly"));
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
          uiText(locale(), "DesignHost.handoffGoalRecovery", { file: rel }),
          undefined,
        );
      }
      return { threadId: handoffId, created: false };
    }
    const workspace = await resolveWorkspace(source);
    const abs = await resolveDesignWorkspacePath(workspace.workspacePath, rel);
    if (
      !(await readWorkspaceFileBytes(
        await realpath(workspace.workspacePath),
        abs,
        4 * 1024 * 1024,
      ))
    )
      throw new Error("Design page is unreadable.");
    const current = store.getThread(input.threadId);
    if (
      !current ||
      current.archived ||
      current.projectId !== source.projectId ||
      current.typeBinding?.bindingRevision !==
        source.typeBinding.bindingRevision
    )
      throw new Error("Source task changed during handoff.");
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
        title: uiText(locale(), "DesignHost.handoffTitle", { name }),
        mode: "work",
        target: "local",
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
      uiText(locale(), "DesignHost.handoffGoal", {
        file: rel,
        workspace: workspace.workspacePath,
      }),
      undefined,
    );
    return { threadId: handoffId, created: true };
  }
}
