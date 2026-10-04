import { constants } from "node:fs";
import { open, realpath, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { readWorkspaceFileBytes } from "./design-plugin-project-files.js";

export function requireDesignDocumentId(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!/^[0-9a-f][0-9a-f-]{7,63}$/.test(id)) {
    throw new Error("Invalid design document id.");
  }
  return id;
}

/** Directory links are not part of the document format. Anchor both levels
 * to the task root; treating a resolved document directory as its own trust
 * boundary would allow another task's files to be read or deleted. */
export async function resolveDesignDocumentDirectory(
  dataRoot: string,
  id: string,
): Promise<string> {
  const root = await realpath(dataRoot);
  const directory = join(root, "documents", requireDesignDocumentId(id));
  if ((await realpath(directory)) !== directory) {
    throw new Error(
      "Document directory escapes its task or uses a symbolic link.",
    );
  }
  return directory;
}

export async function readDesignDocumentVersionBytes(
  dataRoot: string,
  documentDir: string,
  entry: string,
  maxBytes = 8 * 1024 * 1024,
): Promise<Buffer> {
  if (basename(entry) !== entry) throw new Error("Invalid document file name.");
  const directory = await resolveDesignDocumentDirectory(
    dataRoot,
    basename(documentDir),
  );
  const result = await readWorkspaceFileBytes(
    directory,
    join(directory, entry),
    maxBytes,
  );
  if (
    !result ||
    (await resolveDesignDocumentDirectory(dataRoot, basename(documentDir))) !==
      directory
  ) {
    throw new Error("Document file is unreadable or unsafe.");
  }
  return result.bytes;
}

export async function readDesignDocumentLedger(
  dataRoot: string,
): Promise<string> {
  const root = await realpath(dataRoot);
  const result = await readWorkspaceFileBytes(
    root,
    join(root, "design-documents.jsonl"),
    8 * 1024 * 1024,
  );
  if (!result) throw new Error("Document ledger is unreadable or unsafe.");
  return result.bytes.toString("utf8");
}

export async function deleteDesignDocument(
  dataRoot: string,
  documentId: string,
): Promise<void> {
  const directory = await resolveDesignDocumentDirectory(dataRoot, documentId);
  const root = await realpath(dataRoot);
  // Refuse a planted ledger symlink before deleting anything. Never fall
  // back to an unchecked appendFile on a runtime-controlled path.
  const ledger = await open(
    join(root, "design-documents.jsonl"),
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!(await ledger.stat()).isFile())
      throw new Error("Document ledger is not a file.");
    await resolveDesignDocumentDirectory(dataRoot, documentId);
    await rm(directory, { recursive: true, force: true });
    await ledger.writeFile(
      `${JSON.stringify({ id: documentId, deleted: true, deletedAt: new Date().toISOString() })}\n`,
    );
  } finally {
    await ledger.close();
  }
}

export async function resolveHeadVersionEntry(
  dataRoot: string,
  documentDir: string,
  entries: string[],
): Promise<string | undefined> {
  const sequence = (entry: string): number =>
    Number(/^v(\d+)-/.exec(entry)?.[1] ?? 0);
  const versionFiles = entries
    .filter((entry) => /^v\d+-[0-9a-f]+\.html$/.test(entry))
    .sort((a, b) => sequence(a) - sequence(b));
  if (versionFiles.length === 0) return undefined;
  const marker = (
    await readDesignDocumentVersionBytes(
      dataRoot,
      documentDir,
      "HEAD",
      1024,
    ).catch(() => null)
  )
    ?.toString("utf8")
    ?.trim();
  if (!marker) return versionFiles.at(-1);
  const [seq, rev] = marker.split("-");
  return (
    versionFiles.find((entry) => entry === `v${seq}-${rev}.html`) ??
    versionFiles.at(-1)
  );
}
