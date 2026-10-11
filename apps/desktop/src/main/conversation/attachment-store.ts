import { randomUUID } from "node:crypto";
import {
  rename,
  open,
  mkdir,
  readFile,
  writeFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import { extname, join, isAbsolute } from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  isAttachmentReference,
  estimateTextTokens,
  promptAttachmentsSchema,
  type PromptAttachment,
  type PromptAttachmentReference,
  type AttachmentOperation,
} from "@artemis/protocol";
import type { AttachmentImportProgress } from "../../shared/api.js";
import type { AttachmentWork } from "./attachment-worker.js";

const mimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
interface RecordData {
  ref: PromptAttachmentReference;
  owners: string[];
  extractedText?: boolean;
  indexVersion?: number | undefined;
}
interface ImageResult {
  data: string;
  mimeType: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  thumbnail: string;
}
let active = 0;
const waiting: Array<() => void> = [];
async function runWork<T>(
  work: AttachmentWork,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (active >= 2)
    await new Promise<void>((resolve, reject) => {
      const acquire = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        const index = waiting.indexOf(acquire);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error("Attachment processing cancelled"));
      };
      waiting.push(acquire);
      signal?.addEventListener("abort", abort, { once: true });
    });
  else active++;
  try {
    signal?.throwIfAborted();
    const electron = process.versions.electron
      ? await import("electron")
      : undefined;
    return await new Promise<T>((resolve, reject) => {
      const source = import.meta.url.endsWith(".ts");
      const workerPath = fileURLToPath(
        new URL(
          source ? "./attachment-worker.ts" : "./attachment-worker.js",
          import.meta.url,
        ),
      );
      const env = Object.fromEntries(
        [
          "PATH",
          "SystemRoot",
          "WINDIR",
          "TEMP",
          "TMP",
          "TMPDIR",
          "LANG",
          "LC_ALL",
        ].flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]!]],
        ),
      );
      const utility = electron?.utilityProcess.fork(workerPath, [], {
        serviceName: "Artemis attachment parser",
        stdio: "ignore",
        execArgv: ["--max-old-space-size=512"],
        env,
      });
      const nodeChild = utility
        ? undefined
        : fork(workerPath, [], {
            env,
            execArgv: ["--max-old-space-size=512"],
            stdio: ["ignore", "ignore", "ignore", "ipc"],
          });
      const child = (utility ?? nodeChild)!;
      let settled = false;
      const finish = (error?: Error, result?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (utility) utility.kill();
        else nodeChild?.kill("SIGKILL");
        if (error) reject(error);
        else resolve(result!);
      };
      const abort = () => finish(new Error("Attachment processing cancelled"));
      const timer = setTimeout(
        () =>
          finish(
            new Error("Attachment processing made no progress for 60 seconds"),
          ),
        60000,
      );
      signal?.addEventListener("abort", abort, { once: true });
      nodeChild?.on("error", (error) => finish(error));
      utility?.on("exit", () =>
        finish(new Error("Attachment worker exited before completion")),
      );
      nodeChild?.on("exit", () =>
        finish(new Error("Attachment worker exited before completion")),
      );
      child.on(
        "message",
        (message: { result?: T; error?: string; progress?: boolean }) => {
          if (message.progress) {
            timer.refresh();
            return;
          }
          finish(
            message.error ? new Error(message.error) : undefined,
            message.result,
          );
        },
      );
      if (utility) utility.postMessage(work);
      else nodeChild!.send(work);
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
    throw new Error("Invalid attachment identifier");
  return id;
}
export class AttachmentStore {
  private copyActive = 0;
  private copyWaiting: Array<() => void> = [];
  private preparations = new Map<string, Promise<PromptAttachmentReference>>();
  private tail: Promise<unknown> = Promise.resolve();
  private imports = new Map<string, AbortController>();
  private failedImports = new Map<string, string>();
  private readonly recovery: Promise<void>;
  constructor(
    private readonly root: string,
    private readonly onImportProgress?: (
      progress: AttachmentImportProgress,
    ) => void,
  ) {
    this.recovery = this.cleanInterruptedCopies();
  }
  private async cleanInterruptedCopies() {
    for (const id of await readdir(this.root).catch(() => [])) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
      try {
        await stat(join(this.directory(id), "record.json"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          await rm(this.directory(id), { recursive: true, force: true });
        else throw error;
      }
    }
  }
  async retryImport(id: string) {
    const path = this.failedImports.get(id);
    if (!path)
      throw new Error(
        "Import is no longer available for retry; select the file again",
      );
    this.failedImports.delete(id);
    return this.importPath(path);
  }
  private directory(id: string) {
    return join(this.root, safeId(id));
  }
  private async record(id: string): Promise<RecordData> {
    return JSON.parse(
      await readFile(join(this.directory(id), "record.json"), "utf8"),
    ) as RecordData;
  }
  private async save(record: RecordData) {
    await writeFile(
      join(this.directory(record.ref.id), "record.json.partial"),
      JSON.stringify(record),
      { mode: 0o600 },
    );
    await rename(
      join(this.directory(record.ref.id), "record.json.partial"),
      join(this.directory(record.ref.id), "record.json"),
    );
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
  async importPaths(
    paths: string[],
  ): Promise<{ attachments: PromptAttachmentReference[]; errors: string[] }> {
    const attachments: PromptAttachmentReference[] = [],
      errors: string[] = [];
    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          return { ref: await this.importPath(path) };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    for (const result of results) {
      if (result.ref) attachments.push(result.ref);
      else if (result.error) errors.push(result.error);
    }
    return { attachments, errors };
  }
  async discardDraft(id: string): Promise<void> {
    this.imports.get(id)?.abort();
    await this.locked(async () => {
      const record = await this.record(id).catch(() => undefined);
      if (record && !record.owners.length)
        await rm(this.directory(id), { recursive: true, force: true });
    });
  }
  async importPath(
    path: string,
    signal?: AbortSignal,
  ): Promise<PromptAttachmentReference> {
    await this.recovery;
    const id = randomUUID();
    const name = path.split(/[\\/]/).pop()!;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const copySignal = controller.signal;
    this.imports.set(id, controller);
    let copied = 0,
      total = 0,
      reported = 0;
    const report = (
      status: AttachmentImportProgress["status"],
      error?: string,
    ) =>
      this.onImportProgress?.({
        id,
        name,
        status,
        copied,
        total,
        ...(error ? { error } : {}),
      });
    report("queued");
    let directory: string | undefined;
    let acquired = false;
    try {
      copySignal.throwIfAborted();
      if (this.copyActive >= 2)
        await new Promise<void>((resolve, reject) => {
          const acquire = () => {
            copySignal.removeEventListener("abort", cancel);
            resolve();
          };
          const cancel = () => {
            const i = this.copyWaiting.indexOf(acquire);
            if (i >= 0) this.copyWaiting.splice(i, 1);
            reject(new Error("Attachment saving cancelled"));
          };
          this.copyWaiting.push(acquire);
          copySignal.addEventListener("abort", cancel, { once: true });
        });
      else this.copyActive++;
      acquired = true;
      copySignal.throwIfAborted();
      if (!isAbsolute(path))
        throw new Error("Attachment path must be absolute");
      const source = await open(path, "r");
      try {
        const info = await source.stat();
        if (!info.isFile() || !Number.isSafeInteger(info.size))
          throw new Error("Attachment is not a supported regular file");
        total = info.size;
        report("saving");
        const mimeType = mimeTypes[extname(path).toLowerCase()] ?? "text/plain";
        const ref: PromptAttachmentReference = {
          type: "attachment",
          id,
          name,
          mimeType,
          kind: mimeType.startsWith("image/") ? "image" : "file",
          size: info.size,
          status: "pending",
        };
        directory = this.directory(ref.id);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const output = await open(
          join(directory, "original.partial"),
          "wx",
          0o600,
        );
        try {
          const buffer = Buffer.allocUnsafe(1024 * 1024);
          copied = 0;
          while (copied < info.size) {
            copySignal.throwIfAborted();
            const { bytesRead } = await source.read(
              buffer,
              0,
              Math.min(buffer.length, info.size - copied),
              copied,
            );
            if (!bytesRead)
              throw new Error(`Attachment changed while copying: ${name}`);
            let written = 0;
            while (written < bytesRead)
              written += (
                await output.write(
                  buffer,
                  written,
                  bytesRead - written,
                  copied + written,
                )
              ).bytesWritten;
            copied += bytesRead;
            if (Date.now() - reported > 100) {
              report("saving");
              reported = Date.now();
            }
          }
          const after = await source.stat();
          if (
            after.size !== info.size ||
            after.mtimeMs !== info.mtimeMs ||
            after.ctimeMs !== info.ctimeMs
          )
            throw new Error(`Attachment changed while copying: ${name}`);
          await output.sync();
        } finally {
          await output.close();
        }
        await rename(
          join(directory, "original.partial"),
          join(directory, "original"),
        );
        await this.save({ ref, owners: [] });
        report("saved");
        return ref;
      } finally {
        await source.close();
      }
    } catch (error) {
      this.failedImports.set(id, path);
      report("error", (error as Error).message);
      if (directory) await rm(directory, { recursive: true, force: true });
      if ((error as NodeJS.ErrnoException).code === "ENOSPC")
        throw new Error("Not enough disk space to save attachment original");
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.imports.delete(id);
      if (acquired) {
        const next = this.copyWaiting.shift();
        if (next) next();
        else this.copyActive--;
      }
    }
  }
  async importInline(
    item: PromptAttachment,
  ): Promise<PromptAttachmentReference> {
    await this.recovery;
    if (isAttachmentReference(item)) return (await this.record(item.id)).ref;
    promptAttachmentsSchema.parse([item]);
    const bytes = Buffer.from(
      "type" in item ? item.content : item.data,
      "type" in item ? "utf8" : "base64",
    );
    const ref: PromptAttachmentReference = {
      type: "attachment",
      id: randomUUID(),
      name: item.name,
      mimeType: item.mimeType,
      kind: "type" in item ? "file" : "image",
      size: bytes.length,
      status: "pending",
    };
    promptAttachmentsSchema.parse([ref]);
    await mkdir(this.directory(ref.id), { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory(ref.id), "original"), bytes, {
      mode: 0o600,
    });
    await this.save({ ref, owners: [], extractedText: "type" in item });
    return ref;
  }
  async bind(
    threadId: string,
    items: readonly PromptAttachment[],
  ): Promise<PromptAttachmentReference[]> {
    safeId(threadId);
    return this.locked(async () => {
      const records: RecordData[] = [];
      for (const item of items) {
        const ref = await this.importInline(item),
          record = await this.record(ref.id);
        if (record.owners.length && !record.owners.includes(threadId))
          throw new Error("Attachment belongs to another task");
        // Display names may be disambiguated in the composer; bytes and identity come from storage.
        records.push({ ...record, ref: { ...record.ref, name: item.name } });
      }
      promptAttachmentsSchema.parse(records.map((r) => r.ref));
      for (const record of records) {
        if (!record.owners.includes(threadId)) record.owners.push(threadId);
        await this.save(record);
      }
      return records.map((r) => r.ref);
    });
  }
  async prepare(
    id: string,
    signal?: AbortSignal,
  ): Promise<PromptAttachmentReference> {
    const running = this.preparations.get(id);
    if (running) return running;
    const promise = this.prepareOriginal(id, signal);
    this.preparations.set(id, promise);
    try {
      return await promise;
    } finally {
      this.preparations.delete(id);
    }
  }
  private async prepareOriginal(
    id: string,
    signal?: AbortSignal,
  ): Promise<PromptAttachmentReference> {
    const record = await this.record(id);
    if (
      record.ref.status === "ready" &&
      (record.ref.kind === "image" ||
        (record as RecordData & { indexVersion?: number }).indexVersion === 1)
    )
      return record.ref;
    record.ref.parseStatus = "processing";
    await this.locked(async () => {
      const current = await this.record(id);
      await this.save({
        ...current,
        ref: { ...current.ref, parseStatus: "processing" },
      });
    });
    try {
      if (record.ref.kind === "image") {
        const result = await runWork<ImageResult>(
          {
            action: "image",
            path: join(this.directory(id), "original"),
            mimeType: record.ref.mimeType,
          },
          signal,
        );
        await writeFile(
          join(this.directory(id), "image.json"),
          JSON.stringify(result),
          { mode: 0o600 },
        );
        Object.assign(record.ref, {
          displayWidth: result.width,
          displayHeight: result.height,
          width: result.originalWidth,
          height: result.originalHeight,
          thumbnail:
            result.thumbnail.length <= 100000 ? result.thumbnail : undefined,
        });
      } else {
        const result = await runWork<{ characters: number; pages?: number }>(
          {
            action: "parse",
            path: join(this.directory(id), "original"),
            mimeType: record.extractedText ? "text/plain" : record.ref.mimeType,
            output: join(this.directory(id), "text.sqlite"),
          },
          signal,
        );
        Object.assign(record.ref, {
          characters: result.characters,
          pages: result.pages,
        });
        record.indexVersion = 1;
        record.ref.indexVersion = 1;
        if (!result.characters)
          throw new Error(
            "No extractable text. For scanned PDFs, use attachment_read with visual=true and a page number.",
          );
      }
      record.ref.status = "ready";
      record.ref.parseStatus = "complete";
      delete record.ref.error;
    } catch (error) {
      record.ref.status = "error";
      record.ref.parseStatus = "error";
      record.ref.error = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 1000);
    }
    // Binding may have happened while the worker ran.
    await this.locked(async () => {
      const current = await this.record(id);
      await this.save({
        ...current,
        indexVersion: record.indexVersion,
        ref: { ...record.ref, name: current.ref.name },
      });
    });
    return record.ref;
  }
  private async authorized(threadId: string, id: string) {
    let record: RecordData;
    try {
      record = await this.record(id);
    } catch {
      throw new Error("Attachment is not available to this task");
    }
    if (!record.owners.includes(threadId))
      throw new Error("Attachment is not available to this task");
    return record;
  }
  async list(
    threadId: string,
    selectedIds?: string[],
  ): Promise<PromptAttachmentReference[]> {
    const ids = await readdir(this.root).catch(() => []);
    const refs: PromptAttachmentReference[] = [];
    for (const id of ids) {
      const record = await this.record(id).catch(() => undefined);
      if (record?.owners.includes(threadId)) refs.push(record.ref);
    }
    const byId = new Map(refs.map((ref) => [ref.id, ref]));
    return selectedIds
      ? selectedIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
      : refs;
  }
  async operate(
    threadId: string,
    op: AttachmentOperation,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (op.action === "list") {
      const refs = await this.list(threadId, op.ids),
        offset = op.offset ?? 0;
      const items = [];
      let remaining = Math.min(4000, op.maxTokens ?? 4000);
      for (const ref of refs.slice(offset)) {
        const item = { ...ref, thumbnail: undefined };
        const size = estimateTextTokens(JSON.stringify(item));
        if (size > remaining) break;
        items.push(item);
        remaining -= size;
      }
      return {
        attachments: items,
        nextOffset:
          offset + items.length < refs.length
            ? offset + items.length
            : undefined,
      };
    }
    if (op.action === "search" && !op.id) {
      const refs = (await this.list(threadId, op.ids)).filter(
        (ref) => ref.kind === "file",
      );
      const position = op.attachmentOffset ?? 0;
      if (!Number.isSafeInteger(position) || position < 0)
        throw new Error("Invalid attachment cursor");
      // One document per call keeps cross-document searches cancellable and bounded.
      const ref = refs[position];
      if (!ref) return { matches: [], complete: true };
      const result = (await this.operate(
        threadId,
        { ...op, id: ref.id },
        signal,
      )) as { nextOffset?: number };
      return {
        ...result,
        attachmentOffset:
          result.nextOffset === undefined ? position + 1 : position,
        offset: result.nextOffset ?? 0,
        complete:
          result.nextOffset === undefined && position + 1 >= refs.length,
      };
    }
    if (!op.id) throw new Error("Attachment id is required");
    await this.authorized(threadId, op.id);
    const ref = op.visual
      ? (await this.record(op.id)).ref
      : await this.prepare(op.id, signal);
    const budget = Math.min(
      4000,
      Math.max(0, Math.floor(op.maxTokens ?? 4000)),
    );
    if (!budget)
      throw new Error("No context budget remains for attachment content");
    if (op.visual || ref.kind === "image") {
      if (op.action === "search")
        throw new Error("Image text search is unavailable; use visual reading");
      const result =
        !op.crop && ref.kind === "image" && ref.status === "ready"
          ? (JSON.parse(
              await readFile(join(this.directory(op.id), "image.json"), "utf8"),
            ) as ImageResult)
          : await runWork<ImageResult>(
              {
                action: "image",
                path: join(this.directory(op.id), "original"),
                mimeType: ref.mimeType,
                page: op.page,
                part: op.part,
                crop: op.crop,
              },
              signal,
            );
      return {
        id: ref.id,
        name: ref.name,
        page: op.page,
        ...result,
        thumbnail: undefined,
      };
    }
    if (ref.status === "error") throw new Error(ref.error);
    return runWork(
      {
        action: op.action,
        path: join(this.directory(op.id), "text.sqlite"),
        mimeType: ref.mimeType,
        id: ref.id,
        name: ref.name,
        page: op.page,
        offset: op.offset,
        query: op.query,
        maxTokens: budget,
      },
      signal,
    );
  }

  async previewFile(
    id: string,
    offset = 0,
    threadId?: string,
  ): Promise<import("../../shared/api.js").AttachmentFilePreview> {
    const record = threadId
      ? await this.authorized(threadId, id)
      : await this.record(id);
    if (record.ref.kind !== "file") throw new Error("Attachment is not a file");
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid attachment offset");
    const ref = await this.prepare(id);
    if (ref.status === "error" && (ref.characters !== 0 || ref.size !== 0))
      throw new Error(ref.error);
    const result = await runWork<{ text: string; nextOffset?: number }>({
      action: "read",
      path: join(this.directory(id), "text.sqlite"),
      mimeType: ref.mimeType,
      offset,
      maxTokens: 4000,
    });
    return { name: ref.name, text: result.text, nextOffset: result.nextOffset };
  }

  async preview(
    id: string,
    threadId?: string,
  ): Promise<{ name: string; mimeType: string; data: string }> {
    const record = threadId
      ? await this.authorized(threadId, id)
      : await this.record(id);
    if (record.ref.kind !== "image")
      throw new Error("Attachment is not an image");
    const result = await runWork<ImageResult>({
      action: "image",
      path: join(this.directory(id), "original"),
      mimeType: record.ref.mimeType,
    });
    return {
      name: record.ref.name,
      mimeType: result.mimeType,
      data: result.data,
    };
  }

  async copyThread(source: string, target: string) {
    await this.locked(async () => {
      for (const ref of await this.list(source)) {
        const record = await this.record(ref.id);
        if (!record.owners.includes(target)) record.owners.push(target);
        await this.save(record);
      }
    });
  }
  async deleteThread(thread: string) {
    await this.locked(async () => {
      for (const ref of await this.list(thread)) {
        const record = await this.record(ref.id);
        record.owners = record.owners.filter((id) => id !== thread);
        if (record.owners.length) await this.save(record);
        else await rm(this.directory(ref.id), { recursive: true, force: true });
      }
    });
  }
}
