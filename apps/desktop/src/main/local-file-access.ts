import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

export function resolveLocalFilePath(input: string): string {
  if (!isAbsolute(input)) {
    throw new Error("Local file access requires an absolute path.");
  }
  return resolve(input);
}

export async function readLocalTextFile(input: string): Promise<string> {
  return readFile(resolveLocalFilePath(input), "utf8");
}

export async function writeLocalTextFile(
  input: string,
  content: string,
): Promise<{ path: string; operation: "create" | "update" }> {
  const path = resolveLocalFilePath(input);
  let operation: "create" | "update" = "create";
  try {
    await stat(path);
    operation = "update";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return { path, operation };
}
