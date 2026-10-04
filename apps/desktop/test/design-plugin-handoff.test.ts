import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AppStore } from "../src/main/store.js";
import { createDesignHandoffHandler } from "../src/main/design-plugin-handoff.js";

let root: string;
let store: AppStore;
afterEach(async () => {
  store?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

it("concurrent and later handoffs create one coding task and preserve the frozen materials", async () => {
  root = await mkdtemp(join(tmpdir(), "design-handoff-"));
  store = new AppStore(join(root, "state.sqlite"));
  const threadId = randomUUID();
  const documentId = randomUUID();
  const now = new Date().toISOString();
  store.createThread({
    id: threadId,
    title: "design",
    mode: "execute",
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
  const data = join(root, "plugin-scratch", threadId, "data");
  const dir = join(data, "documents", documentId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "v1-abcdef.html"), "frozen design");
  await writeFile(join(dir, "HEAD"), "1-abcdef");
  await writeFile(
    join(data, "design-documents.jsonl"),
    JSON.stringify({
      id: documentId,
      name: "account.html",
      brief: "Account settings",
    }),
  );
  const handoff = createDesignHandoffHandler(() => store, root);
  const results = await Promise.all(
    Array.from({ length: 3 }, () => handoff({ threadId, documentId })),
  );
  expect(new Set(results.map((result) => result.threadId)).size).toBe(1);
  expect(results.filter((result) => result.created)).toHaveLength(1);
  const target = results[0]!.threadId;
  expect(store.listThreads()).toHaveLength(2);
  expect(store.getThreadGoal(target)?.objective).toContain("material.md");
  const material = join(root, "design-handoffs", target, "material.md");
  expect(await readFile(material, "utf8")).toContain("Account settings");
  await writeFile(join(dir, "v1-abcdef.html"), "changed source");
  const repeated = await createDesignHandoffHandler(
    () => store,
    root,
  )({ threadId, documentId });
  expect(repeated).toEqual({ threadId: target, created: false });
  expect(
    await readFile(
      join(root, "design-handoffs", target, "v1-abcdef.html"),
      "utf8",
    ),
  ).toBe("frozen design");
});
