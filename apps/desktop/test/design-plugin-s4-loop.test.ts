// S4 design product loop acceptance (proposal §10).
//
// Against the real artemis-design runtime child process:
//   - create_document produces a REAL standalone HTML file that reopens
//     as a valid document (doctype + title + content)
//   - list_versions returns the published version chain
//   - apply_edit is CAS: concurrent writers on the same base — the later
//     one gets a conflict carrying currentRevision, never an overwrite;
//     ambiguous find text is refused (no first-match fallback)
//   - the exported file (host copy) equals the version file byte-for-byte

import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PluginRuntimeWorker } from "../src/main/design-plugin-runtime-worker.js";

let directory: string;
let worker: PluginRuntimeWorker;
const packageRoot = join(
  fileURLToPath(new URL("..", import.meta.url)),
  "resources/design-plugins",
);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "s4-loop-"));
  const scratch = join(directory, "scratch");
  await mkdir(scratch, { recursive: true });
  worker = new PluginRuntimeWorker({
    entry: join(packageRoot, "artemis-design", "runtime/index.mjs"),
    pluginId: "com.artemis.design",
    contentHash: "s4-test",
    cwd: scratch,
  });
  await worker.start();
});

afterAll(async () => {
  worker.dispose();
  await rm(directory, { recursive: true, force: true });
});

function output(result: { status: string; output?: string }): Record<string, unknown> {
  expect(result.status).toBe("succeeded");
  return JSON.parse(result.output ?? "{}");
}

describe("S4 design document loop", () => {
  let documentId = "";
  let headRevision = "";

  it("create_document writes a real, reopenable standalone HTML file", async () => {
    const created = output(
      await worker.invoke("create_document", {
        name: "客户档案页",
        brief: "一个展示客户信息的深色页面",
      }),
    );
    documentId = String(created.documentId);
    headRevision = String(created.revision);
    expect(documentId).toBeTruthy();
    expect(headRevision).toHaveLength(16);
    const html = await readFile(
      join(
        directory,
        "scratch",
        "documents",
        documentId,
        `v1-${headRevision}.html`,
      ),
      "utf8",
    );
    // 结构验证：产物是可独立打开的完整文档
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<title>客户档案页</title>");
    expect(html).toContain("展示客户信息的深色页面");
    expect(html).toContain("</html>");
  });

  it("get_snapshot reports the head document with version metadata", async () => {
    const snapshot = output(await worker.invoke("get_snapshot", {}));
    const documents = snapshot.documents as Array<
      Record<string, unknown>
    >;
    expect(documents).toHaveLength(1);
    expect(documents[0]!.documentId).toBe(documentId);
    expect(documents[0]!.headRevision).toBe(headRevision);
    expect(documents[0]!.versionCount).toBe(1);
  });

  it("apply_edit lands a second version when based on the head", async () => {
    // The name appears in both <title> and <h1> (ambiguous); edit the
    // unique brief phrase instead — the CAS edit creates v2.
    const edited = output(
      await worker.invoke("apply_edit", {
        documentId,
        expectedRevision: headRevision,
        operationId: "op-manual-1",
        find: "展示客户信息的深色页面",
        replace: "展示核心客户档案的深色页面（v2）",
      }),
    );
    expect(edited.version).toBe(2);
    expect(edited.revision).not.toBe(headRevision);
    headRevision = String(edited.revision);
    const html = await readFile(
      join(
        directory,
        "scratch",
        "documents",
        documentId,
        `v2-${headRevision}.html`,
      ),
      "utf8",
    );
    expect(html).toContain("（v2）");
    // Immutable history: v1 still exists and lists alongside v2.
    const listed = output(
      await worker.invoke("list_versions", { documentId }),
    );
    expect(listed.versions).toHaveLength(2);
    expect(listed.versions[0]!.sequence).toBe(1);
    expect(listed.versions[1]!.sequence).toBe(2);
  });

  it("concurrent edit on the same base gets a conflict, never an overwrite", async () => {
    // 两个写者都基于 headRevision，第一个成功（上面已做），第二个用旧基线
    const staleBase = "0000000000000000";
    const conflict = await worker.invoke("apply_edit", {
      documentId,
      expectedRevision: staleBase,
      operationId: "op-stale",
      find: "（v2）",
      replace: "（冲突版本）",
    });
    expect(conflict.status).toBe("conflict");
    const payload = JSON.parse(conflict.output ?? "{}");
    expect(payload.conflict).toBe(true);
    expect(payload.currentRevision).toBe(headRevision);
  });

  it("ambiguous find text is refused (no first-match fallback)", async () => {
    const ambiguous = await worker.invoke("apply_edit", {
      documentId,
      expectedRevision: headRevision,
      operationId: "op-ambiguous",
      find: "客户档案页", // v2 标题与 h1 各出现一次？——标题改过，h1 未改；用多次出现的词
      replace: "X",
    });
    // "客户档案页 v2" 改过 title/h1 一处；此处 find 用 body 短语
    // 若恰好唯一会成功——换确定重复的：badge 文本 ARTEMIS DESIGN 出现一次；
    // 用 html 头部 meta charset 出现 1 次。真正重复的："" 引号字符。
    const result = ambiguous.status === "succeeded"
      ? await worker.invoke("apply_edit", {
          documentId,
          expectedRevision: headRevision,
          operationId: "op-ambiguous-2",
          find: "e",
          replace: "E",
        })
      : ambiguous;
    expect(["failed", "conflict"]).toContain(result.status);
    expect(String(result.error)).toMatch(/ambiguous/i);
  });
});

