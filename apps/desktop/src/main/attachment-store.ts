import { randomUUID } from "node:crypto";
import {
  copyFile,
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
  promptAttachmentsSchema,
  MAX_PROMPT_FILE_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_TOTAL_BYTES,
  type PromptAttachment,
  type PromptAttachmentReference,
  type AttachmentOperation,
} from "@artemis/protocol";
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
        env,
      });
      const nodeChild = utility
        ? undefined
        : fork(workerPath, [], {
            env,
            execArgv: [],
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
        () => finish(new Error("Attachment processing exceeded 60 seconds")),
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
      child.on("message", (message: { result?: T; error?: string }) =>
        finish(
          message.error ? new Error(message.error) : undefined,
          message.result,
        ),
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
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}
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
      join(this.directory(record.ref.id), "record.json"),
      JSON.stringify(record),
      { mode: 0o600 },
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
    let total = 0,
      images = 0,
      files = 0;
    for (const path of paths.slice(0, 30)) {
      try {
        const info = await stat(path),
          image = (mimeTypes[extname(path).toLowerCase()] ?? "").startsWith(
            "image/",
          );
        if (
          total + info.size > MAX_PROMPT_TOTAL_BYTES ||
          (image ? images >= 20 : files >= 10)
        )
          throw new Error(
            `Attachment exceeds the message limits: ${path.split(/[\\/]/).pop()}`,
          );
        const ref = await this.importPath(path);
        attachments.push(ref);
        total += ref.size;
        if (image) images++;
        else files++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (paths.length > 30)
      errors.push("Only the first 30 attachments were imported.");
    return { attachments, errors };
  }
  async discardDraft(id: string): Promise<void> {
    await this.locked(async () => {
      const record = await this.record(id).catch(() => undefined);
      if (record && !record.owners.length)
        await rm(this.directory(id), { recursive: true, force: true });
    });
  }
  async importPath(path: string): Promise<PromptAttachmentReference> {
    if (!isAbsolute(path)) throw new Error("Attachment path must be absolute");
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Attachment is not a file");
    const name = path.split(/[\\/]/).pop()!;
    const mimeType = mimeTypes[extname(path).toLowerCase()] ?? "text/plain";
    const kind = mimeType.startsWith("image/") ? "image" : "file";
    if (
      info.size >
      (kind === "image" ? MAX_PROMPT_IMAGE_BYTES : MAX_PROMPT_FILE_BYTES)
    )
      throw new Error(
        `Attachment is larger than ${kind === "image" ? 10 : 100} MiB: ${name}`,
      );
    const ref: PromptAttachmentReference = {
      type: "attachment",
      id: randomUUID(),
      name,
      mimeType,
      kind,
      size: info.size,
      status: "pending",
    };
    await mkdir(this.directory(ref.id), { recursive: true, mode: 0o700 });
    try {
      const original = join(this.directory(ref.id), "original");
      await copyFile(path, original);
      ref.size = (await stat(original)).size;
      if (
        ref.size >
        (kind === "image" ? MAX_PROMPT_IMAGE_BYTES : MAX_PROMPT_FILE_BYTES)
      )
        throw new Error(`Attachment changed while copying: ${name}`);
      await this.save({ ref, owners: [] });
    } catch (error) {
      await rm(this.directory(ref.id), { recursive: true, force: true });
      throw error;
    }
    return ref;
  }
  async importInline(
    item: PromptAttachment,
  ): Promise<PromptAttachmentReference> {
    if (isAttachmentReference(item)) return (await this.record(item.id)).ref;
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
    const record = await this.record(id);
    if (record.ref.status !== "pending") return record.ref;
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
            output: join(this.directory(id), "text.json"),
          },
          signal,
        );
        Object.assign(record.ref, result);
        if (!result.characters)
          throw new Error(
            "No extractable text. For scanned PDFs, use attachment_read with visual=true and a page number.",
          );
      }
      record.ref.status = "ready";
    } catch (error) {
      record.ref.status = "error";
      record.ref.error = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 1000);
    }
    // Binding may have happened while the worker ran.
    await this.locked(async () => {
      const current = await this.record(id);
      await this.save({
        ...current,
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
  async list(threadId: string): Promise<PromptAttachmentReference[]> {
    const ids = await readdir(this.root).catch(() => []);
    const refs: PromptAttachmentReference[] = [];
    for (const id of ids) {
      const record = await this.record(id);
      if (record.owners.includes(threadId)) refs.push(record.ref);
    }
    return refs;
  }
  async operate(
    threadId: string,
    op: AttachmentOperation,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (op.action === "list") {
      const refs = await this.list(threadId),
        offset = op.offset ?? 0;
      const items = [];
      let remaining = Math.min(4000, op.maxTokens ?? 4000);
      for (const ref of refs.slice(offset)) {
        const item = { ...ref, thumbnail: undefined };
        const size = Buffer.byteLength(JSON.stringify(item));
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
    if (!op.id) throw new Error("Attachment id is required");
    await this.authorized(threadId, op.id);
    const ref = await this.prepare(op.id, signal);
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
        path: join(this.directory(op.id), "text.json"),
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

  async preview(
    id: string,
    threadId?: string,
  ): Promise<{ name: string; mimeType: string; data: string }> {
    const record = threadId
      ? await this.authorized(threadId, id)
      : await this.record(id);
    if (record.ref.kind !== "image")
      throw new Error("Attachment is not an image");
    return {
      name: record.ref.name,
      mimeType: record.ref.mimeType,
      data: (await readFile(join(this.directory(id), "original"))).toString(
        "base64",
      ),
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
