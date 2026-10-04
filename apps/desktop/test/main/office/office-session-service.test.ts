import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ArtifactEvent,
  ArtifactOperation,
  ArtifactSessionRequest,
} from "@artemis/protocol";
import {
  OfficeSessionService,
  type OfficeEngine,
  type OfficeSessionContext,
} from "../../../src/main/office/office-session-service.js";

const roots: string[] = [],
  services: OfficeSessionService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artemis-session-"));
  roots.push(root);
  await writeFile(join(root, "稿件.docx"), "Original");
  const events: ArtifactEvent[] = [];
  const engines: Array<OfficeEngine & { text: string; failNext: boolean }> = [];
  const factory = vi.fn(async () => {
    const engine = {
      version: "test",
      text: "",
      failNext: false,
      async open(path: string) {
        this.text = await readFile(path, "utf8");
        return this.snapshot();
      },
      async apply(change: ArtifactOperation) {
        if (change.type !== "replace-text") throw new Error("wrong type");
        this.text =
          this.text.slice(0, change.start) +
          change.text +
          this.text.slice(change.end);
        if (this.failNext)
          throw new Error("engine crashed after partial mutation");
      },
      async snapshot() {
        return {
          targets: [
            {
              selection: {
                kind: "paragraph" as const,
                index: 0,
                start: 0,
                end: this.text.length,
              },
              text: this.text,
            },
          ],
          sheets: [],
          warnings: [],
        };
      },
      async render(path: string) {
        await writeFile(path, `PDF:${this.text}`);
      },
      async save(path: string) {
        await writeFile(path, this.text);
      },
      async close() {},
    };
    engines.push(engine);
    return engine;
  });
  const options = {
    root: join(root, "sessions"),
    createEngine: factory,
    emit: (_thread: string, event: ArtifactEvent) => events.push(event),
    canSaveOriginal: async () => true,
    canAutoSave: () => true,
  };
  const service = new OfficeSessionService(options);
  services.push(service);
  const context: OfficeSessionContext = {
    workspacePath: root,
    threadId: "task",
    mode: "work",
  };
  const base = {
    protocolVersion: 2 as const,
    requestId: "request",
    format: "word" as const,
    path: "稿件.docx",
  };
  const opened = await service.execute({ ...base, operation: "open" }, context);
  const apply = (
    operationId: string,
    expectedVersion: number,
    text = "Edited",
  ): ArtifactSessionRequest => ({
    ...base,
    operation: "apply",
    sessionId: opened.session.sessionId,
    operationId,
    expectedVersion,
    change: { type: "replace-text", paragraph: 0, start: 0, end: 8, text },
  });
  return {
    root,
    service,
    options,
    context,
    base,
    opened,
    apply,
    factory,
    events,
    engines,
  };
}

