// PR#245 review hardening acceptance suite.
//
// Real-process evidence for the review's verification asks:
//   - 越界访问拒绝（P1-3）：真实符号链接（文件/目录/CSS 依赖）指向工作
//     区外，readProjectFileForPreview 必须拒绝/剥离，不把区外内容带进预览。
//   - documentId 穿越（P1-4）：../../ 形态在 runtime 工具层被拒。
//   - dispatcher 状态传播（P2-11）：runtime 返回 failed 时外层不再 succeeded。
//   - 持久化模式门禁（P1-7 dispatch 层）：Plan 任务的 plugin 工具调用被拒。
//   - 账本状态迁移与重放（P2-12）：running→succeeded 真的推进；终态后
//     重执行被拒；同 operationId 重放返回已存结果不再执行。
//   - nonce 验签与 turn 绑定（P2-9/P2-10）：伪造 nonce 拒绝；「加入输入
//     框」不再进 dispatching；turn 结算只作用于绑定该 turn 的提交。
//   - 撤销后编辑（P2-13）：连续撤销沿 HEAD 回退、序号取全历史最大值+1、
//     redo 仅在撤销末版本且无新版本时有效。
//
// The runtime tests run the real published artemis-design package (same
// harness as design-plugin-s2-runtime.test.ts), so the edited
// runtime/index.mjs is what executes here.

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ProjectFileReadError,
  readProjectFileForPreview,
} from "../../../src/main/design/design-plugin-project-files.js";
import { createDesignWorkspaceToolHandlers } from "../../../src/main/design/design-plugin-workspace-tools.js";
import { PanelSendEntryService } from "../../../src/main/design/design-plugin-send-entry.js";
import { PluginRevisionStore } from "../../../src/main/design/design-plugin-revision-store.js";
import { createDispatchPluginTool } from "../../../src/main/design/design-plugin-dispatch.js";
import { AppStore } from "../../../src/main/settings/store.js";
import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

let directory: string;
const packageRoot = join(
  fileURLToPath(new URL("../../..", import.meta.url)),
  "resources/design-plugins",
);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "review-hard-"));
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("P1-3 symlink escapes are denied (readProjectFileForPreview)", () => {
  it("inlines in-workspace css/img/script normally", async () => {
    const ws = join(directory, "ws-ok");
    await mkdir(join(ws, "assets"), { recursive: true });
    await writeFile(join(ws, "assets", "site.css"), "body{background:#fff}");
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
      "hex",
    );
    await writeFile(join(ws, "assets", "logo.png"), png);
    await writeFile(join(ws, "app.js"), "console.log('inside');");
    await writeFile(
      join(ws, "index.html"),
      [
        "<html><head>",
        '<link rel="stylesheet" href="assets/site.css">',
        "</head><body>",
        '<img src="assets/logo.png">',
        '<script src="app.js"></script>',
        "</body></html>",
      ].join(""),
    );
    const result = await readProjectFileForPreview({
      workspacePath: ws,
      requestedPath: "index.html",
    });
    expect(result.content).toContain("background:#fff");
    expect(result.content).toContain("data:image/png;base64,");
    expect(result.content).toContain("console.log('inside');");
  });

  it("refuses a workspace file that is a symlink to outside", async () => {
    const ws = join(directory, "ws-link-file");
    const outside = join(directory, "outside-secret.txt");
    await mkdir(ws, { recursive: true });
    await writeFile(outside, "TOP SECRET OUTSIDE");
    await symlink(outside, join(ws, "notes.txt"));
    await expect(
      readProjectFileForPreview({
        workspacePath: ws,
        requestedPath: "notes.txt",
      }),
    ).rejects.toBeInstanceOf(ProjectFileReadError);
  });

  it("refuses an HTML whose stylesheet dependency symlinks outside", async () => {
    const ws = join(directory, "ws-link-css");
    const outsideCss = join(directory, "outside.css");
    await mkdir(join(ws, "assets"), { recursive: true });
    await writeFile(outsideCss, "body{background:#000}");
    await symlink(outsideCss, join(ws, "assets", "site.css"));
    await writeFile(
      join(ws, "index.html"),
      '<html><head><link rel="stylesheet" href="assets/site.css"></head><body>x</body></html>',
    );
    const result = await readProjectFileForPreview({
      workspacePath: ws,
      requestedPath: "index.html",
    });
    expect(result.content).not.toContain("#000");
  });

  it("refuses dependencies behind a symlinked directory", async () => {
    const ws = join(directory, "ws-link-dir");
    const outsideDir = join(directory, "outside-assets");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "site.css"), "body{color:red}");
    await mkdir(ws, { recursive: true });
    await symlink(outsideDir, join(ws, "assets"));
    await writeFile(
      join(ws, "index.html"),
      '<html><head><link rel="stylesheet" href="assets/site.css"></head><body>x</body></html>',
    );
    const result = await readProjectFileForPreview({
      workspacePath: ws,
      requestedPath: "index.html",
    });
    expect(result.content).not.toContain("color:red");
  });

  it("rejects traversal and non-preview extensions before any read", async () => {
    const ws = join(directory, "ws-guard");
    await mkdir(ws, { recursive: true });
    await expect(
      readProjectFileForPreview({
        workspacePath: ws,
        requestedPath: "../evil.txt",
      }),
    ).rejects.toBeInstanceOf(ProjectFileReadError);
    await expect(
      readProjectFileForPreview({
        workspacePath: ws,
        requestedPath: "app.exe",
      }),
    ).rejects.toBeInstanceOf(ProjectFileReadError);
  });
});

