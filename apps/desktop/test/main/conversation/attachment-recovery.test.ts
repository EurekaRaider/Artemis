import { it, expect } from "vitest";
import {
  mkdtemp,
  writeFile,
  rm,
  readdir,
  mkdir,
  readFile,
} from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AttachmentIndex,
  indexText,
} from "../../../src/main/conversation/attachment-index.js";
import { processAttachment } from "../../../src/main/conversation/attachment-worker.js";
import { AttachmentStore } from "../../../src/main/conversation/attachment-store.js";
it("resumes committed UTF-8 blocks across a parser restart without duplicating or losing text", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-index-recovery-"));
  try {
    const path = join(root, "original"),
      output = join(root, "text.sqlite");
    const content = '中文😀,"多行\n值"\n'.repeat(30000) + "末尾";
    await writeFile(path, content);
    const index = new AttachmentIndex(`${output}.partial`, true);
    let calls = 0;
    await expect(
      indexText(path, index, () => {
        if (++calls === 3) throw new Error("interrupted");
      }),
    ).rejects.toThrow("interrupted");
    index.close();
    const result = (await processAttachment({
      action: "parse",
      path,
      output,
      mimeType: "text/plain",
    })) as { characters: number };
    expect(result.characters).toBe(content.length);
    const read = (await processAttachment({
      action: "read",
      path: output,
      mimeType: "text/plain",
      offset: content.length - 2,
    })) as { text: string };
    expect(read.text).toBe("末尾");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("cleans incomplete copies, rejects source changes and supports cancelled import retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-copy-recovery-"));
  try {
    const storage = join(root, "store"),
      id = randomUUID();
    await mkdir(join(storage, id), { recursive: true });
    await writeFile(join(storage, id, "original.partial"), "half");
    const path = join(root, "source.txt");
    await writeFile(path, "original");
    let change = true;
    const store = new AttachmentStore(storage, (progress) => {
      if (change && progress.status === "saving") {
        change = false;
        writeFileSync(path, "changed-size");
      }
    });
    await expect(store.importPath(path)).rejects.toThrow(/changed/);
    expect(await readdir(storage)).toEqual([]);
    const controller = new AbortController();
    controller.abort();
    await expect(store.importPath(path, controller.signal)).rejects.toThrow();
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    expect(
      JSON.stringify(
        await store.operate("task", { action: "read", id: ref.id }),
      ),
    ).toContain("changed-size");
    // Older ready records have their cache rebuilt on demand, retaining the original.
    const recordPath = join(storage, ref.id, "record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    delete record.indexVersion;
    await writeFile(recordPath, JSON.stringify(record));
    await rm(join(storage, ref.id, "text.sqlite"));
    expect(
      JSON.stringify(
        await new AttachmentStore(storage).operate("task", {
          action: "read",
          id: ref.id,
        }),
      ),
    ).toContain("changed-size");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("reports per-item failures and retries a cancelled saved-original operation", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-import-cancel-"));
  try {
    const path = join(root, "retry.txt");
    await writeFile(path, "retry content");
    const events: Array<{ id: string; status: string }> = [];
    let cancel = true;
    const store = new AttachmentStore(join(root, "store"), (progress) => {
      events.push(progress);
      if (cancel && progress.status === "queued") {
        cancel = false;
        void store.discardDraft(progress.id);
      }
    });
    await expect(store.importPath(path)).rejects.toThrow();
    const failure = events.find((event) => event.status === "error")!;
    expect(failure).toBeDefined();
    const ref = await store.retryImport(failure.id);
    expect(ref.status).toBe("pending");
    expect(events.at(-1)?.status).toBe("saved");
    expect(await readdir(join(root, "store"))).toEqual([ref.id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
