import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore } from "../../../src/main/conversation/attachment-store.js";
const fault = vi.hoisted(() => ({ kill: false }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: (...args: Parameters<typeof actual.fork>) => {
      const child = actual.fork(...args);
      if (fault.kill) {
        fault.kill = false;
        child.once("spawn", () => child.kill("SIGKILL"));
      }
      return child;
    },
  };
});
it("reports a parser process exit and permits retry from the independent original", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-worker-exit-"));
  try {
    const path = join(root, "original.txt");
    await writeFile(path, "recoverable text");
    const store = new AttachmentStore(join(root, "store"));
    const ref = await store.importPath(path);
    await rm(path);
    fault.kill = true;
    const failed = await store.prepare(ref.id);
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("worker exited");
    expect((await store.prepare(ref.id)).status).toBe("ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
