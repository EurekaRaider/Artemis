import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const PROJECT_MEMORY_MAX_BYTES = 512 * 1024;
export const GLOBAL_MEMORY_MAX_BYTES = 128 * 1024;

export interface MemoryEntry {
  title: string;
  content: string;
  keywords: string[];
}

function hasMalformedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function containsCredential(value: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /\bAuthorization\s*:\s*Bearer\s+\S+/iu.test(value) ||
    /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S{8,}/iu.test(value) ||
    /\bsk-[a-z0-9_-]{16,}\b/iu.test(value)
  );
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function validateEntry(entry: MemoryEntry): MemoryEntry {
  const title = entry.title.trim();
  const content = entry.content.trim();
  const keywords = [
    ...new Set(entry.keywords.map((keyword) => keyword.trim().toLowerCase())),
  ].filter(Boolean);
  if (
    !title ||
    title.length > 120 ||
    !content ||
    content.length > 8_000 ||
    keywords.length < 2 ||
    keywords.length > 12 ||
    keywords.some((keyword) => keyword.length > 64)
  ) {
    throw new Error("Memory entry size or structure is invalid.");
  }
  if (
    hasMalformedUnicode(title) ||
    hasMalformedUnicode(content) ||
    keywords.some(hasMalformedUnicode)
  ) {
    throw new Error("Memory entries must contain valid UTF-8 Unicode text.");
  }
  if (containsCredential(`${title}\n${content}\n${keywords.join("\n")}`)) {
    throw new Error(
      "Memory entries cannot contain credentials, secrets, or tokens.",
    );
  }
  return { title, content, keywords };
}

async function readOptional(path: string): Promise<string> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("Memory path must be a regular file.");
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return "";
    }
    throw error;
  }
}

export function resolveMemoryPaths(
  workspacePath: string,
  homePath: string,
): { project: string; global: string } {
  return {
    project: join(resolve(workspacePath), ".artemis", "MEMORY.md"),
    global: join(resolve(homePath), ".pi", "agent", "MEMORY.md"),
  };
}

export class MemoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly maxBytes: number;

  constructor(
    private readonly filePath: string,
    options: { maxBytes?: number } = {},
  ) {
    this.maxBytes = options.maxBytes ?? PROJECT_MEMORY_MAX_BYTES;
  }

  async snapshot(): Promise<{ path: string; content: string }> {
    return { path: this.filePath, content: await readOptional(this.filePath) };
  }

  append(entry: MemoryEntry): Promise<{ appended: boolean }> {
    const pending = this.queue.then(() => this.appendNow(entry));
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async appendNow(entry: MemoryEntry): Promise<{ appended: boolean }> {
    const validated = validateEntry(entry);
    const current = await readOptional(this.filePath);
    const heading = `## ${validated.title}`;
    const duplicateHeading = current
      .split(/\r?\n(?=## )/gu)
      .some(
        (section) =>
          normalized(section.split(/\r?\n/u, 1)[0] ?? "") ===
          normalized(heading),
      );
    if (
      duplicateHeading ||
      normalized(current).includes(normalized(validated.content))
    ) {
      return { appended: false };
    }

    const section = `${heading}\nKeywords: ${validated.keywords.join(", ")}\n\n${validated.content}\n`;
    const next = current.trim()
      ? `${current.trimEnd()}\n\n${section}`
      : `# Artemis Memory\n\n${section}`;
    if (Buffer.byteLength(next, "utf8") > this.maxBytes) {
      throw new Error("Memory file size exceeds its byte limit.");
    }

    const directory = dirname(this.filePath);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error("Memory directory must be a regular directory.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        await mkdir(directory, { recursive: true });
      } else {
        throw error;
      }
    }

    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, next, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return { appended: true };
  }
}
