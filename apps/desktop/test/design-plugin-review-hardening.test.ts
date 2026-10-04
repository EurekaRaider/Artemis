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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ProjectFileReadError,
  readProjectFileForPreview,
} from "../src/main/design-plugin-project-files.js";
import { PanelSendEntryService } from "../src/main/design-plugin-send-entry.js";
import { PluginRevisionStore } from "../src/main/design-plugin-revision-store.js";
import { createDispatchPluginTool } from "../src/main/design-plugin-dispatch.js";
import { AppStore } from "../src/main/store.js";
import { RESTRICTED_PROFILE_ID } from "@artemis/protocol";

let directory: string;
const packageRoot = join(
  fileURLToPath(new URL("..", import.meta.url)),
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
  let threadId: string;

  beforeAll(() => {
    store = new AppStore(join(directory, "send-entry.sqlite"));
    threadId = randomUUID();
    const now = new Date().toISOString();
    store.createThread({
      id: threadId,
      title: "send-entry",
      mode: "execute",
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
    service.bindStartedTurn(threadId, ownTurn);
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
      mode: "execute",
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
    service.bindStartedTurn(otherThread, turnA);
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
      mode: "execute",
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

describe("P2-11 / P1-7 / P2-13 through the real dispatch + runtime", () => {
  let store: AppStore;
  let dispatch: ReturnType<typeof createDispatchPluginTool>;
  let threadId: string;
  let planThreadId: string;
  let artifactWrites: Array<{ threadId: string; toolName: string }>;
  let databasePath: string;
  let revisionsRoot: string;

  beforeAll(async () => {
    revisionsRoot = join(directory, `rev-${randomUUID().slice(0, 6)}`);
    const scratchRoot = join(directory, `scratch-${randomUUID().slice(0, 6)}`);
    databasePath = join(directory, `state-${randomUUID().slice(0, 6)}.sqlite`);
    store = new AppStore(databasePath);
    const contentHash = await PluginRevisionStore.computeContentHash(
      join(packageRoot, "artemis-design"),
    );
    const revisionStore = new PluginRevisionStore(revisionsRoot);
    await revisionStore.publish({
      installationId: "com.artemis.design",
      contentHash,
      sourceRoot: join(packageRoot, "artemis-design"),
    });
    const now = new Date().toISOString();
    const binding = {
      installationId: "com.artemis.design",
      pluginId: "com.artemis.design",
      typeId: "artemis-design",
      pluginVersion: "0.1.0",
      contentHash,
      bindingRevision: `rev-${contentHash.slice(0, 12)}`,
    };
    threadId = randomUUID();
    planThreadId = randomUUID();
    store.createThread({
      id: threadId,
      title: "exec",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      typeBinding: binding,
      executionProfile: RESTRICTED_PROFILE_ID,
      createdAt: now,
      updatedAt: now,
    });
    store.createThread({
      id: planThreadId,
      title: "plan",
      mode: "plan",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      typeBinding: binding,
      executionProfile: RESTRICTED_PROFILE_ID,
      createdAt: now,
      updatedAt: now,
    });
    for (const scopeId of [threadId, planThreadId]) {
      store.insertPluginGrant({
        grantId: randomUUID(),
        installationId: binding.installationId,
        pluginId: binding.pluginId,
        contentHash,
        scope: "thread",
        scopeId,
        capabilities: { artifactStore: "thread" },
        resourceRefs: { revisionsRoot },
        grantRevision: binding.bindingRevision,
      });
    }
    artifactWrites = [];
    dispatch = createDispatchPluginTool({
      store,
      revisionsRoot,
      scratchRoot,
      onArtifactWrite: (input) => {
        artifactWrites.push(input);
      },
      loadPublishedManifest: async (input) => {
        const revisionRoot = join(
          revisionsRoot,
          input.installationId,
          input.contentHash,
        );
        try {
          const bytes = await readFile(
            join(revisionRoot, "artemis.plugin.json"),
            "utf8",
          );
          const manifest = JSON.parse(bytes) as {
            tools: Array<{ name: string; effect: string }>;
            runtime: { entry: string };
          };
          return {
            tools: manifest.tools,
            runtimeEntry: join(revisionRoot, manifest.runtime.entry),
            revisionRoot,
          };
        } catch {
          return undefined;
        }
      },
    });
  });

  async function call(
    toolName: string,
    args: Record<string, unknown>,
    mode: "execute" | "plan" = "execute",
    useThread: string = threadId,
    operationId?: string,
  ) {
    const outcome = await dispatch.dispatch({
      threadId: useThread,
      toolName,
      args,
      mode,
      ...(operationId ? { operationId } : {}),
    });
    return outcome as {
      status: string;
      error?: string;
      result?: { output?: string };
    };
  }

  function parseOutput(outcome: {
    result?: { output?: string };
  }): Record<string, unknown> {
    try {
      return JSON.parse(outcome.result?.output ?? "{}") as Record<
        string,
        unknown
      >;
    } catch {
      return {};
    }
  }

  it("P1-4: runtime refuses traversal-shaped document ids", async () => {
    const outcome = await call("apply_edit", {
      documentId: "../../other-task-doc",
      expectedRevision: "deadbeefdeadbeef",
      operationId: `trav-${randomUUID()}`,
      find: "a",
      replace: "b",
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("invalid documentId");
  }, 30_000);

  it("P1-7: a persisted Plan task cannot dispatch plugin tools even claiming execute", async () => {
    const outcome = await call(
      "create_document",
      { name: "不应创建", brief: "" },
      "execute",
      planThreadId,
    );
    expect(outcome.status).toBe("refused");
    expect(outcome.error).toContain("persisted task mode is plan");
  }, 30_000);

  it("P2-11: runtime failure status propagates instead of reporting success", async () => {
    // 空名称会被 runtime 以返回值（非异常）拒绝——外层必须传播失败。
    const outcome = await call("create_document", { name: "", brief: "" });
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBeTruthy();
    // 没有 artifact-write 提交、没有成功事件路径的副作用。
    expect(artifactWrites.length).toBe(0);
  }, 30_000);

  it("P2-13: undo walks HEAD, sequences take the full-history max, redo is guarded", async () => {
    const created = await call("create_document", {
      name: "撤销语义验收.html",
      brief: "",
    });
    expect(created.status).toBe("succeeded");
    const createdOut = parseOutput(created);
    const documentId = String(createdOut.documentId ?? "");
    const rev1 = String(createdOut.revision ?? "");
    expect(documentId).toBeTruthy();

    const edit1 = await call("apply_edit", {
      documentId,
      expectedRevision: rev1,
      operationId: `e1-${randomUUID()}`,
      find: "<body>",
      replace: "<body>v2",
    });
    expect(edit1.status).toBe("succeeded");
    const rev2 = String(parseOutput(edit1).revision ?? "");

    const edit2 = await call("apply_edit", {
      documentId,
      expectedRevision: rev2,
      operationId: `e2-${randomUUID()}`,
      find: "<body>v2",
      replace: "<body>v2 v3",
    });
    expect(edit2.status).toBe("succeeded");
    const rev3 = String(parseOutput(edit2).revision ?? "");

    // 连续撤销：HEAD 沿历史回退（旧实现第二次撤销停在原地）。
    const undo1 = await call("undo", {
      documentId,
      operationId: `u1-${randomUUID()}`,
    });
    expect(undo1.status).toBe("succeeded");
    expect(parseOutput(undo1).headRevision).toBe(rev2);
    const undo2 = await call("undo", {
      documentId,
      operationId: `u2-${randomUUID()}`,
    });
    expect(undo2.status).toBe("succeeded");
    expect(parseOutput(undo2).headRevision).toBe(rev1);

    // redo：刚撤销末版本、无新版本 → 有效，回到 v3。
    const redo = await call("redo", {
      documentId,
      operationId: `r1-${randomUUID()}`,
    });
    expect(redo.status).toBe("succeeded");
    expect(parseOutput(redo).headRevision).toBe(rev3);

    // 再撤销一次，然后编辑：新序号必须是全历史最大+1（v4），不与被撤销
    // 的 v3 撞号；HEAD 推进到 v4。
    const undo3 = await call("undo", {
      documentId,
      operationId: `u3-${randomUUID()}`,
    });
    expect(undo3.status).toBe("succeeded");
    const edit3 = await call("apply_edit", {
      documentId,
      expectedRevision: rev2,
      operationId: `e3-${randomUUID()}`,
      find: "<body>v2",
      replace: "<body>v2 v4",
    });
    expect(edit3.status).toBe("succeeded");
    const edit3Out = parseOutput(edit3);
    expect(edit3Out.version).toBe(4);

    // redo 在存在更新版本后必须被拒。
    const redoAfterEdit = await call("redo", {
      documentId,
      operationId: `r2-${randomUUID()}`,
    });
    expect(redoAfterEdit.status).toBe("failed");

    // list_versions 序号唯一且连续（1..4），无重复 v3。
    const versions = await call("list_versions", { documentId });
    const list = parseOutput(versions).versions as Array<{ sequence: number }>;
    const sequences = list
      .map((version) => version.sequence)
      .sort((a, b) => a - b);
    expect(sequences).toEqual([1, 2, 3, 4]);
    expect(new Set(sequences).size).toBe(4);
  }, 60_000);

  it("P2-12: replaying the same operationId returns the stored outcome without re-execution", async () => {
    const created = await call("create_document", {
      name: "重放幂等验收.html",
      brief: "",
    });
    const documentId = String(parseOutput(created).documentId ?? "");
    const operationId = `replay-${randomUUID()}`;
    const args = {
      documentId,
      expectedRevision: String(parseOutput(created).revision ?? ""),
      find: "<body>",
      replace: "<body>replay",
      operationId,
    };
    const before = store.readPluginOperation(operationId);
    expect(before).toBeUndefined();
    const first = await call(
      "apply_edit",
      args,
      "execute",
      threadId,
      operationId,
    );
    expect(first.status).toBe("succeeded");
    const writesAfterFirst = artifactWrites.length;
    const second = await call(
      "apply_edit",
      args,
      "execute",
      threadId,
      operationId,
    );
    // 重放返回已存结果，不再执行（无第二次 artifact 提交）。
    expect(second.status).toBe("succeeded");
    expect(artifactWrites.length).toBe(writesAfterFirst);
    // digest 冲突（同 ID 不同参数）被拒。
    const conflict = await call(
      "apply_edit",
      { ...args, replace: "<body>conflict" },
      "execute",
      threadId,
      operationId,
    );
    expect(conflict.status).toBe("refused");
    expect(conflict.error).toContain("operation-conflict");
  }, 30_000);
});
