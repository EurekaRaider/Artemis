import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

interface MemoryEntry {
  title: string;
  content: string;
  keywords: string[];
}

interface MemoryStoreInstance {
  snapshot(): Promise<{ path: string; content: string }>;
  append(entry: MemoryEntry): Promise<{ appended: boolean }>;
}

interface MemoryStoreModule {
  MemoryStore: new (
    filePath: string,
    options?: { maxBytes?: number },
  ) => MemoryStoreInstance;
  PROJECT_MEMORY_MAX_BYTES: number;
  GLOBAL_MEMORY_MAX_BYTES: number;
  resolveMemoryPaths(
    workspacePath: string,
    homePath: string,
  ): { project: string; global: string };
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function loadMemoryStore(): Promise<MemoryStoreModule> {
  const sourcePath = join(
    dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1")),
    "../src/main/memory-store.ts",
  );
  expect(
    await readFile(sourcePath, "utf8").catch(() => undefined),
    "MemoryStore production module is missing",
  ).toBeTypeOf("string");
  return import(
    /* @vite-ignore */ pathToFileURL(sourcePath).href
  ) as Promise<MemoryStoreModule>;
}

async function createWorkspace(): Promise<{
  root: string;
  workspace: string;
  home: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "artemis-memory-"));
  cleanupPaths.push(root);
  return {
    root,
    workspace: join(root, "workspace"),
    home: join(root, "home"),
  };
}

const NINJA_WORKFLOW: MemoryEntry = {
  title: "Recover a Windows Ninja target rebuild",
  content:
    "When a target rebuild appears stuck, inspect matching ninja, cl, and link processes first. Clean only the named target, rebuild it, then verify the artifact timestamp and that Ninja reports no work to do.",
  keywords: ["windows", "cmake", "ninja", "target-only", "rebuild"],
};

describe("MemoryStore", () => {
  it("isolates project memory by workspace and keeps global memory explicit", async () => {
    const { resolveMemoryPaths } = await loadMemoryStore();
    const { root, home } = await createWorkspace();
    const first = resolveMemoryPaths(join(root, "project-a"), home);
    const second = resolveMemoryPaths(join(root, "project-b"), home);

    expect(first.project).toBe(
      join(root, "project-a", ".artemis", "MEMORY.md"),
    );
    expect(second.project).toBe(
      join(root, "project-b", ".artemis", "MEMORY.md"),
    );
    expect(first.project).not.toBe(second.project);
    expect(first.global).toBe(join(home, ".pi", "agent", "MEMORY.md"));
    expect(second.global).toBe(first.global);
  });

  it("atomically appends a structured entry and deduplicates it", async () => {
    const { MemoryStore, resolveMemoryPaths } = await loadMemoryStore();
    const { workspace, home } = await createWorkspace();
    const path = resolveMemoryPaths(workspace, home).project;
    const store = new MemoryStore(path);

    expect(await store.snapshot()).toEqual({ path, content: "" });
    expect(await store.append(NINJA_WORKFLOW)).toEqual({ appended: true });
    const firstContent = await readFile(path, "utf8");
    expect(firstContent).toContain(`## ${NINJA_WORKFLOW.title}`);
    expect(firstContent).toContain(
      `Keywords: ${NINJA_WORKFLOW.keywords.join(", ")}`,
    );
    expect(firstContent).toContain(NINJA_WORKFLOW.content);

    expect(await store.append(NINJA_WORKFLOW)).toEqual({ appended: false });
    expect(await readFile(path, "utf8")).toBe(firstContent);
    expect(
      firstContent.match(new RegExp(`## ${NINJA_WORKFLOW.title}`, "gu")),
    ).toHaveLength(1);
    expect(await readdir(dirname(path))).not.toContain("MEMORY.md.tmp");
  });

  it("uses a smaller global quota than the project-memory quota", async () => {
    const { GLOBAL_MEMORY_MAX_BYTES, PROJECT_MEMORY_MAX_BYTES } =
      await loadMemoryStore();

    expect(GLOBAL_MEMORY_MAX_BYTES).toBeGreaterThan(0);
    expect(PROJECT_MEMORY_MAX_BYTES).toBeGreaterThan(GLOBAL_MEMORY_MAX_BYTES);
  });

  it("rejects oversized, malformed-Unicode, and secret-bearing entries without changing memory", async () => {
    const { GLOBAL_MEMORY_MAX_BYTES, MemoryStore, resolveMemoryPaths } =
      await loadMemoryStore();
    const { workspace, home } = await createWorkspace();
    const path = resolveMemoryPaths(workspace, home).global;
    const store = new MemoryStore(path, { maxBytes: GLOBAL_MEMORY_MAX_BYTES });
    await store.append(NINJA_WORKFLOW);
    const before = await readFile(path, "utf8");

    await expect(
      store.append({
        ...NINJA_WORKFLOW,
        title: "Oversized workflow",
        content: "x".repeat(GLOBAL_MEMORY_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/size|large|bytes/iu);
    await expect(
      store.append({
        ...NINJA_WORKFLOW,
        title: "Malformed \uD800 title",
      }),
    ).rejects.toThrow(/unicode|utf-?8/iu);
    await expect(
      store.append({
        ...NINJA_WORKFLOW,
        title: "Leaked credential workflow",
        content:
          "Reuse this credential in later runs: Authorization: Bearer sk-test-not-a-real-secret-123456789.",
      }),
    ).rejects.toThrow(/credential|secret|token/iu);

    expect(await readFile(path, "utf8")).toBe(before);
  });
});
