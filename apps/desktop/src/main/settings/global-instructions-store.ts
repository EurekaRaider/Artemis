import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface GlobalInstructionsSnapshot {
  path: string;
  content: string;
}

const MAX_GLOBAL_INSTRUCTIONS_BYTES = 1024 * 1024;

export class GlobalInstructionsStore {
  constructor(private readonly filePath: string) {}

  async snapshot(): Promise<GlobalInstructionsSnapshot> {
    try {
      return {
        path: this.filePath,
        content: await readFile(this.filePath, "utf8"),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      return { path: this.filePath, content: "" };
    }
  }

  async save(content: string): Promise<void> {
    if (
      typeof content !== "string" ||
      Buffer.byteLength(content, "utf8") > MAX_GLOBAL_INSTRUCTIONS_BYTES
    ) {
      throw new Error("Global AGENTS.md cannot exceed 1 MiB.");
    }
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}
