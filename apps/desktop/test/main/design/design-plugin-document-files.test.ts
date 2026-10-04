import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteDesignDocument,
  readDesignDocumentLedger,
  readDesignDocumentVersionBytes,
  resolveDesignDocumentDirectory,
} from "../../../src/main/design/design-plugin-document-files.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const id = "12345678-1234-1234-1234-123456789abc";
const version = "v1-abcdef.html";
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "design-doc-files-"));
  roots.push(root);
  const data = join(root, "task", "data");
  const outside = join(root, "outside");
  await mkdir(join(data, "documents"), { recursive: true });
  await mkdir(join(outside, id), { recursive: true });
  await writeFile(join(outside, id, version), "private content");
  return { data, outside, dir: join(data, "documents", id) };
}

describe("host document files remain inside their task", () => {
  it.each(["document", "documents"])(
    "rejects a planted %s directory link for reads and deletion",
    async (kind) => {
      const { data, outside, dir } = await setup();
      if (kind === "documents") {
        await rm(join(data, "documents"), { recursive: true });
        await symlink(outside, join(data, "documents"), "junction");
      } else await symlink(join(outside, id), dir, "junction");
      await expect(resolveDesignDocumentDirectory(data, id)).rejects.toThrow(
        /symbolic link/,
      );
      await expect(
        readDesignDocumentVersionBytes(data, dir, version),
      ).rejects.toThrow();
      await expect(deleteDesignDocument(data, id)).rejects.toThrow();
      expect(await readFile(join(outside, id, version), "utf8")).toBe(
        "private content",
      );
    },
  );

  it("rejects linked version files and a linked ledger without modifying outside files", async () => {
    const { data, outside, dir } = await setup();
    await mkdir(dir);
    const secret = join(outside, id, version);
    await symlink(secret, join(dir, version));
    await symlink(secret, join(data, "design-documents.jsonl"));
    await expect(
      readDesignDocumentVersionBytes(data, dir, version),
    ).rejects.toThrow();
    await expect(readDesignDocumentLedger(data)).rejects.toThrow();
    await expect(deleteDesignDocument(data, id)).rejects.toThrow();
    expect(await readFile(secret, "utf8")).toBe("private content");
  });

  it("reads a normal document, enforces size limits, and persists deletion", async () => {
    const { data, dir } = await setup();
    await mkdir(dir);
    await writeFile(join(dir, version), "design");
    expect(
      (await readDesignDocumentVersionBytes(data, dir, version)).toString(),
    ).toBe("design");
    await expect(
      readDesignDocumentVersionBytes(data, dir, version, 2),
    ).rejects.toThrow();
    await deleteDesignDocument(data, id);
    expect(JSON.parse(await readDesignDocumentLedger(data))).toMatchObject({
      id,
      deleted: true,
    });
    await expect(readFile(join(dir, version))).rejects.toThrow();
  });
});
