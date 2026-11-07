import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Thread } from "@artemis/protocol";
import { createDesignWorkspaceToolHandlers } from "../../../src/main/design/design-plugin-workspace-tools.js";

let directory: string;
let workspace: string;
let tools: ReturnType<typeof createDesignWorkspaceToolHandlers>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "s4-loop-"));
  workspace = join(directory, "workspace");
  await mkdir(workspace);
  const now = new Date().toISOString();
  const thread: Thread = {
    id: "design",
    projectId: "project",
    title: "Design",
    mode: "work",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  tools = createDesignWorkspaceToolHandlers({
    getThread: () => thread,
    resolveWorkspace: async () => ({ workspacePath: workspace }),
  });
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

const write = (path: string, content: string, find?: string) =>
  tools.writeWorkspacePage!({
    threadId: "design",
    path,
    content,
    ...(find !== undefined ? { find } : {}),
  });
async function version(
  toolName: "undo" | "redo" | "restore_version" | "list_versions",
  path: string,
  revision?: string,
) {
  const result = await tools.designVersionOp!({
    threadId: "design",
    toolName,
    path,
    ...(revision ? { revision } : {}),
  });
  return result.ok ? JSON.parse(result.result) : result;
}

describe("workspace design product loop", () => {
  it("writes a standalone HTML page and exposes it in the project inventory", async () => {
    const html =
      "<!DOCTYPE html><html><head><title>Account</title></head><body>unique brief</body></html>";
    expect(await write("account.html", html)).toMatchObject({
      ok: true,
      path: "account.html",
    });
    expect(await readFile(join(workspace, "account.html"), "utf8")).toBe(html);
    const inventory = await tools.getWorkspaceSnapshot!({ threadId: "design" });
    expect(inventory.status).toBe("succeeded");
    expect(JSON.parse(inventory.output!).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "account.html" }),
      ]),
    );
  });
  it("keeps immutable snapshots when applying a unique targeted edit", async () => {
    await write("account.html", "updated brief", "unique brief");
    const history = await version("list_versions", "account.html");
    expect(history.versions).toHaveLength(2);
    expect(history.versions[0].revision).not.toBe(history.versions[1].revision);
    expect(await readFile(join(workspace, "account.html"), "utf8")).toContain(
      "updated brief",
    );
  });
  it("serializes same-base edits so only one unique-find request can apply", async () => {
    await write("concurrent.html", "base");
    const results = await Promise.allSettled([
      write("concurrent.html", "first", "base"),
      write("concurrent.html", "second", "base"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await readFile(join(workspace, "concurrent.html"), "utf8")).toBe(
      ["first", "second"][
        results.findIndex((result) => result.status === "fulfilled")
      ],
    );
    expect(
      results.find((result) => result.status === "rejected")?.reason.message,
    ).toContain("exactly once");
    expect(
      (await version("list_versions", "concurrent.html")).versions,
    ).toHaveLength(2);
  });
  it("rejects ambiguous find instead of selecting its first occurrence", async () => {
    await write("ambiguous.html", "repeat repeat");
    await expect(write("ambiguous.html", "bad", "repeat")).rejects.toThrow(
      "exactly once",
    );
    expect(await readFile(join(workspace, "ambiguous.html"), "utf8")).toBe(
      "repeat repeat",
    );
  });
  it("undo and redo write the selected version and keep the immutable history", async () => {
    await write("undo.html", "before");
    await write("undo.html", "after");
    const history = await version("list_versions", "undo.html");
    expect((await version("undo", "undo.html")).revision).toBe(
      history.versions[0].revision,
    );
    expect(await readFile(join(workspace, "undo.html"), "utf8")).toBe("before");
    expect(
      (await version("list_versions", "undo.html")).versions.map(
        (item: { current: boolean }) => item.current,
      ),
    ).toEqual([true, false]);
    expect((await version("redo", "undo.html")).revision).toBe(
      history.versions[1].revision,
    );
    expect(await readFile(join(workspace, "undo.html"), "utf8")).toBe("after");
    expect((await version("list_versions", "undo.html")).versions).toHaveLength(
      2,
    );
  });
  it("refuses undo on a single-version page", async () => {
    await write("single.html", "single");
    expect(await version("undo", "single.html")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/nothing to undo/i),
    });
  });
  it("rejects legacy document identities and path traversal", async () => {
    await expect(write("../../outside.html", "bad")).rejects.toThrow();
    await expect(version("list_versions", "seed-customer")).rejects.toThrow();
  });
});

describe("S4 handoff idempotency (store-level)", () => {
  it("same handoffId never creates twice (operation dedup)", async () => {
    const { AppStore } = await import("../../../src/main/settings/store.js");
    const { randomUUID } = await import("node:crypto");
    const store = new AppStore(join(directory, "handoff.sqlite"));
    const now = new Date().toISOString();
    const threadId = randomUUID();
    store.createThread({
      id: threadId,
      title: "handoff源",
      mode: "work",
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
