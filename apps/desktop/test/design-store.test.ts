import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesignStore,
  type DesignHostContext,
} from "../src/main/design-store.js";
import { patchDesignSource } from "../src/main/design-source.js";

// These tests use real SQLite commits and filesystem persistence.
// Windows CI disk latency varies across the entire suite.
if (process.platform === "win32") vi.setConfig({ testTimeout: 30_000 });

const context: DesignHostContext = {
  projectId: "project",
  threadId: "thread",
  workspaceBinding: "/checkout",
  mode: "execute",
};
const source = {
  html: '<span data-design-id="label" data-design-text="static">旧文字</span>',
  parameters: [
    { name: "--design-gap", min: 0, max: 32, value: 8, unit: "px" as const },
  ],
};
const cleanup: Array<() => void> = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "design-store-test-"));
  let database = new DatabaseSync(join(root, "state.sqlite"));
  let store = new DesignStore(database, join(root, "blobs"));
  cleanup.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get database() {
      return database;
    },
    root,
    restart() {
      database.close();
      database = new DatabaseSync(join(root, "state.sqlite"));
      store = new DesignStore(database, join(root, "blobs"));
    },
  };
}
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

describe("design P0 persistence", () => {
  it("dispatches both workflow directions in order, only after the exact previous turn completes", () => {
    const f = fixture();
    const idle = { turn: false, tools: false, children: false };
    const requests = ["code", "design", "code"] as const;
    for (const [index, workflow] of requests.entries())
      f.store.enqueue(context, `request-${index}`, workflow, "next");
    for (const [index, workflow] of requests.entries()) {
      const request = f.store.claim(context, idle)!;
      expect(request.workflow).toBe(workflow);
      expect(request.requestId).toBe(`request-${index}`);
      expect(f.store.claim(context, idle)).toBeUndefined();
      expect(() =>
        f.store.complete(context, request.requestId, "stale-turn"),
      ).toThrow(/different turn/);
      f.store.complete(context, request.requestId, request.turnId);
    }
    expect(f.store.claim(context, idle)).toBeUndefined();
  });
  it("saves edited text and parameters, reopens, and retries a lost response exactly once", () => {
    const f = fixture();
    const edited = patchDesignSource(source, [
      { type: "text", elementId: "label", text: "保存中文" },
      { type: "parameter", name: "--design-gap", value: 16 },
    ]);
    const input = {
      operationId: "save-1",
      documentId: "document",
      baseRevision: null,
      source: edited,
    };
    const revision = f.store.save(context, input);
    f.restart();
    expect(f.store.save(context, input)).toEqual(revision);
    expect(f.store.read(context, "document", revision.revisionId)).toEqual(
      edited,
    );
    expect(() => f.store.save(context, { ...input, source })).toThrow(/reused/);
  });
  it("preserves a stale agent result as a branch without replacing the human head", () => {
    const f = fixture();
    const initial = f.store.save(context, {
      operationId: "initial",
      documentId: "d",
      baseRevision: null,
      source,
    });
    const save = (operationId: string, text: string) =>
      f.store.save(context, {
        operationId,
        documentId: "d",
        baseRevision: initial.revisionId,
        source: patchDesignSource(source, [
          { type: "text", elementId: "label", text },
        ]),
      });
    const human = save("human", "人工改稿");
    const agent = save("agent", "模型改稿");
    expect(agent.conflict).toBe(true);
    expect(agent.parentRevision).toBe(initial.revisionId);
    expect(f.store.head(context, "d")).toBe(human.revisionId);
    expect(f.store.read(context, "d", agent.revisionId).html).toContain(
      "模型改稿",
    );
  });
  it("rolls back revision pointers when DB commit fails after blob publication", () => {
    const f = fixture();
    f.database.exec(
      "CREATE TRIGGER fail_save BEFORE INSERT ON design_p0_operations BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    );
    const input = {
      operationId: "save",
      documentId: "d",
      baseRevision: null,
      source,
    };
    expect(() => f.store.save(context, input)).toThrow(/injected failure/);
    expect(() => f.store.head(context, "d")).toThrow();
    expect(
      f.database.prepare("SELECT COUNT(*) AS n FROM design_p0_revisions").get()!
        .n,
    ).toBe(0);
    f.database.exec("DROP TRIGGER fail_save");
    expect(f.store.save(context, input).conflict).toBe(false);
  });
  it("denies read-only saves and foreign ownership; rejects corrupt content", () => {
    const f = fixture();
    const input = {
      operationId: "save",
      documentId: "d",
      baseRevision: null,
      source,
    };
    for (const mode of ["plan", "review"] as const)
      expect(() => f.store.save({ ...context, mode }, input)).toThrow(
        /Execute/,
      );
    const revision = f.store.save(context, input);
    expect(() =>
      f.store.read({ ...context, threadId: "other" }, "d", revision.revisionId),
    ).toThrow(/belong/);
    writeFileSync(join(f.root, "blobs", revision.digest), "corrupt");
    expect(() => f.store.read(context, "d", revision.revisionId)).toThrow(
      /integrity/,
    );
  });
  it.each(["code", "design"] as const)(
    "queues %s requests until all host activity ends and never replays uncertain dispatch",
    (workflow) => {
      const f = fixture();
      const request = f.store.enqueue(
        context,
        "request",
        workflow,
        "next workflow",
      );
      for (const active of [
        { turn: true, tools: false, children: false },
        { turn: false, tools: true, children: false },
        { turn: false, tools: false, children: true },
      ])
        expect(f.store.claim(context, active)).toBeUndefined();
      const idle = { turn: false, tools: false, children: false };
      expect(
        f.store.claim(
          { ...context, workspaceBinding: "/other-checkout" },
          idle,
        ),
      ).toBeUndefined();
      expect(() => f.store.claim({ ...context, mode: "plan" }, idle)).toThrow(
        /Execute/,
      );
      expect(f.store.claim(context, idle)?.turnId).toBe(request.turnId);
      f.restart();
      expect(f.store.recover()[0]?.status).toBe("needs-reconciliation");
      expect(f.store.claim(context, idle)).toBeUndefined();
      expect(
        f.store.enqueue(context, "request", workflow, "next workflow").turnId,
      ).toBe(request.turnId);
      expect(() =>
        f.store.enqueue(context, "request", workflow, "changed"),
      ).toThrow(/reused/);
    },
  );
});