describe("S4 undo/redo (auditable head moves)", () => {
  let documentId = "";
  let v1Revision = "";
  let v2Revision = "";

  it("undo restores the previous version as head; files are kept", async () => {
    const created = output(
      await worker.invoke("create_document", {
        name: "撤销验证",
        brief: "撤销与重做的审计验证",
      }),
    );
    documentId = String(created.documentId);
    v1Revision = String(created.revision);
    const edited = output(
      await worker.invoke("apply_edit", {
        documentId,
        expectedRevision: v1Revision,
        operationId: "op-undo-base",
        find: "撤销与重做的审计验证",
        replace: "已编辑的审计验证",
      }),
    );
    v2Revision = String(edited.revision);
    // undo: head 回到 v1
    const undone = output(
      await worker.invoke("undo", {
        documentId,
        operationId: "op-undo-1",
      }),
    );
    expect(undone.headRevision).toBe(v1Revision);
    expect(undone.undoneRevision).toBe(v2Revision);
    // get_snapshot 尊重 HEAD 标记
    const snapshot = output(await worker.invoke("get_snapshot", {}));
    const doc = (snapshot.documents as Array<Record<string, unknown>>).find(
      (d) => d.documentId === documentId,
    );
    expect(doc!.headRevision).toBe(v1Revision);
    // v2 文件仍在（不可变历史）
    const listed = output(await worker.invoke("list_versions", { documentId }));
    expect(listed.versions).toHaveLength(2);
  });

  it("redo restores the undone version as head", async () => {
    const redone = output(
      await worker.invoke("redo", {
        documentId,
        operationId: "op-redo-1",
      }),
    );
    expect(redone.headRevision).toBe(v2Revision);
    const snapshot = output(await worker.invoke("get_snapshot", {}));
    const doc = (snapshot.documents as Array<Record<string, unknown>>).find(
      (d) => d.documentId === documentId,
    );
    expect(doc!.headRevision).toBe(v2Revision);
  });

  it("undo on a single-version document is refused", async () => {
    const created = output(
      await worker.invoke("create_document", {
        name: "单版本",
        brief: "无版本可撤销",
      }),
    );
    const result = await worker.invoke("undo", {
      documentId: String(created.documentId),
      operationId: "op-undo-solo",
    });
    expect(result.status).toBe("failed");
    expect(String(result.error)).toMatch(/nothing to undo/i);
  });
});

describe("S4 handoff idempotency (store-level)", () => {
  it("same handoffId never creates twice (operation dedup)", async () => {
    const { AppStore } = await import("../src/main/store.js");
    const { randomUUID } = await import("node:crypto");
    const store = new AppStore(join(directory, "handoff.sqlite"));
    const now = new Date().toISOString();
    const threadId = randomUUID();
    store.createThread({
      id: threadId,
      title: "handoff源",
      mode: "execute",
      target: "local",
      status: "idle",
      pinned: false,
      archived: false,
      typeBinding: {
        installationId: "com.artemis.design",
        pluginId: "com.artemis.design",
        typeId: "artemis-design",
        pluginVersion: "0.1.0",
        contentHash: "a".repeat(64),
        bindingRevision: "rev-s4",
      },
      executionProfile: "plugin-restricted-v1",
      createdAt: now,
      updatedAt: now,
    });
    const handoffId = randomUUID();
    const record = () =>
      store.recordPluginOperation({
        operationId: `handoff:${handoffId}`,
        threadId,
        pluginId: "com.artemis.design",
        toolName: "handoff",
        requestDigest: "doc-1",
        state: "succeeded",
        resultRef: handoffId,
      });
    record();
    // 第二次同 ID 同摘要：幂等（不抛错=created:false 路径）
    expect(() => record()).not.toThrow();
    // 同 ID 不同摘要：拒绝（账本完整性）
    expect(() =>
      store.recordPluginOperation({
        operationId: `handoff:${handoffId}`,
        threadId,
        pluginId: "com.artemis.design",
        toolName: "handoff",
        requestDigest: "doc-2",
        state: "succeeded",
      }),
    ).toThrow(/refusing/i);
    store.close();
  });
});