describe("P2-9/P2-10 send-entry credentials and turn binding", () => {
  let store: AppStore;
  afterAll(() => store?.close());
  let threadId: string;

  beforeAll(() => {
    store = new AppStore(join(directory, "send-entry.sqlite"));
    threadId = randomUUID();
    const now = new Date().toISOString();
    store.createThread({
      id: threadId,
      title: "send-entry",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  });

  it("refuses a forged nonce on a real submission id", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "改一下按钮颜色",
      bindingRevision: "rev-x",
    });
    const forged = `${accepted.submission.submissionId}.${randomUUID()}`;
    expect(() => service.consumeCredential(forged)).toThrow(
      /nonce was not issued/,
    );
    // 正式凭据不受伪造尝试影响，仍可消费一次。
    const consumed = service.consumeCredential(accepted.credential);
    expect(consumed.candidateText).toBe("改一下按钮颜色");
    expect(() => service.consumeCredential(accepted.credential)).toThrow(
      /already used/,
    );
  });

  it("a restart (fresh service over the same rows) cannot reuse the credential", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "重启后不应可重放",
      bindingRevision: "rev-x",
    });
    service.consumeCredential(accepted.credential);
    const restarted = new PanelSendEntryService(store);
    expect(() => restarted.consumeCredential(accepted.credential)).toThrow(
      /nonce was not issued/,
    );
  });

  it("staging (加入输入框) cancels instead of dispatching and is never completed", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "只进输入框的草稿",
      bindingRevision: "rev-x",
    });
    service.stageCredential(accepted.credential);
    const row = store.getPromptSubmission(accepted.submission.submissionId)!;
    expect(row.state).toBe("cancelled");
    // 任何 turn 的结算都不能把已 staged 的草稿改成 completed。
    service.reconcileTurnOutcome(threadId, "completed", randomUUID());
    const after = store.getPromptSubmission(accepted.submission.submissionId)!;
    expect(after.state).toBe("cancelled");
  });

  it("binds the dispatching submission to the started turn and settles only that turn", () => {
    const service = new PanelSendEntryService(store);
    const accepted = service.acceptCandidate({
      threadId,
      candidateText: "真正发送的候选",
      bindingRevision: "rev-x",
    });
    service.consumeCredential(accepted.credential);
    const submissionId = accepted.submission.submissionId;

    // 兄弟 turn 先完成：未绑定 turn 的 dispatching 行不得被结算。
    const siblingTurn = randomUUID();
    service.reconcileTurnOutcome(threadId, "completed", siblingTurn);
    expect(store.getPromptSubmission(submissionId)!.state).toBe("dispatching");

    // 本 turn 启动：绑定 + 转 running。
    const ownTurn = randomUUID();
    service.markRunning(submissionId, ownTurn);
    expect(store.getPromptSubmission(submissionId)!.state).toBe("running");
    expect(store.getPromptSubmission(submissionId)!.turnId).toBe(ownTurn);

    // 其他 turn 完成不影响；本 turn 完成才结算。
    service.reconcileTurnOutcome(threadId, "completed", siblingTurn);
    expect(store.getPromptSubmission(submissionId)!.state).toBe("running");
    service.reconcileTurnOutcome(threadId, "completed", ownTurn);
    expect(store.getPromptSubmission(submissionId)!.state).toBe("completed");
  });

  it("turn binding is immutable once written", () => {
    const store2 = new AppStore(join(directory, "send-entry-2.sqlite"));
    const otherThread = randomUUID();
    const now = new Date().toISOString();
    store2.createThread({
      id: otherThread,
      title: "t",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const service = new PanelSendEntryService(store2);
    const accepted = service.acceptCandidate({
      threadId: otherThread,
      candidateText: "turn 绑定不可改",
      bindingRevision: "rev-x",
    });
    service.consumeCredential(accepted.credential);
    const submissionId = accepted.submission.submissionId;
    const turnA = randomUUID();
    service.markRunning(submissionId, turnA);
    expect(() =>
      store2.transitionPromptSubmission(
        submissionId,
        "running",
        "turn-started",
        randomUUID(),
      ),
    ).toThrow(/refusing rebind/);
    store2.close();
  });
});

