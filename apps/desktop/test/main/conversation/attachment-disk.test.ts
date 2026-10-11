import { it, expect, vi } from "vitest";
import { mkdtemp, open, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore } from "../../../src/main/conversation/attachment-store.js";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});
it("reports exhausted disk space and removes the incomplete original", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-disk-full-"));
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  try {
    const source = join(root, "source.txt");
    await writeFile(source, "data");
    vi.mocked(open).mockImplementation(async (...args) => {
      const file = await actual.open(...args);
      if (String(args[0]).endsWith("original.partial"))
        vi.spyOn(file, "write").mockRejectedValue(
          Object.assign(new Error("disk full"), { code: "ENOSPC" }),
        );
      return file;
    });
    const store = new AttachmentStore(join(root, "store"));
    await expect(store.importPath(source)).rejects.toThrow(
      "Not enough disk space",
    );
    expect(await readdir(join(root, "store"))).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
