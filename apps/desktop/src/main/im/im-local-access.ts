import { open, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildDesktopUserLaunch } from "@artemis/platform";
import { imContentHash } from "./im-policy.js";

/** Only called by the IM broker after checking the current audience grant. */
export async function readLocalImFile(workspace: string, input: string) {
  const path = resolve(workspace, input);
  if ((await stat(path)).isDirectory()) {
    const entries = await readdir(path, { withFileTypes: true });
    return {
      entries: entries.slice(0, 1000).map((entry) => ({
        path: join(path, entry.name),
        directory: entry.isDirectory(),
      })),
    };
  }
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 10 * 1024 * 1024)
      throw new Error("Read a regular file of at most 10 MiB.");
    const bytes = Buffer.alloc(Math.min(info.size + 1, 10 * 1024 * 1024 + 1));
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const chunk = await handle.read(
        bytes,
        bytesRead,
        bytes.length - bytesRead,
        bytesRead,
      );
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (
      bytesRead !== info.size ||
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs
    )
      throw new Error("File changed while reading; retry after it is stable.");
    const content = bytes.subarray(0, bytesRead);
    return {
      output: content.toString("utf8"),
      contentHash: imContentHash(content),
      exitCode: 0,
      cancelled: false,
    };
  } finally {
    await handle.close();
  }
}

export async function writeLocalImFile(
  workspace: string,
  input: string,
  content: string,
  assertCurrent: () => void,
  expectedHash?: string,
) {
  const path = resolve(workspace, input);
  assertCurrent();
  // Exclusive creation and descriptor-based writes preserve conflict checks.
  const handle = await open(
    path,
    expectedHash === "absent" ? "wx" : "r+",
  ).catch(async (error) => {
    if (expectedHash || error.code !== "ENOENT") throw error;
    assertCurrent();
    return open(path, "wx");
  });
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Only regular files can be written.");
    if (
      expectedHash &&
      expectedHash !== "absent" &&
      (info.size > 10 * 1024 * 1024 ||
        imContentHash(await handle.readFile()) !== expectedHash)
    )
      throw new Error(
        "File changed since it was read. Read it again and merge before writing.",
      );
    assertCurrent();
    await handle.truncate(0);
    const bytes = Buffer.from(content, "utf8");
    let written = 0;
    while (written < bytes.length) {
      assertCurrent();
      const result = await handle.write(
        bytes,
        written,
        bytes.length - written,
        written,
      );
      written += result.bytesWritten;
    }
  } finally {
    await handle.close();
  }
}

export function buildLocalImShellLaunch(workspace: string, command: string) {
  return buildDesktopUserLaunch({
    executable: process.platform === "win32" ? "powershell.exe" : "/bin/sh",
    args:
      process.platform === "win32"
        ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]
        : ["-c", command],
    cwd: workspace,
  });
}