describe("native Office session host", () => {
  it("autosaves UI edits to one working copy while preserving an unaccepted original", async () => {
    const f = await fixture();
    f.options.canSaveOriginal = async () => false;
    const changed = await f.service.executeFromUi(
      f.apply("manual", 0),
      f.context,
    );
    expect(changed.session.savedVersion).toBe(0);
    await vi.waitFor(
      async () => {
        expect(
          (await f.service.snapshotForUi(f.opened.session.sessionId, "task"))
            .session.savedVersion,
        ).toBe(1);
      },
      { timeout: 4000 },
    );
    const saved = await f.service.snapshotForUi(
      f.opened.session.sessionId,
      "task",
    );
    expect(saved.session.savePath).toMatch(/\.artemis-.*\.docx$/);
    expect(await readFile(join(f.root, saved.session.savePath!), "utf8")).toBe(
      "Edited",
    );
    expect(await readFile(join(f.root, f.base.path), "utf8")).toBe("Original");
    await f.service.executeFromUi(f.apply("manual-2", 1, "Again"), f.context);
    await f.service.executeFromUi(
      {
        ...f.base,
        operation: "save",
        sessionId: f.opened.session.sessionId,
        expectedVersion: 2,
      },
      f.context,
    );
    expect(await readFile(join(f.root, saved.session.savePath!), "utf8")).toBe(
      "Again",
    );
  });

  it("preserves an externally modified working copy and the pending draft", async () => {
    const f = await fixture();
    f.options.canSaveOriginal = async () => false;
    await f.service.executeFromUi(f.apply("manual", 0), f.context);
    const request = {
      ...f.base,
      operation: "save" as const,
      sessionId: f.opened.session.sessionId,
      expectedVersion: 1,
    };
    const saved = await f.service.executeFromUi(request, f.context);
    await writeFile(join(f.root, saved.session.savePath!), "External");
    await f.service.executeFromUi(f.apply("manual-2", 1, "Draft"), f.context);
    await expect(
      f.service.executeFromUi({ ...request, expectedVersion: 2 }, f.context),
    ).rejects.toThrow(/Working copy changed/);
    expect(await readFile(join(f.root, saved.session.savePath!), "utf8")).toBe(
      "External",
    );
    expect(
      (await f.service.snapshotForUi(request.sessionId, "task")).session
        .savedVersion,
    ).toBe(1);
  });
  it("does not background-save after Execute permission is withdrawn", async () => {
    const f = await fixture();
    f.options.canSaveOriginal = async () => false;
    await f.service.executeFromUi(f.apply("manual", 0), f.context);
    f.options.canAutoSave = () => false;
    const save = vi.spyOn(f.engines[0]!, "save");
    await new Promise((resolve) => setTimeout(resolve, 1700));
    await f.service.dispose();
    expect(save).not.toHaveBeenCalled();
    expect(
      (await f.service.snapshotForUi(f.opened.session.sessionId, "task"))
        .session.savedVersion,
    ).toBe(0);
  });

  it.each(["plan"] as const)(
    "rejects manual %s edits before accessing a session",
    async (mode) => {
      const f = await fixture();
      await expect(
        f.service.executeFromUi(f.apply("denied", 0), { ...f.context, mode }),
      ).rejects.toThrow("rejects Office sessions");
      expect(f.engines[0]!.text).toBe("Original");
    },
  );

  it("flushes pending autosave on shutdown and reopens the saved copy", async () => {
    const f = await fixture();
    f.options.canSaveOriginal = async () => false;
    await f.service.executeFromUi(f.apply("manual", 0), f.context);
    await f.service.dispose();
    const saved = await f.service.snapshotForUi(
      f.opened.session.sessionId,
      "task",
    );
    expect(saved.session.savedVersion).toBe(1);
    const restarted = new OfficeSessionService(f.options);
    services.push(restarted);
    const reopened = await restarted.openFile(
      saved.session.savePath!,
      f.context,
    );
    expect(reopened.targets[0]!.text).toBe("Edited");
  });
  it("opens a file from the UI with inferred format and reuses its session", async () => {
    const { service, context, opened, factory } = await fixture();
    const next = await service.openFile("稿件.docx", context);
    expect(next.session.sessionId).toBe(opened.session.sessionId);
    expect(factory).toHaveBeenCalledTimes(1);
    await expect(service.openFile("old.doc", context)).rejects.toThrow(
      /format/i,
    );
  });

  it.each(["plan"] as const)(
    "rejects UI opening in %s before filesystem access",
    async (mode) => {
      const factory = vi.fn();
      const service = new OfficeSessionService({
        root: "/does-not-exist",
        createEngine: factory,
        emit: vi.fn(),
        canSaveOriginal: async () => false,
      });
      services.push(service);
      await expect(
        service.openFile("missing.docx", {
          workspacePath: "/does-not-exist",
          threadId: "task",
          mode,
        }),
      ).rejects.toThrow(`${mode} mode rejects Office sessions`);
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it.each(["plan"] as const)(
    "rejects %s before constructing an engine or touching storage",
    async (mode) => {
      const factory = vi.fn();
      const service = new OfficeSessionService({
        root: "/does-not-exist",
        createEngine: factory,
        emit() {},
        canSaveOriginal: async () => true,
      });
      await expect(
        service.execute(
          {
            protocolVersion: 2,
            requestId: "id",
            path: "稿件.docx",
            format: "word",
            operation: "open",
          },
          { mode, threadId: "task", workspacePath: "/does-not-exist" },
        ),
      ).rejects.toThrow("rejects");
      expect(factory).not.toHaveBeenCalled();
    },
  );
  it("acknowledges operations independently of saving and deduplicates retries", async () => {
    const f = await fixture();
    const changed = await f.service.execute(f.apply("edit-1", 0), f.context);
    expect(changed.session).toMatchObject({
      version: 1,
      savedVersion: 0,
      status: "editing",
    });
    expect(await readFile(join(f.root, "稿件.docx"), "utf8")).toBe("Original");
    expect(
      (await f.service.execute(f.apply("edit-1", 0), f.context)).session
        .version,
    ).toBe(1);
    await expect(
      f.service.execute(f.apply("edit-1", 0, "Different"), f.context),
    ).rejects.toThrow("reused");
    await expect(
      f.service.execute(f.apply("edit-2", 0), f.context),
    ).rejects.toThrow("version conflict");
    const saved = await f.service.execute(
      {
        ...f.base,
        operation: "save",
        sessionId: changed.session.sessionId,
        expectedVersion: 1,
      },
      f.context,
    );
    expect(saved.session).toMatchObject({ savedVersion: 1, status: "saved" });
    expect(await readFile(join(f.root, "稿件.docx"), "utf8")).toBe("Edited");
    expect(f.events.filter((event) => event.kind === "applied")).toHaveLength(
      1,
    );
  });
  it("binds sessions to their task, workspace and source", async () => {
    const f = await fixture();
    await expect(
      f.service.execute(f.apply("edit", 0), {
        ...f.context,
        threadId: "other",
      }),
    ).rejects.toThrow("another task");
    await expect(
      f.service.execute(
        { ...f.apply("edit", 0), path: "other.docx" },
        f.context,
      ),
    ).rejects.toThrow("mismatch");
  });
  it("preserves external changes and refuses silent original overwrites", async () => {
    const f = await fixture();
    await f.service.execute(f.apply("edit", 0), f.context);
    await writeFile(join(f.root, "稿件.docx"), "External");
    await expect(
      f.service.execute(
        {
          ...f.base,
          operation: "save",
          sessionId: f.opened.session.sessionId,
          expectedVersion: 1,
        },
        f.context,
      ),
    ).rejects.toThrow("Original changed");
    expect(await readFile(join(f.root, "稿件.docx"), "utf8")).toBe("External");
  });
  it("reloads an external save when there is no draft and recovers the new baseline", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "稿件.docx"), "External revision");
    await vi.waitFor(
      async () => {
        const snapshot = await f.service.snapshotForUi(
          f.opened.session.sessionId,
          "task",
        );
        expect(snapshot.targets[0]?.text).toBe("External revision");
        expect(snapshot.session).toMatchObject({
          version: 1,
          savedVersion: 1,
          status: "saved",
        });
      },
      { timeout: 3000 },
    );
    await f.service.dispose();
    const restored = new OfficeSessionService(f.options);
    services.push(restored);
    const snapshot = await restored.execute(
      {
        ...f.base,
        operation: "snapshot",
        sessionId: f.opened.session.sessionId,
      },
      f.context,
    );
    expect(snapshot.targets[0]?.text).toBe("External revision");
    expect(snapshot.session.version).toBe(1);
  });
  it("keeps an unsaved draft when a watcher sees an external save", async () => {
    const f = await fixture();
    await f.service.execute(f.apply("edit", 0), f.context);
    await writeFile(join(f.root, "稿件.docx"), "External revision");
    await vi.waitFor(
      async () => {
        const snapshot = await f.service.snapshotForUi(
          f.opened.session.sessionId,
          "task",
        );
        expect(snapshot.session.status).toBe("conflict");
        expect(snapshot.targets[0]?.text).toBe("Edited");
      },
      { timeout: 3000 },
    );
  });
  it("recovers only committed operations after a partial engine failure", async () => {
    const f = await fixture();
    await f.service.execute(f.apply("first", 0, "Accepted"), f.context);
    f.engines[0]!.failNext = true;
    await expect(
      f.service.execute(f.apply("uncertain", 1, "Uncertain"), f.context),
    ).rejects.toThrow("crashed");
    const recovered = await f.service.execute(
      {
        ...f.base,
        operation: "snapshot",
        sessionId: f.opened.session.sessionId,
      },
      f.context,
    );
    expect(recovered.session).toMatchObject({ version: 1, savedVersion: 0 });
    expect(recovered.targets[0]!.text).toBe("Accepted");
    expect(f.factory).toHaveBeenCalledTimes(2);
  });
  it("does not discard a live unsaved draft when a tab/session closes", async () => {
    const f = await fixture();
    await f.service.execute(f.apply("edit", 0), f.context);
    await expect(
      f.service.execute(
        {
          ...f.base,
          operation: "close",
          sessionId: f.opened.session.sessionId,
          discard: false,
        },
        f.context,
      ),
    ).rejects.toThrow("unsaved");
    expect(await readFile(join(f.root, "稿件.docx"), "utf8")).toBe("Original");
  });

  it("blocks unaccepted native overwrites before calling the engine", async () => {
    const f = await fixture();
    f.options.canSaveOriginal = async () => false;
    await f.service.execute(f.apply("edit", 0), f.context);
    const save = vi.spyOn(f.engines[0]!, "save");
    await expect(
      f.service.execute(
        {
          ...f.base,
          operation: "save",
          sessionId: f.opened.session.sessionId,
          expectedVersion: 1,
        },
        f.context,
      ),
    ).rejects.toThrow("not been accepted");
    expect(save).not.toHaveBeenCalled();
    expect(await readFile(join(f.root, "稿件.docx"), "utf8")).toBe("Original");
    expect(
      (await f.service.snapshotForUi(f.opened.session.sessionId, "task"))
        .session.savedVersion,
    ).toBe(0);
  });

  it("refuses a tampered recovery baseline before constructing another engine", async () => {
    const f = await fixture();
    await f.service.execute(f.apply("edit", 0), f.context);
    await f.service.dispose();
    const [directory] = await readdir(f.options.root);
    await writeFile(
      join(f.options.root, directory!, "original.docx"),
      "Changed baseline",
    );
    const recovered = new OfficeSessionService(f.options);
    services.push(recovered);
    await expect(
      recovered.execute(
        {
          ...f.base,
          operation: "snapshot",
          sessionId: f.opened.session.sessionId,
        },
        f.context,
      ),
    ).rejects.toThrow("baseline was changed");
    expect(f.factory).toHaveBeenCalledTimes(1);
  });

  it("deduplicates simultaneous opens and rejects another task owning the same original", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "concurrent.docx"), "Original");
    const request = {
      ...f.base,
      path: "concurrent.docx",
      operation: "open" as const,
    };
    const [first, second] = await Promise.all([
      f.service.execute(request, f.context),
      f.service.execute(request, f.context),
    ]);
    expect(first.session.sessionId).toBe(second.session.sessionId);
    expect(f.factory).toHaveBeenCalledTimes(2);
    await expect(
      f.service.execute(request, { ...f.context, threadId: "other" }),
    ).rejects.toThrow("another task");
    expect(f.factory).toHaveBeenCalledTimes(2);
  });
});