describe("P2-12 plugin operation ledger state machine", () => {
  it("advances running → succeeded and refuses execution after terminal states", () => {
    const store = new AppStore(join(directory, "ledger.sqlite"));
    const threadId = randomUUID();
    const now = new Date().toISOString();
    store.createThread({
      id: threadId,
      title: "ledger",
      mode: "work",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const operationId = `op-${randomUUID()}`;
    const digest = "digest-a";
    store.recordPluginOperation({
      operationId,
      threadId,
      pluginId: "p",
      toolName: "apply_edit",
      requestDigest: digest,
      state: "running",
    });
    store.recordPluginOperation({
      operationId,
      threadId,
      pluginId: "p",
      toolName: "apply_edit",
      requestDigest: digest,
      state: "succeeded",
      resultRef: "op://x",
    });
    // 状态真的推进了（旧实现在这里静默返回，行永远停在 running）。
    expect(store.readPluginOperation(operationId)!.state).toBe("succeeded");
    // 终态后再试图执行（回 running）被拒。
    expect(() =>
      store.recordPluginOperation({
        operationId,
        threadId,
        pluginId: "p",
        toolName: "apply_edit",
        requestDigest: digest,
        state: "running",
      }),
    ).toThrow(/transition to running is refused/);
    // 同 digest 幂等重提交成功态可用。
    store.recordPluginOperation({
      operationId,
      threadId,
      pluginId: "p",
      toolName: "apply_edit",
      requestDigest: digest,
      state: "succeeded",
    });
    // 不同 digest 的重放被拒。
    expect(() =>
      store.recordPluginOperation({
        operationId,
        threadId,
        pluginId: "p",
        toolName: "apply_edit",
        requestDigest: "digest-b",
        state: "succeeded",
      }),
    ).toThrow(/different request digest/);
    store.close();
  });
});

describe("workspace design dispatch, persistence and authorization", () => {
  let store: AppStore;
  let dispatch: ReturnType<typeof createDispatchPluginTool>;
  let threadId: string;
  let planThreadId: string;
  let workspace: string;
  let artifactWrites: Array<{ threadId: string; toolName: string }>;
  afterAll(() => {
    dispatch?.dispose();
    store?.close();
  });

  beforeAll(async () => {
    const revisionsRoot = join(directory, "workspace-revisions");
    workspace = join(directory, "workspace-design");
    await mkdir(workspace);
    store = new AppStore(join(directory, "workspace.sqlite"));
    const contentHash = await PluginRevisionStore.computeContentHash(
      join(packageRoot, "artemis-design"),
    );
    await new PluginRevisionStore(revisionsRoot).publish({
      installationId: "com.artemis.design",
      contentHash,
      sourceRoot: join(packageRoot, "artemis-design"),
    });
    const now = new Date().toISOString();
    const projectId = randomUUID();
    store.upsertProject({
      id: projectId,
      name: "design",
      path: workspace,
      createdAt: now,
      updatedAt: now,
    });
    const binding = {
      installationId: "com.artemis.design",
      pluginId: "com.artemis.design",
      typeId: "artemis-design",
      pluginVersion: "0.4.5",
      contentHash,
      bindingRevision: "workspace-binding",
    };
    threadId = randomUUID();
    planThreadId = randomUUID();
    for (const id of [threadId, planThreadId]) {
      store.createThread({
        id,
        projectId,
        title: "design",
        mode: id === planThreadId ? "plan" : "work",
        target: "local",
        status: "idle",
        pinned: false,
        archived: false,
        typeBinding: binding,
        executionProfile: RESTRICTED_PROFILE_ID,
        createdAt: now,
        updatedAt: now,
      });
      store.insertPluginGrant({
        grantId: randomUUID(),
        installationId: binding.installationId,
        pluginId: binding.pluginId,
        contentHash,
        scope: "thread",
        scopeId: id,
        capabilities: { projectFiles: "explicit-import" },
        resourceRefs: { revisionsRoot },
        grantRevision: binding.bindingRevision,
      });
    }
    artifactWrites = [];
    dispatch = createDispatchPluginTool({
      store,
      revisionsRoot,
      scratchRoot: join(directory, "workspace-scratch"),
      ...createDesignWorkspaceToolHandlers({
        getThread: (id) => store.getThread(id),
        resolveWorkspace: async () => ({ workspacePath: workspace }),
      }),
      onArtifactWrite: (input) => {
        artifactWrites.push(input);
      },
      loadPublishedManifest: async (input) => {
        const revisionRoot = join(
          revisionsRoot,
          input.installationId,
          input.contentHash,
        );
        const manifest = JSON.parse(
          await readFile(join(revisionRoot, "artemis.plugin.json"), "utf8"),
        );
        return {
          tools: manifest.tools,
          runtimeEntry: join(revisionRoot, manifest.runtime.entry),
          revisionRoot,
        };
      },
    });
  });

  const call = (
    toolName: string,
    args: Record<string, unknown>,
    operationId?: string,
    id = threadId,
  ) =>
    dispatch.dispatch({
      threadId: id,
      toolName,
      args,
      mode: "work",
      ...(operationId ? { operationId } : {}),
    });
  const output = (value: { result?: unknown }) =>
    JSON.parse((value.result as { output: string }).output);

  it("denies traversal and empty find without changing a page", async () => {
    expect(
      (await call("write_page", { path: "../escape.html", content: "bad" }))
        .status,
    ).toBe("failed");
    await call("write_page", { path: "empty-find.html", content: "keep" });
    expect(
      (
        await call("apply_edit", {
          path: "empty-find.html",
          find: "",
          content: "bad",
        })
      ).status,
    ).toBe("failed");
    expect(await readFile(join(workspace, "empty-find.html"), "utf8")).toBe(
      "keep",
    );
  });

  it("denies a persisted Plan task before filesystem execution", async () => {
    const result = await call(
      "write_page",
      { path: "plan.html", content: "bad" },
      undefined,
      planThreadId,
    );
    expect(result.status).toBe("refused");
    expect(result.error).toContain("persisted task mode is plan");
    await expect(readFile(join(workspace, "plan.html"))).rejects.toThrow();
  });

  it("propagates a returned failed history result and does not refresh the panel", async () => {
    await call("write_page", { path: "no-undo.html", content: "only state" });
    const before = artifactWrites.length;
    const result = await call("undo", { path: "no-undo.html" });
    expect(result.status).toBe("failed");
    expect(artifactWrites).toHaveLength(before);
  });

  it("reads the actual project inventory and records read operations without artifact refresh", async () => {
    const before = artifactWrites.length;
    const result = await call("get_snapshot", {});
    expect(result.status).toBe("succeeded");
    expect(
      output(result).files.some(
        (file: { path: string }) => file.path === "empty-find.html",
      ),
    ).toBe(true);
    expect(artifactWrites).toHaveLength(before);
  });

  it("undo and redo move repeatedly and a new edit ends redo", async () => {
    const path = "history.html";
    await call("write_page", { path, content: "one" });
    await call("write_page", { path, content: "two" });
    await call("write_page", { path, content: "three" });
    expect((await call("undo", { path })).status).toBe("succeeded");
    expect(await readFile(join(workspace, path), "utf8")).toBe("two");
    expect((await call("undo", { path })).status).toBe("succeeded");
    expect(await readFile(join(workspace, path), "utf8")).toBe("one");
    expect((await call("redo", { path })).status).toBe("succeeded");
    expect(await readFile(join(workspace, path), "utf8")).toBe("two");
    await call("apply_edit", { path, find: "two", content: "four" });
    expect((await call("redo", { path })).status).toBe("failed");
    const versions = output(await call("list_versions", { path })).versions;
    expect(new Set(versions.map((v: { file: string }) => v.file)).size).toBe(
      versions.length,
    );
  });

  it("persists exact replay results and refuses conflicting operation IDs", async () => {
    const operationId = randomUUID();
    const args = { path: "replay.html", content: "original" };
    const first = await call("write_page", args, operationId);
    expect(first.status).toBe("succeeded");
    const count = artifactWrites.length;
    expect(await call("write_page", args, operationId)).toEqual(first);
    expect(artifactWrites).toHaveLength(count);
    expect(
      (await call("write_page", { ...args, content: "changed" }, operationId))
        .status,
    ).toBe("refused");
    expect(store.readPluginOperation(operationId)?.result).toEqual(
      first.result,
    );
  });

  it("marks failed snapshot commits as failed rather than returning an unusable successful replay", async () => {
    const operationId = randomUUID();
    const commit = vi
      .spyOn(store, "insertPluginSnapshot")
      .mockImplementationOnce(() => {
        throw new Error("snapshot unavailable");
      });
    try {
      const result = await call(
        "write_page",
        { path: "commit-failure.html", content: "page" },
        operationId,
      );
      expect(result.status).toBe("failed");
      expect(result.error).toContain("snapshot unavailable");
      expect(store.readPluginOperation(operationId)?.state).toBe("failed");
    } finally {
      commit.mockRestore();
    }
  });

  it("rolls back snapshot and success event when result persistence fails", async () => {
    const operationId = randomUUID();
    const head = store.readPluginStateHead({
      threadId,
      pluginId: "com.artemis.design",
      stateSchemaVersion: 1,
    });
    const record = store.recordPluginOperation.bind(store);
    const commit = vi
      .spyOn(store, "recordPluginOperation")
      .mockImplementation((operation) => {
        if (operation.state === "succeeded")
          throw new Error("result unavailable");
        record(operation);
      });
    try {
      expect(
        (
          await call(
            "write_page",
            { path: "result-failure.html", content: "page" },
            operationId,
          )
        ).status,
      ).toBe("failed");
      expect(
        store.readPluginStateHead({
          threadId,
          pluginId: "com.artemis.design",
          stateSchemaVersion: 1,
        }),
      ).toEqual(head);
      expect(
        store.database
          .prepare(
            "SELECT snapshot_id FROM plugin_snapshots WHERE created_by_operation_id = ?",
          )
          .all(operationId),
      ).toEqual([]);
      expect(store.readPluginOperation(operationId)?.state).toBe("failed");
    } finally {
      commit.mockRestore();
    }
  });

  it("revoked grants are rechecked immediately before a host write", async () => {
    const handlers = createDesignWorkspaceToolHandlers({
      getThread: (id) => store.getThread(id),
      resolveWorkspace: async () => {
        store.database
          .prepare("UPDATE plugin_grants SET revoked_at = ? WHERE scope_id = ?")
          .run(new Date().toISOString(), threadId);
        return { workspacePath: workspace };
      },
    });
    const gate = () => {
      if (store.listPluginGrants(threadId).every((grant) => grant.revoked_at))
        throw new Error("grant revoked");
    };
    try {
      await expect(
        handlers.writeWorkspacePage!({
          threadId,
          path: "revoked.html",
          content: "bad",
          authorize: gate,
        }),
      ).rejects.toThrow("grant revoked");
      await expect(readFile(join(workspace, "revoked.html"))).rejects.toThrow();
    } finally {
      store.database
        .prepare(
          "UPDATE plugin_grants SET revoked_at = NULL WHERE scope_id = ?",
        )
        .run(threadId);
    }
  });
});
