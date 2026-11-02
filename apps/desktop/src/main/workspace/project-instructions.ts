import { constants } from "node:fs";
import { lstat, open, realpath, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";

export const MAX_PROJECT_INSTRUCTIONS_BYTES = 1024 * 1024;

/** A manual editor for one fixed file in a registered project's local checkout. */
export class ProjectInstructions {
  constructor(
    private readonly project: (id: string) => { path: string } | undefined,
  ) {}

  private async file(projectId: unknown): Promise<string> {
    if (typeof projectId !== "string" || !/^[\w-]{1,128}$/.test(projectId))
      throw new Error("Invalid project identity.");
    const project = this.project(projectId);
    if (!project || !isAbsolute(project.path))
      throw new Error("Project not found.");
    const root = await realpath(project.path);
    const file = join(root, "AGENTS.md");
    try {
      const metadata = await lstat(file);
      const resolved = await realpath(file);
      const child = relative(root, resolved);
      if (
        child.startsWith("..") ||
        isAbsolute(child) ||
        metadata.isSymbolicLink() ||
        !metadata.isFile()
      )
        throw new Error(
          "Project AGENTS.md must be a regular file inside the local checkout.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A dangling link is not a missing file.
      if (
        await lstat(file).then(
          () => true,
          () => false,
        )
      )
        throw new Error("Invalid project AGENTS.md link.");
    }
    return file;
  }

  private async contents(file: string): Promise<string> {
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_PROJECT_INSTRUCTIONS_BYTES)
        throw new Error("Project AGENTS.md cannot exceed 1 MiB.");
      const bytes = Buffer.alloc(MAX_PROJECT_INSTRUCTIONS_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(
          bytes,
          length,
          bytes.length - length,
          null,
        );
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_PROJECT_INSTRUCTIONS_BYTES)
        throw new Error("Project AGENTS.md cannot exceed 1 MiB.");
      const content = bytes.subarray(0, length);
      if (content.includes(0))
        throw new Error("Project AGENTS.md must be UTF-8 text.");
      return new TextDecoder("utf-8", { fatal: true }).decode(content);
    } finally {
      await handle.close();
    }
  }

  async read(projectId: unknown): Promise<string> {
    return this.contents(await this.file(projectId));
  }

  async write(projectId: unknown, content: unknown): Promise<void> {
    if (
      typeof content !== "string" ||
      content.includes("\0") ||
      Buffer.byteLength(content, "utf8") > MAX_PROJECT_INSTRUCTIONS_BYTES
    )
      throw new Error("Project AGENTS.md must be UTF-8 text of at most 1 MiB.");
    const file = await this.file(projectId);
    await this.contents(file);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
      // Rename replaces the fixed directory entry; it never follows a late symlink.
      await this.file(projectId);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
