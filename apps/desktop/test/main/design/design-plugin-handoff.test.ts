import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppStore } from "../../../src/main/settings/store.js";
import { createDesignHandoffHandler } from "../../../src/main/design/design-plugin-handoff.js";

let root: string;
let store: AppStore;
afterEach(async () => {
  store?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it("concurrent and later handoffs create one coding task and retain the project file identity", async () => {
  root = await mkdtemp(join(tmpdir(), "design-handoff-"));
  store = new AppStore(join(root, "state.sqlite"));
  const threadId = randomUUID();
  const documentId = "panel-project:account.html";
  const projectId = randomUUID();
  const now = new Date().toISOString();
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  store.upsertProject({
    id: projectId,
    name: "design",
    path: workspace,
    createdAt: now,
    updatedAt: now,
  });
  store.createThread({
    id: threadId,
    projectId,
    title: "design",
    mode: "work",
    target: "local",
    status: "idle",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
    typeBinding: {
      installationId: "design",
      pluginId: "design",
      typeId: "design",
      pluginVersion: "1",
      contentHash: "a".repeat(64),
      bindingRevision: "rev",
    },
  });
  await writeFile(join(workspace, "account.html"), "design");
  const resolveWorkspace = async () => ({ workspacePath: workspace });
  const handoff = createDesignHandoffHandler(() => store, resolveWorkspace);
  const results = await Promise.all(
    Array.from({ length: 3 }, () => handoff({ threadId, documentId })),
  );
  expect(new Set(results.map((result) => result.threadId)).size).toBe(1);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  const target = results[0]!.threadId;
  expect(store.listThreads()).toHaveLength(2);
  expect(store.getThreadGoal(target)?.objective).toContain("account.html");
  expect(store.getThread(target)?.projectId).toBe(projectId);
  await writeFile(join(workspace, "account.html"), "changed source");
  const repeated = await createDesignHandoffHandler(
    () => store,
    resolveWorkspace,
  )({ threadId, documentId });
  expect(repeated).toEqual({ threadId: target, created: false });
  await writeFile(join(root, "secret.html"), "private");
  await symlink(join(root, "secret.html"), join(workspace, "escape.html"));
  await expect(
    handoff({ threadId, documentId: "panel-project:escape.html" }),
  ).rejects.toThrow();
  store.updateThread(threadId, { archived: true });
  await expect(handoff({ threadId, documentId })).rejects.toThrow();
});
