import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import type { PromptImage } from "@artemis/protocol";

const SOURCE_ID = /^[A-Za-z0-9_-]{1,200}$/u;

function safeId(value: string, label: string): string {
  if (!SOURCE_ID.test(value)) {
    throw new Error(`Task source ${label} is invalid.`);
  }
  return value;
}

export class TaskSourceImageStore {
  constructor(private readonly root: string) {}

  async save(
    threadId: string,
    sourceId: string,
    image: PromptImage,
  ): Promise<void> {
    const directory = this.threadDirectory(threadId);
    await mkdir(directory, { mode: 0o700, recursive: true });
    await writeFile(
      this.imagePath(threadId, sourceId),
      Buffer.from(image.data, "base64"),
      { mode: 0o600 },
    );
  }

  async read(threadId: string, sourceId: string): Promise<string> {
    return (await readFile(this.imagePath(threadId, sourceId))).toString(
      "base64",
    );
  }

  async delete(threadId: string, sourceId: string): Promise<void> {
    await unlink(this.imagePath(threadId, sourceId)).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await rm(this.threadDirectory(threadId), { force: true, recursive: true });
  }

  async copyThread(
    sourceThreadId: string,
    targetThreadId: string,
  ): Promise<void> {
    const source = this.threadDirectory(sourceThreadId);
    const target = this.threadDirectory(targetThreadId);
    try {
      await access(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    try {
      await cp(source, target, {
        errorOnExist: true,
        force: false,
        recursive: true,
      });
    } catch (error) {
      await rm(target, { force: true, recursive: true });
      throw error;
    }
  }

  private threadDirectory(threadId: string): string {
    return join(this.root, safeId(threadId, "thread id"));
  }

  private imagePath(threadId: string, sourceId: string): string {
    return join(this.threadDirectory(threadId), safeId(sourceId, "image id"));
  }
}
